/**
 * Faturamento automático em lote:
 *  • ImportarXmlsDialog — solta vários XMLs (e DANFEs em PDF) emitidos em outro
 *    sistema; cada nota é casada sozinha com o pedido pronto do mesmo cliente e
 *    valor. Confere e registra tudo de uma vez (o registro manual continua).
 *  • EmitirLoteDialog — com o emissor ligado, emite as notas de vários pedidos
 *    em sequência com os padrões fiscais (natureza/NCM/CFOP do cadastro).
 */
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileStack, Loader2, Send, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { friendlyError } from "@/lib/errorMessages";
import { enviarArquivoFiscal, fmtData, lerXmlNota, type NotaXml } from "@/lib/financeiro";
import { chamarEmissor, pendenciasCliente, totalPedido, type EmissorStatus, type PedidoFaturar } from "./fiscal";
import { casarNotas, TOLERANCIA, type Confianca } from "./casarNotas";

const numPedido = (id: string) => `#${id.slice(0, 8).toUpperCase()}`;
const dig = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

interface Linha {
  nota: NotaXml; xml: File; pdf: File | null;
  pedidoId: string; confianca: Confianca; incluir: boolean;
  jaRegistrada: boolean;
  resultado?: { ok: boolean; texto: string };
}

const CONF: Record<Confianca, { label: string; cls: string }> = {
  exata:      { label: "Cliente e valor batem", cls: "bg-green-500/10 text-green-700 dark:text-green-400" },
  so_cliente: { label: "Cliente bate, valor diferente", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  nenhuma:    { label: "Sem pedido pronto desse cliente", cls: "bg-muted text-muted-foreground" },
  devolucao:  { label: "Nota de devolução — registre em Devoluções", cls: "bg-muted text-muted-foreground" },
};

export function ImportarXmlsDialog({ pedidos, onClose, onFeito }: { pedidos: PedidoFaturar[]; onClose: () => void; onFeito: () => void }) {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [lendo, setLendo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [concluido, setConcluido] = useState(false);
  const [ignorados, setIgnorados] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const porId = useMemo(() => new Map(pedidos.map(p => [p.id, p])), [pedidos]);

  async function ler(files: FileList | File[]) {
    const lista = [...files];
    if (!lista.length) return;
    setLendo(true);
    const xmls = lista.filter(f => /\.xml$/i.test(f.name) || f.type.includes("xml"));
    const pdfs = lista.filter(f => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    const ruins: string[] = [];
    const lidas: { nota: NotaXml; xml: File }[] = [];
    for (const f of xmls) {
      const n = lerXmlNota(await f.text());
      if (!n) { ruins.push(`${f.name} (não é XML de NF-e)`); continue; }
      if (lidas.some(l => l.nota.chave === n.chave) || linhas.some(l => l.nota.chave === n.chave)) continue;
      lidas.push({ nota: n, xml: f });
    }
    for (const f of lista) if (!xmls.includes(f) && !pdfs.includes(f)) ruins.push(`${f.name} (formato não aceito)`);
    // Notas que já estão no sistema não são registradas de novo.
    const chaves = lidas.map(l => l.nota.chave);
    const { data: existentes } = chaves.length
      ? await supabase.from("notas_fiscais").select("chave").in("chave", chaves)
      : { data: [] as { chave: string | null }[] };
    const jaTem = new Set((existentes ?? []).map(e => e.chave));
    // As linhas que já estavam na lista ficam como estão (pedido escolhido à
    // mão, resultado do registro...). Só as notas novas são casadas, e só com
    // pedidos que ainda não estão ligados a outra nota da lista — antes, soltar
    // mais arquivos recasava tudo e apagava o "registrada" das já gravadas.
    const pedidosOcupados = new Set(linhas.filter(l => l.pedidoId && (l.incluir || l.resultado?.ok)).map(l => l.pedidoId));
    const casados = casarNotas(
      lidas.map(t => ({ chave: t.nota.chave, valor: t.nota.valor, destinatarioDoc: t.nota.destinatarioDoc, finalidade: t.nota.finalidade })),
      pedidos.filter(p => !pedidosOcupados.has(p.id))
        .map(p => ({ id: p.id, doc: p.clientes?.documento ?? "", total: totalPedido(p), criadoEm: p.created_at })),
    );
    const pdfDe = (chave: string, xmlNome: string) => {
      const base = xmlNome.replace(/\.xml$/i, "").toLowerCase();
      return pdfs.find(p => p.name.replace(/\D/g, "").includes(chave) || p.name.replace(/\.pdf$/i, "").toLowerCase() === base) ?? null;
    };
    setLinhas([
      ...linhas.map(l => (l.pdf || l.resultado?.ok ? l : { ...l, pdf: pdfDe(l.nota.chave, l.xml.name) })),
      ...lidas.map((t, i) => {
        const c = casados[i];
        const ja = jaTem.has(t.nota.chave);
        return {
          nota: t.nota, xml: t.xml, pdf: pdfDe(t.nota.chave, t.xml.name),
          pedidoId: c.pedidoId ?? "", confianca: c.confianca, jaRegistrada: ja,
          incluir: !ja && c.confianca === "exata",
        };
      }),
    ]);
    setIgnorados(r => [...r, ...ruins]);
    setLendo(false);
  }

  function trocarPedido(idx: number, pedidoId: string) {
    setLinhas(ls => ls.map((l, i) => {
      if (i !== idx) return l;
      const p = porId.get(pedidoId);
      const conf: Confianca = !p ? "nenhuma"
        : dig(p.clientes?.documento) === dig(l.nota.destinatarioDoc) && Math.abs(totalPedido(p) - l.nota.valor) <= TOLERANCIA ? "exata" : "so_cliente";
      return { ...l, pedidoId, confianca: conf, incluir: !!p && conf === "exata" && !l.jaRegistrada };
    }));
  }

  const usados = new Map<string, number>();
  linhas.forEach(l => { if (l.incluir && l.pedidoId) usados.set(l.pedidoId, (usados.get(l.pedidoId) ?? 0) + 1); });
  const conflito = [...usados.values()].some(n => n > 1);
  const marcadas = linhas.filter(l => l.incluir && l.pedidoId && !l.resultado?.ok);

  async function registrar() {
    if (conflito) { toast.error("Duas notas estão no mesmo pedido — ajuste antes."); return; }
    setSalvando(true);
    let ok = 0;
    const novas = [...linhas];
    for (let i = 0; i < novas.length; i++) {
      const l = novas[i];
      if (!l.incluir || !l.pedidoId || l.resultado?.ok) continue;
      try {
        const xmlPath = await enviarArquivoFiscal(l.xml, l.nota.chave, "xml");
        const pdfPath = l.pdf ? await enviarArquivoFiscal(l.pdf, l.nota.chave, "pdf") : null;
        const { data, error } = await supabase.rpc("registrar_nf_externa", {
          p_tipo: "venda", p_pedido_id: l.pedidoId, p_devolucao_id: null, p_chave: l.nota.chave,
          p_emitida_em: l.nota.emitidaEm ? new Date(l.nota.emitidaEm).toISOString() : new Date().toISOString(),
          p_valor: l.nota.valor, p_xml_path: xmlPath, p_danfe_path: pdfPath, p_protocolo: l.nota.protocolo,
        });
        if (error) throw error;
        const r = data as unknown as { ok: boolean; error?: string; numero?: number };
        novas[i] = { ...l, resultado: r.ok ? { ok: true, texto: `NF-e ${r.numero ?? l.nota.numero} registrada` } : { ok: false, texto: r.error ?? "Não registrada" } };
        if (r.ok) ok++;
      } catch (e) {
        novas[i] = { ...l, resultado: { ok: false, texto: friendlyError(e) } };
      }
      setLinhas([...novas]);
    }
    setSalvando(false);
    setConcluido(true);
    if (ok) toast.success(`${ok} nota${ok > 1 ? "s" : ""} registrada${ok > 1 ? "s" : ""} — pedidos faturados e contas a receber criadas.`);
  }

  const fechar = () => { if (salvando) return; if (concluido) onFeito(); else onClose(); };

  return (
    <Dialog open onOpenChange={v => !v && fechar()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileStack className="h-5 w-5 text-primary" />Registrar várias NF-e (automático)</DialogTitle>
          <DialogDescription>
            Solte os XMLs das notas emitidas no outro sistema (pode mandar os PDFs do DANFE junto). Cada nota é ligada sozinha ao pedido pronto do mesmo cliente e valor — confira e registre tudo de uma vez.
          </DialogDescription>
        </DialogHeader>
        <input ref={inputRef} type="file" multiple accept=".xml,.pdf,application/xml,text/xml,application/pdf" className="hidden"
          onChange={e => { if (e.target.files) ler(e.target.files); e.target.value = ""; }} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={lendo || salvando}
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); ler(e.dataTransfer.files); }}
          className="w-full rounded-2xl border-2 border-dashed px-4 py-6 text-center hover:border-primary/50 hover:bg-muted/40">
          {lendo ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /> : <Upload className="mx-auto h-6 w-6 text-primary/70" />}
          <p className="mt-1 text-sm font-semibold">{linhas.length ? "Adicionar mais arquivos" : "Escolha ou arraste os XMLs (e PDFs)"}</p>
          <p className="text-xs text-muted-foreground">Vários de uma vez · o PDF é ligado à nota pela chave ou pelo mesmo nome do XML</p>
        </button>
        {ignorados.length > 0 && (
          <p className="text-xs rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 px-3 py-2"><AlertTriangle className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />Ignorados: {ignorados.join("; ")}</p>
        )}
        {linhas.length > 0 && (
          <ul className="rounded-2xl border divide-y">
            {linhas.map((l, i) => {
              const p = porId.get(l.pedidoId);
              const diff = p ? l.nota.valor - totalPedido(p) : 0;
              const opcoes = [...pedidos].sort((a, b) =>
                Number(dig(b.clientes?.documento) === dig(l.nota.destinatarioDoc)) - Number(dig(a.clientes?.documento) === dig(l.nota.destinatarioDoc)));
              const bloqueada = l.jaRegistrada || l.confianca === "devolucao" || !!l.resultado?.ok;
              return (
                <li key={l.nota.chave} className={cn("p-3 space-y-2", l.resultado?.ok && "bg-green-500/5")}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" aria-label="Registrar esta nota"
                      checked={l.incluir} disabled={bloqueada || !l.pedidoId || salvando}
                      onChange={e => setLinhas(ls => ls.map((x, j) => j === i ? { ...x, incluir: e.target.checked } : x))} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">NF-e {l.nota.numero} · série {l.nota.serie} <span className="font-normal text-muted-foreground">· {fmtData(l.nota.emitidaEm?.slice(0, 10) ?? null)}</span></p>
                      <p className="text-xs text-muted-foreground truncate">{l.nota.destinatarioNome ?? "Destinatário"} · {l.pdf ? "com DANFE" : "sem DANFE"}</p>
                    </div>
                    <p className="font-bold tabular-nums">{formatBRL(l.nota.valor)}</p>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 pl-7">
                    <select value={l.pedidoId} disabled={bloqueada || salvando} onChange={e => trocarPedido(i, e.target.value)} aria-label="Pedido"
                      className="h-10 w-full sm:flex-1 rounded-lg border border-input bg-background px-2 text-sm">
                      <option value="">Escolher pedido...</option>
                      {opcoes.map(o => <option key={o.id} value={o.id}>{numPedido(o.id)} · {o.clientes?.nome ?? "—"} · {formatBRL(totalPedido(o))}</option>)}
                    </select>
                    {l.resultado ? (
                      <span className={cn("rounded-full px-2 py-1 text-xs font-medium inline-flex items-center gap-1", l.resultado.ok ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-red-500/10 text-red-700 dark:text-red-400")}>
                        {l.resultado.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}{l.resultado.texto}
                      </span>
                    ) : l.jaRegistrada ? (
                      <span className="rounded-full px-2 py-1 text-xs bg-muted text-muted-foreground">Já registrada no sistema</span>
                    ) : (
                      <span className={cn("rounded-full px-2 py-1 text-xs font-medium", CONF[l.confianca].cls)}>
                        {CONF[l.confianca].label}{l.confianca === "so_cliente" && p ? ` (${diff > 0 ? "+" : "−"}${formatBRL(Math.abs(diff))})` : ""}
                      </span>
                    )}
                  </div>
                  {l.incluir && l.confianca === "so_cliente" && !l.resultado && (
                    <p className="pl-7 text-xs text-amber-700 dark:text-amber-400">Marcada à mão: a conta a receber vai usar o valor da nota ({formatBRL(l.nota.valor)}).</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {conflito && <p className="text-xs text-red-600">Há duas notas apontando para o mesmo pedido.</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={fechar} disabled={salvando}>{concluido ? "Fechar" : "Cancelar"}</Button>
          <Button onClick={registrar} disabled={salvando || !marcadas.length || conflito} className="gap-1.5">
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Registrar {marcadas.length} nota{marcadas.length !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EmitirLoteDialog({ pedidos, emissor, onClose, onFeito }: { pedidos: PedidoFaturar[]; emissor: EmissorStatus; onClose: () => void; onFeito: () => void }) {
  const aptos = pedidos.filter(p => pendenciasCliente(p.clientes).length === 0);
  const [sel, setSel] = useState<Set<string>>(() => new Set(aptos.map(p => p.id)));
  const [res, setRes] = useState<Record<string, { ok: boolean; texto: string }>>({});
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState(false);
  const total = pedidos.filter(p => sel.has(p.id)).reduce((s, p) => s + totalPedido(p), 0);

  async function emitir() {
    setEnviando(true);
    for (const p of pedidos) {
      if (!sel.has(p.id) || res[p.id]?.ok) continue;
      const r = await chamarEmissor({ acao: "emitir_venda", pedidoId: p.id });
      const out = r.ok
        ? { ok: true, texto: r.status === "autorizada" ? `NF-e ${String(r.numero ?? "")} autorizada` : String(r.mensagem ?? "Em processamento") }
        : { ok: false, texto: [r.erro ?? "Não autorizada", ...(r.problemas ?? [])].join(" · ") };
      setRes(v => ({ ...v, [p.id]: out }));
    }
    setEnviando(false); setFeito(true);
  }
  const fechar = () => { if (enviando) return; if (feito) onFeito(); else onClose(); };

  return (
    <Dialog open onOpenChange={v => !v && fechar()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Send className="h-5 w-5 text-primary" />Emitir notas em lote</DialogTitle>
          <DialogDescription>
            Emite uma NF-e para cada pedido marcado, com a natureza, NCM e CFOP do cadastro. {emissor.ambiente === 2 && <strong className="text-amber-600">Ambiente de homologação (teste) — as notas não têm valor fiscal.</strong>}
          </DialogDescription>
        </DialogHeader>
        <ul className="rounded-2xl border divide-y">
          {pedidos.map(p => {
            const pend = pendenciasCliente(p.clientes);
            const r = res[p.id];
            return (
              <li key={p.id} className="p-3 flex items-start gap-3">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" aria-label="Emitir" checked={sel.has(p.id)} disabled={pend.length > 0 || enviando || !!r?.ok}
                  onChange={e => setSel(s => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{p.clientes?.nome ?? "Cliente"} <span className="font-normal text-muted-foreground">· {numPedido(p.id)}</span></p>
                  {pend.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">Cadastro incompleto ({pend.join(", ")}) — emita pelo botão do pedido</p>}
                  {r && <p className={cn("text-xs", r.ok ? "text-green-700 dark:text-green-400" : "text-red-600")}>{r.texto}</p>}
                </div>
                <p className="font-semibold tabular-nums">{formatBRL(totalPedido(p))}</p>
              </li>
            );
          })}
        </ul>
        <DialogFooter className="gap-2 sm:items-center">
          <span className="text-sm text-muted-foreground sm:mr-auto">{sel.size} pedido{sel.size !== 1 ? "s" : ""} · {formatBRL(total)}</span>
          <Button variant="outline" onClick={fechar} disabled={enviando}>{feito ? "Fechar" : "Cancelar"}</Button>
          <Button onClick={emitir} disabled={enviando || !pedidos.some(p => sel.has(p.id) && !res[p.id]?.ok)} className="gap-1.5">{enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Emitir {sel.size}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
