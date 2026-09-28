/**
 * Faturamento — pedidos prontos para faturar, notas emitidas e devoluções.
 *
 * Duas formas de faturar um pedido:
 *  • "Emitir NF-e"      → emissor integrado (quando ativado em Configurações);
 *  • "Registrar NF-e"   → nota emitida em outro sistema: lê o XML (ou a chave)
 *                         e registra número, chave e arquivos. Gera a conta a
 *                         receber e marca o pedido como faturado/enviado.
 * Nota autorizada não é editável nem apagável (guarda de 5 anos) — só
 * cancelamento (e carta de correção no emissor integrado).
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Ban, CheckCircle2, ClipboardCopy, Download, ExternalLink, FileCheck2, FilePen, FileText, FileUp,
  Loader2, MoreHorizontal, Receipt, RefreshCw, Search, Send, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { friendlyError } from "@/lib/errorMessages";
import { buscarCep, buscarCodigoIbge } from "@/lib/brasilApi";
import {
  abrirArquivoFiscal, baixarCsv, chaveValida, enviarArquivoFiscal, fmtData, fmtDataHora, formatarChave, FORMAS_PAGAMENTO,
  hojeISO, lerChave, lerXmlNota, mascaraDoc, mesISO, parseValor,
} from "@/lib/financeiro";
import {
  chamarEmissor, pendenciasCliente, SELECT_PEDIDO_FATURAR, STATUS_NF, TIPO_NF, totalPedido,
  type ClienteFiscal, type EmissorStatus, type NotaFiscal, type PedidoFaturar,
} from "./fiscal";

const DevolucaoTrocaPanel = lazy(() => import("./DevolucaoTrocaPanel").then(m => ({ default: m.DevolucaoTrocaPanel })));

type Visao = "faturar" | "notas" | "devolucoes";

export function FaturamentoPanel({ emissor, onIrConfig }: { emissor: EmissorStatus; onIrConfig: () => void }) {
  const [visao, setVisao] = useState<Visao>("faturar");
  const [qtdFaturar, setQtdFaturar] = useState<number | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl border bg-muted/40 p-1" role="tablist" aria-label="Faturamento">
          {([["faturar", "A faturar"], ["notas", "Notas emitidas"], ["devolucoes", "Devoluções e trocas"]] as [Visao, string][]).map(([id, l]) => (
            <button key={id} type="button" role="tab" aria-selected={visao === id} onClick={() => setVisao(id)}
              className={cn("h-10 px-4 rounded-lg text-sm font-medium flex items-center gap-1.5", visao === id ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {l}
              {id === "faturar" && !!qtdFaturar && <span className="min-w-5 h-5 px-1 rounded-full text-[11px] font-bold bg-primary/15 text-primary flex items-center justify-center">{qtdFaturar}</span>}
            </button>
          ))}
        </div>
        <span className={cn("ml-auto items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", emissor.ativo ? "inline-flex" : "hidden sm:inline-flex",
          emissor.ativo ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400")}>
          {emissor.ativo ? <><CheckCircle2 className="h-3.5 w-3.5" />Emissor ativo · {emissor.ambiente === 1 ? "Produção" : "Homologação"}</>
            : <><AlertTriangle className="h-3.5 w-3.5" />Emissor desativado — registre notas emitidas fora</>}
        </span>
      </div>
      {visao === "faturar" && <AFaturar emissor={emissor} onIrConfig={onIrConfig} onContagem={setQtdFaturar} />}
      {visao === "notas" && <NotasEmitidas emissor={emissor} />}
      {visao === "devolucoes" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
          <DevolucaoTrocaPanel emissorAtivo={emissor.ativo} />
        </Suspense>
      )}
    </div>
  );
}

// ─── A faturar ───────────────────────────────────────────────────────────────

function AFaturar({ emissor, onIrConfig, onContagem }: { emissor: EmissorStatus; onIrConfig: () => void; onContagem: (n: number) => void }) {
  const [pedidos, setPedidos] = useState<PedidoFaturar[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [emitir, setEmitir] = useState<PedidoFaturar | null>(null);
  const [registrar, setRegistrar] = useState<PedidoFaturar | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("pedidos_comerciais").select(SELECT_PEDIDO_FATURAR)
      .eq("status", "pronto").order("created_at", { ascending: true }).limit(500);
    if (error) toast.error("Não foi possível carregar os pedidos.");
    const lista = (data ?? []) as unknown as PedidoFaturar[];
    setPedidos(lista); onContagem(lista.length);
    setLoading(false);
  }, [onContagem]);
  useEffect(() => { load(); }, [load]);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return pedidos.filter(p => !q || (p.clientes?.nome ?? "").toLowerCase().includes(q) || p.id.startsWith(q) || (p.vendedora_nome ?? "").toLowerCase().includes(q));
  }, [pedidos, busca]);

  return (
    <div className="space-y-3">
      {!emissor.ativo && emissor.carregado && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm flex flex-wrap items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="flex-1 min-w-[14rem]">A emissão direta está desligada. Emita a nota no sistema que vocês usam hoje e clique em <strong>Registrar NF-e</strong> — o pedido é faturado e a conta a receber é criada.</span>
          <Button size="sm" variant="outline" onClick={onIrConfig}>Ativar emissor</Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Cliente, vendedora ou nº do pedido..." className="h-11 pl-9" />
        </div>
        <Button variant="outline" size="icon" className="h-11 w-11" onClick={load} disabled={loading} aria-label="Atualizar"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></Button>
      </div>
      <div className="rounded-2xl border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div>
        ) : lista.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground"><Receipt className="h-8 w-8 mx-auto mb-2 opacity-40" />Nenhum pedido pronto para faturar.<p className="text-xs mt-1">Pedidos aparecem aqui quando o Estoque termina a separação.</p></div>
        ) : (
          <ul className="divide-y">
            {lista.map(p => {
              const pend = pendenciasCliente(p.clientes);
              const total = totalPedido(p);
              const qtd = p.pedido_itens.reduce((s, i) => s + i.quantidade, 0);
              return (
                <li key={p.id} className="p-4 flex flex-col md:flex-row md:items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{p.clientes?.nome ?? "Cliente"}</p>
                    <p className="text-xs text-muted-foreground">
                      Pedido #{p.id.slice(0, 8).toUpperCase()} · {fmtData(p.created_at)} · {p.vendedora_nome ?? "—"} · {qtd} peça{qtd !== 1 ? "s" : ""}
                    </p>
                    {emissor.ativo && pend.length > 0 && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Cadastro do cliente incompleto: {pend.join(", ")}</p>
                    )}
                  </div>
                  <div className="md:text-right">
                    <p className="text-lg font-bold tabular-nums">{formatBRL(total)}</p>
                    <p className="text-xs text-muted-foreground">{FORMAS_PAGAMENTO[p.forma_pagamento ?? ""] ?? "Pagamento não informado"}{(p.parcelas ?? 1) > 1 ? ` · ${p.parcelas}x` : ""}</p>
                  </div>
                  <div className="flex gap-2 md:w-auto">
                    {emissor.ativo && <Button className="h-10 gap-1.5 flex-1 md:flex-none" onClick={() => setEmitir(p)}><Send className="h-4 w-4" />Emitir NF-e</Button>}
                    <Button variant={emissor.ativo ? "outline" : "default"} className="h-10 gap-1.5 flex-1 md:flex-none" onClick={() => setRegistrar(p)}>
                      <FileUp className="h-4 w-4" />Registrar NF-e
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {emitir && <EmitirNotaDialog pedido={emitir} onClose={() => setEmitir(null)} onFeito={() => { setEmitir(null); load(); }} />}
      {registrar && (
        <RegistrarNotaDialog tipo="venda" pedidoId={registrar.id} valorSugerido={totalPedido(registrar)}
          titulo={`Pedido #${registrar.id.slice(0, 8).toUpperCase()} · ${registrar.clientes?.nome ?? ""}`}
          docEsperado={registrar.clientes?.documento ?? null}
          onClose={() => setRegistrar(null)} onFeito={() => { setRegistrar(null); load(); }} />
      )}
    </div>
  );
}

// ─── Emitir NF-e (emissor integrado) ────────────────────────────────────────

function EmitirNotaDialog({ pedido, onClose, onFeito }: { pedido: PedidoFaturar; onClose: () => void; onFeito: () => void }) {
  const [cliente, setCliente] = useState<ClienteFiscal | null>(pedido.clientes);
  const [natureza, setNatureza] = useState("");
  const [info, setInfo] = useState("");
  const [itens, setItens] = useState(() => pedido.pedido_itens.map(i => ({
    id: i.id, ncm: (i.stock_items?.devices?.ncm ?? "").replace(/\D/g, ""), cfop: i.stock_items?.devices?.cfop_padrao ?? "",
  })));
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string; problemas?: string[]; danfe?: string | null } | null>(null);
  const pend = pendenciasCliente(cliente);
  const total = totalPedido(pedido);

  useEffect(() => {
    supabase.from("fiscal_config").select("natureza_padrao,info_complementar").eq("id", 1).maybeSingle()
      .then(({ data }) => { if (data) { setNatureza(data.natureza_padrao ?? ""); setInfo(""); } });
  }, []);

  async function emitir() {
    setEnviando(true); setResultado(null);
    const r = await chamarEmissor({
      acao: "emitir_venda", pedidoId: pedido.id, natureza, informacoes: info,
      itens: itens.map(i => ({ id: i.id, ncm: i.ncm, cfop: i.cfop })),
    });
    setEnviando(false);
    if (r.ok && r.status === "autorizada") {
      toast.success(`NF-e ${r.numero ?? ""} autorizada.`);
      setResultado({ ok: true, texto: `NF-e nº ${r.numero ?? ""} autorizada pela SEFAZ.`, danfe: (r.danfe_url as string) ?? null });
    } else if (r.ok) {
      setResultado({ ok: true, texto: String(r.mensagem ?? "A SEFAZ está processando. Acompanhe em Notas emitidas.") });
    } else {
      setResultado({ ok: false, texto: r.erro ?? "Nota não autorizada.", problemas: r.problemas });
    }
  }

  return (
    <Dialog open onOpenChange={v => !v && !enviando && (resultado?.ok ? onFeito() : onClose())}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Send className="h-5 w-5 text-primary" />Emitir NF-e</DialogTitle>
          <DialogDescription>Pedido #{pedido.id.slice(0, 8).toUpperCase()} · {cliente?.nome} · {formatBRL(total)}</DialogDescription>
        </DialogHeader>

        {resultado ? (
          <div className={cn("rounded-2xl border p-4 space-y-2", resultado.ok ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5")}>
            <p className="font-semibold flex items-center gap-2">{resultado.ok ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <AlertTriangle className="h-5 w-5 text-red-600" />}{resultado.texto}</p>
            {resultado.problemas?.length ? <ul className="list-disc pl-6 text-sm space-y-0.5">{resultado.problemas.map(p => <li key={p}>{p}</li>)}</ul> : null}
            {resultado.danfe && <Button variant="outline" className="gap-1.5" onClick={() => window.open(resultado.danfe!, "_blank", "noopener")}><FileText className="h-4 w-4" />Abrir DANFE</Button>}
          </div>
        ) : (
          <>
            {pend.length > 0 ? (
              <CompletarCliente cliente={cliente} faltando={pend} onSalvo={setCliente} />
            ) : (
              <div className="rounded-xl border bg-muted/30 px-3 py-2.5 text-sm">
                <p className="font-medium">{cliente?.nome} · {mascaraDoc(cliente?.documento)}{cliente?.ie ? ` · IE ${cliente.ie}` : ""}</p>
                <p className="text-muted-foreground">{cliente?.logradouro}, {cliente?.numero} — {cliente?.bairro} — {cliente?.municipio}/{cliente?.uf} — CEP {cliente?.cep}</p>
              </div>
            )}
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Natureza da operação</span>
              <Input value={natureza} onChange={e => setNatureza(e.target.value.slice(0, 60))} className="h-11" />
            </label>
            <div className="rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2">Item</th><th className="px-3 py-2 w-28">NCM</th><th className="px-3 py-2 w-20">CFOP</th><th className="px-3 py-2 text-right">Valor</th>
                </tr></thead>
                <tbody>
                  {pedido.pedido_itens.map((i, idx) => (
                    <tr key={i.id} className="border-t">
                      <td className="px-3 py-2"><p className="font-medium">{i.stock_items?.devices?.model ?? "Peça"}</p><p className="text-xs text-muted-foreground">{i.quantidade} × {formatBRL(i.valor_unitario)}{i.lote ? ` · lote ${i.lote}` : ""}</p></td>
                      <td className="px-3 py-2"><Input value={itens[idx].ncm} inputMode="numeric" maxLength={8} aria-label="NCM"
                        onChange={e => setItens(v => v.map((x, j) => j === idx ? { ...x, ncm: e.target.value.replace(/\D/g, "") } : x))}
                        className={cn("h-9 font-mono text-xs", itens[idx].ncm.length !== 8 && "border-amber-500")} /></td>
                      <td className="px-3 py-2"><Input value={itens[idx].cfop} inputMode="numeric" maxLength={4} aria-label="CFOP"
                        onChange={e => setItens(v => v.map((x, j) => j === idx ? { ...x, cfop: e.target.value.replace(/\D/g, "") } : x))}
                        className="h-9 font-mono text-xs" /></td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatBRL(i.quantidade * i.valor_unitario)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t bg-muted/30 px-3 py-2 text-sm flex flex-wrap justify-end gap-x-4">
                {Number(pedido.desconto_pct) > 0 && <span className="text-muted-foreground">descontos já aplicados nos preços</span>}
                {Number(pedido.frete) > 0 && <span>Frete {formatBRL(pedido.frete)}</span>}
                <strong>Total {formatBRL(total)}</strong>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">O CFOP é ajustado sozinho para dentro/fora do estado. Lote, validade e registro ANVISA vão nas informações de cada item (rastreabilidade).</p>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Informações adicionais (opcional)</span>
              <Textarea value={info} onChange={e => setInfo(e.target.value.slice(0, 1000))} rows={2} placeholder="Ex.: pedido do cliente nº..." />
            </label>
          </>
        )}

        <DialogFooter className="gap-2">
          {resultado?.ok ? <Button onClick={onFeito}>Concluir</Button> : <>
            <Button variant="outline" onClick={onClose} disabled={enviando}>Cancelar</Button>
            <Button onClick={emitir} disabled={enviando || pend.length > 0 || itens.some(i => i.ncm.length !== 8 || i.cfop.length !== 4)} className="gap-1.5">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{enviando ? "Enviando à SEFAZ..." : resultado ? "Tentar de novo" : "Emitir NF-e"}
            </Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Completa o endereço/documento do cliente (CEP preenche o resto). */
function CompletarCliente({ cliente, faltando, onSalvo }: { cliente: ClienteFiscal | null; faltando: string[]; onSalvo: (c: ClienteFiscal) => void }) {
  const [f, setF] = useState({
    documento: cliente?.documento ?? "", ie: cliente?.ie ?? "", cep: cliente?.cep ?? "", logradouro: cliente?.logradouro ?? "",
    numero: cliente?.numero ?? "", bairro: cliente?.bairro ?? "", municipio: cliente?.municipio ?? "", uf: cliente?.uf ?? "", c_mun: cliente?.c_mun ?? "",
  });
  const [salvando, setSalvando] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);

  async function buscarCepCliente(cep: string) {
    if (cep.replace(/\D/g, "").length !== 8) return;
    setBuscandoCep(true);
    const e = await buscarCep(cep).catch(() => null);
    setBuscandoCep(false);
    if (e) setF(v => ({ ...v, logradouro: v.logradouro || e.logradouro, bairro: v.bairro || e.bairro, municipio: e.municipio || v.municipio, uf: e.uf || v.uf, c_mun: e.ibge || v.c_mun }));
  }

  async function salvar() {
    if (!cliente) return;
    let codMun = /^\d{7}$/.test(f.c_mun) ? f.c_mun : "";
    if (!codMun && f.municipio.trim() && f.uf.trim().length === 2) codMun = (await buscarCodigoIbge(f.municipio, f.uf).catch(() => null)) ?? "";
    const patch = {
      documento: f.documento.replace(/\D/g, "") || null, ie: f.ie.trim() || null, cep: f.cep.replace(/\D/g, "") || null,
      logradouro: f.logradouro.trim() || null, numero: f.numero.trim() || null, bairro: f.bairro.trim() || null,
      municipio: f.municipio.trim() || null, uf: f.uf.trim().toUpperCase() || null, c_mun: codMun || null,
    };
    setSalvando(true);
    const { error } = await supabase.from("clientes").update(patch).eq("id", cliente.id);
    setSalvando(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Cadastro do cliente atualizado.");
    onSalvo({ ...cliente, ...patch });
  }

  const input = (k: keyof typeof f, label: string, cls = "", props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className={cn("block space-y-1", cls)}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <Input value={f[k]} onChange={e => setF(v => ({ ...v, [k]: e.target.value }))} className="h-10" {...props} />
    </label>
  );
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-3">
      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Complete o cadastro do cliente para emitir (falta: {faltando.join(", ")})</p>
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
        {input("documento", "CPF/CNPJ", "col-span-2 sm:col-span-3", { inputMode: "numeric" })}
        {input("ie", "Inscrição estadual", "col-span-2 sm:col-span-3", { placeholder: "número ou ISENTO" })}
        <label className="block space-y-1 col-span-1 sm:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">CEP {buscandoCep && <Loader2 className="inline h-3 w-3 animate-spin" />}</span>
          <Input value={f.cep} inputMode="numeric" onChange={e => setF(v => ({ ...v, cep: e.target.value }))} onBlur={e => buscarCepCliente(e.target.value)} className="h-10" />
        </label>
        {input("logradouro", "Rua", "col-span-1 sm:col-span-3")}
        {input("numero", "Número", "col-span-1")}
        {input("bairro", "Bairro", "col-span-1 sm:col-span-2")}
        {input("municipio", "Cidade", "col-span-1 sm:col-span-3", { onChange: e => { const v = e.target.value; setF(p => ({ ...p, municipio: v, c_mun: "" })); } })}
        {input("uf", "UF", "col-span-1", { maxLength: 2 })}
      </div>
      <Button size="sm" onClick={salvar} disabled={salvando} className="gap-1.5">{salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Salvar cadastro</Button>
    </div>
  );
}

// ─── Registrar NF-e emitida em outro sistema ────────────────────────────────

export function RegistrarNotaDialog({ tipo, pedidoId, devolucaoId, valorSugerido, titulo, docEsperado, onClose, onFeito }: {
  tipo: "venda" | "devolucao" | "troca"; pedidoId?: string; devolucaoId?: string; valorSugerido: number; titulo: string;
  docEsperado?: string | null; onClose: () => void; onFeito: () => void;
}) {
  const [chave, setChave] = useState("");
  const [data, setData] = useState(hojeISO());
  const [valor, setValor] = useState(valorSugerido ? valorSugerido.toFixed(2).replace(".", ",") : "");
  const [protocolo, setProtocolo] = useState("");
  const [xml, setXml] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmaDiferenca, setConfirmaDiferenca] = useState(false);
  const xmlRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const chaveOk = chaveValida(chave);
  const valorNum = parseValor(valor);
  // Diferença acima de R$ 0,05 exige confirmação (ex.: nota com impostos/frete diferentes do pedido).
  const diferenca = valorSugerido > 0 && valorNum > 0 ? valorNum - valorSugerido : 0;
  const precisaConfirmar = Math.abs(diferenca) > 0.05 || !!aviso;
  const info = chaveOk ? lerChave(chave) : null;

  async function lerXml(file: File) {
    const txt = await file.text();
    const n = lerXmlNota(txt);
    if (!n) { toast.error("Não consegui ler esse XML de NF-e."); return; }
    setXml(file); setChave(n.chave);
    if (n.emitidaEm) setData(n.emitidaEm.slice(0, 10));
    if (n.valor) setValor(n.valor.toFixed(2).replace(".", ","));
    if (n.protocolo) setProtocolo(n.protocolo);
    const esperado = (docEsperado ?? "").replace(/\D/g, "");
    setAviso(esperado && n.destinatarioDoc && n.destinatarioDoc !== esperado
      ? `Atenção: o destinatário do XML (${mascaraDoc(n.destinatarioDoc)}) é diferente do cliente do pedido (${mascaraDoc(esperado)}).` : null);
    setConfirmaDiferenca(false);
  }

  async function salvar() {
    if (!chaveOk) { toast.error("Chave de acesso inválida."); return; }
    if (!(valorNum > 0)) { toast.error("Informe o valor da nota."); return; }
    if (precisaConfirmar && !confirmaDiferenca) { toast.error("Confira a diferença e marque a confirmação."); return; }
    setSalvando(true);
    try {
      const xmlPath = xml ? await enviarArquivoFiscal(xml, chave.replace(/\D/g, ""), "xml") : null;
      const pdfPath = pdf ? await enviarArquivoFiscal(pdf, chave.replace(/\D/g, ""), "pdf") : null;
      const { data: r, error } = await supabase.rpc("registrar_nf_externa", {
        p_tipo: tipo, p_pedido_id: pedidoId ?? null, p_devolucao_id: devolucaoId ?? null, p_chave: chave,
        p_emitida_em: new Date(`${data}T12:00:00`).toISOString(), p_valor: valorNum,
        p_xml_path: xmlPath, p_danfe_path: pdfPath, p_protocolo: protocolo || null,
      });
      if (error) throw error;
      const res = r as unknown as { ok: boolean; error?: string; numero?: number };
      if (!res.ok) { toast.error(res.error ?? "Não foi possível registrar."); return; }
      toast.success(`NF-e ${res.numero} registrada.${tipo === "venda" ? " Conta a receber criada." : ""}`);
      onFeito();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally { setSalvando(false); }
  }

  return (
    <Dialog open onOpenChange={v => !v && !salvando && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileUp className="h-5 w-5 text-primary" />Registrar NF-e emitida</DialogTitle>
          <DialogDescription>{titulo}</DialogDescription>
        </DialogHeader>
        <input ref={xmlRef} type="file" accept=".xml,application/xml,text/xml" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) lerXml(f); e.target.value = ""; }} />
        <input ref={pdfRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setPdf(f); e.target.value = ""; }} />
        <button type="button" onClick={() => xmlRef.current?.click()}
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) lerXml(f); }}
          className={cn("w-full rounded-2xl border-2 border-dashed px-4 py-5 text-center", xml ? "border-green-500/50 bg-green-500/5" : "hover:border-primary/50 hover:bg-muted/40")}>
          {xml ? <p className="text-sm font-medium text-green-700 dark:text-green-400"><CheckCircle2 className="inline h-4 w-4 mr-1" />{xml.name}</p> : <>
            <Upload className="mx-auto h-6 w-6 text-primary/70" />
            <p className="mt-1 text-sm font-semibold">Escolha ou arraste o XML da nota</p>
            <p className="text-xs text-muted-foreground">Preenche tudo sozinho e guarda o XML por 5 anos</p>
          </>}
        </button>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chave de acesso (44 números)</span>
          <Input value={formatarChave(chave)} onChange={e => setChave(e.target.value.replace(/\D/g, "").slice(0, 44))} inputMode="numeric"
            className={cn("h-11 font-mono text-sm", chave.length === 44 && !chaveOk && "border-red-500")} placeholder="0000 0000 0000 ..." />
          {info && <span className="text-xs text-muted-foreground">NF-e nº {info.numero} · série {info.serie} · modelo {info.modelo}</span>}
          {chave.length === 44 && !chaveOk && <span className="text-xs text-red-600">Chave inválida — confira os números.</span>}
        </label>
        {aviso && <p className="text-xs rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 px-3 py-2">{aviso}</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data de emissão</span>
            <Input type="date" value={data} onChange={e => setData(e.target.value)} className="h-11" /></label>
          <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Valor da nota (R$)</span>
            <Input value={valor} onChange={e => { setValor(e.target.value); setConfirmaDiferenca(false); }} inputMode="decimal" className={cn("h-11", Math.abs(diferenca) > 0.05 && "border-amber-500")} /></label>
        </div>
        {precisaConfirmar && (
          <label className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200 cursor-pointer">
            <input type="checkbox" className="mt-0.5 accent-amber-600" checked={confirmaDiferenca} onChange={e => setConfirmaDiferenca(e.target.checked)} />
            <span>
              {Math.abs(diferenca) > 0.05 && <>O valor da nota ({formatBRL(valorNum)}) está {diferenca > 0 ? "acima" : "abaixo"} do {tipo === "venda" ? "pedido" : "esperado"} ({formatBRL(valorSugerido)}) em {formatBRL(Math.abs(diferenca))}. </>}
              {aviso && <>O destinatário do XML não é o cliente do pedido. </>}
              Conferi e quero registrar assim mesmo{tipo === "venda" ? " — a conta a receber usa o valor da nota" : ""}.
            </span>
          </label>
        )}
        <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Protocolo de autorização (opcional)</span>
          <Input value={protocolo} onChange={e => setProtocolo(e.target.value.replace(/\D/g, "").slice(0, 20))} inputMode="numeric" className="h-11" /></label>
        <Button type="button" variant="outline" className="w-full gap-1.5" onClick={() => pdfRef.current?.click()}>
          <FileText className="h-4 w-4" />{pdf ? pdf.name : "Anexar DANFE em PDF (opcional)"}
        </Button>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando || !chaveOk || (precisaConfirmar && !confirmaDiferenca)} className="gap-1.5">{salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Notas emitidas ─────────────────────────────────────────────────────────

function NotasEmitidas({ emissor }: { emissor: EmissorStatus }) {
  const [notas, setNotas] = useState<NotaFiscal[]>([]);
  const [loading, setLoading] = useState(true);
  const [mes, setMes] = useState(mesISO());
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<"todas" | NotaFiscal["status"]>("todas");
  const [cancelar, setCancelar] = useState<NotaFiscal | null>(null);
  const [cce, setCce] = useState<NotaFiscal | null>(null);
  const [inutilizar, setInutilizar] = useState(false);
  const [atualizando, setAtualizando] = useState<string | null>(null);
  const anexoRef = useRef<{ nota: NotaFiscal; tipo: "xml" | "pdf" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const opcoesMes = useMemo(() => Array.from({ length: 24 }, (_, i) => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    const l = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    return { v: mesISO(d), l: l.charAt(0).toUpperCase() + l.slice(1) };
  }), []);

  const load = useCallback(async () => {
    setLoading(true);
    const ini = `${mes}-01`;
    const d = new Date(`${ini}T12:00:00`); d.setMonth(d.getMonth() + 1);
    const fim = hojeISO(d).slice(0, 7) + "-01";
    const { data, error } = await supabase.from("notas_fiscais").select("*")
      .or(`and(emitida_em.gte.${ini}T00:00:00-03:00,emitida_em.lt.${fim}T00:00:00-03:00),and(emitida_em.is.null,created_at.gte.${ini}T00:00:00-03:00,created_at.lt.${fim}T00:00:00-03:00)`)
      .order("emitida_em", { ascending: false, nullsFirst: true }).limit(1000);
    if (error) toast.error("Não foi possível carregar as notas.");
    setNotas((data ?? []) as unknown as NotaFiscal[]);
    setLoading(false);
  }, [mes]);
  useEffect(() => { load(); }, [load]);

  const lista = notas.filter(n => (status === "todas" || n.status === status) && (!busca.trim() ||
    `${n.numero ?? ""} ${n.destinatario_nome ?? ""} ${n.chave ?? ""}`.toLowerCase().includes(busca.trim().toLowerCase())));
  const autorizadasVenda = notas.filter(n => n.status === "autorizada" && n.tipo === "venda" && n.ambiente === 1);
  const totalMes = autorizadasVenda.reduce((s, n) => s + Number(n.valor_total ?? 0), 0);

  async function atualizar(n: NotaFiscal) {
    setAtualizando(n.id);
    const r = await chamarEmissor({ acao: "consultar", notaId: n.id });
    setAtualizando(null);
    if (!r.ok) toast.error(r.erro ?? "Falha ao consultar."); else toast.success(`Situação: ${String(r.status)}`);
    load();
  }
  async function abrir(path: string, nome?: string) {
    try { await abrirArquivoFiscal(path, nome); } catch { toast.error("Arquivo indisponível."); }
  }
  async function anexar(file: File) {
    const alvo = anexoRef.current; if (!alvo?.nota.chave) return;
    try {
      const path = await enviarArquivoFiscal(file, alvo.nota.chave, alvo.tipo);
      const { data, error } = await supabase.rpc("anexar_arquivo_nf", {
        p_nf_id: alvo.nota.id, p_xml_path: alvo.tipo === "xml" ? path : "", p_danfe_path: alvo.tipo === "pdf" ? path : "",
      });
      if (error || !(data as { ok: boolean })?.ok) throw error ?? new Error("falhou");
      toast.success("Arquivo anexado."); load();
    } catch (e) { toast.error(friendlyError(e)); }
  }
  function exportar() {
    baixarCsv(`notas-${mes}.csv`, ["Número", "Série", "Tipo", "Situação", "Emissão", "Destinatário", "CPF/CNPJ", "Valor", "Chave", "Origem"],
      lista.map(n => [n.numero, n.serie, TIPO_NF[n.tipo], STATUS_NF[n.status].label, fmtData(n.emitida_em), n.destinatario_nome,
        mascaraDoc(n.destinatario_doc), Number(n.valor_total ?? 0), n.chave, n.origem === "emissor" ? "Emissor" : "Registrada"]));
  }

  return (
    <div className="space-y-3">
      <input ref={fileRef} type="file" className="hidden" accept=".xml,.pdf" onChange={e => { const f = e.target.files?.[0]; if (f) anexar(f); e.target.value = ""; }} />
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="rounded-2xl border bg-card p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Faturado no mês</p><p className="mt-1 text-2xl font-bold tabular-nums">{formatBRL(totalMes)}</p></div>
        <div className="rounded-2xl border bg-card p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Notas de venda</p><p className="mt-1 text-2xl font-bold tabular-nums">{autorizadasVenda.length}</p></div>
        <div className="rounded-2xl border bg-card p-4 col-span-2 lg:col-span-1"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sem XML guardado</p>
          <p className={cn("mt-1 text-2xl font-bold tabular-nums", notas.some(n => n.status === "autorizada" && !n.xml_path) && "text-amber-600")}>{notas.filter(n => n.status === "autorizada" && !n.xml_path).length}</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={mes} onChange={e => setMes(e.target.value)} aria-label="Mês" className="h-11 rounded-xl border border-input bg-background px-3 text-sm">
          {opcoesMes.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value as typeof status)} aria-label="Situação" className="h-11 rounded-xl border border-input bg-background px-3 text-sm">
          <option value="todas">Todas as situações</option>
          {Object.entries(STATUS_NF).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Número, cliente ou chave..." className="h-11 pl-9" />
        </div>
        <Button variant="outline" size="icon" className="h-11 w-11" onClick={load} disabled={loading} aria-label="Atualizar"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></Button>
        <Button variant="outline" className="h-11 gap-1.5" onClick={exportar} disabled={!lista.length}><Download className="h-4 w-4" />Excel</Button>
        {emissor.ativo && <Button variant="outline" className="h-11" onClick={() => setInutilizar(true)}>Inutilizar números</Button>}
      </div>

      <div className="rounded-2xl border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div>
        ) : lista.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground"><FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />Nenhuma nota neste mês.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-semibold">Nota</th><th className="px-3 py-2.5 font-semibold">Destinatário</th>
                <th className="px-3 py-2.5 font-semibold">Emissão</th><th className="px-3 py-2.5 font-semibold text-right">Valor</th>
                <th className="px-3 py-2.5 font-semibold">Situação</th><th className="px-3 py-2.5 font-semibold text-right">Ações</th>
              </tr></thead>
              <tbody>
                {lista.map(n => (
                  <tr key={n.id} className="border-t align-middle">
                    <td className="px-3 py-2.5">
                      <p className="font-semibold tabular-nums">{n.numero ? `Nº ${n.numero}` : "—"}<span className="text-xs font-normal text-muted-foreground"> · série {n.serie ?? "—"}</span></p>
                      <p className="text-xs text-muted-foreground">{TIPO_NF[n.tipo]} · {n.origem === "emissor" ? "emissor" : "registrada"}{n.ambiente === 2 ? " · homologação" : ""}</p>
                    </td>
                    <td className="px-3 py-2.5"><p className="truncate max-w-[16rem]">{n.destinatario_nome ?? "—"}</p><p className="text-xs text-muted-foreground">{mascaraDoc(n.destinatario_doc)}</p></td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{fmtDataHora(n.emitida_em)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">{formatBRL(Number(n.valor_total ?? 0))}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", STATUS_NF[n.status].cls)}>{STATUS_NF[n.status].label}</span>
                      {n.status === "rejeitada" && n.mensagem && <p className="text-[11px] text-red-600 max-w-[16rem] line-clamp-2" title={n.mensagem}>{n.mensagem}</p>}
                      {n.eventos?.some(e => e.tipo === "carta_correcao") && <p className="text-[11px] text-muted-foreground">com carta de correção</p>}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        {n.danfe_url || n.danfe_path ? (
                          <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => n.danfe_url ? window.open(n.danfe_url, "_blank", "noopener") : abrir(n.danfe_path!)}><FileText className="h-3.5 w-3.5" />DANFE</Button>
                        ) : null}
                        {n.status === "processando" && (
                          <Button size="sm" variant="outline" className="h-8 gap-1" disabled={atualizando === n.id} onClick={() => atualizar(n)}>
                            {atualizando === n.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Atualizar
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Mais ações"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            {n.xml_path && <DropdownMenuItem onClick={() => abrir(n.xml_path!, `${n.chave}.xml`)}><Download className="h-4 w-4 mr-2" />Baixar XML</DropdownMenuItem>}
                            {n.chave && <DropdownMenuItem onClick={() => { navigator.clipboard?.writeText(n.chave!); toast.success("Chave copiada."); }}><ClipboardCopy className="h-4 w-4 mr-2" />Copiar chave</DropdownMenuItem>}
                            {n.chave && <DropdownMenuItem onClick={() => { navigator.clipboard?.writeText(n.chave!); window.open("https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ+gAVw2g=", "_blank", "noopener"); }}><ExternalLink className="h-4 w-4 mr-2" />Consultar na SEFAZ</DropdownMenuItem>}
                            {n.status === "autorizada" && n.chave && !n.xml_path && <DropdownMenuItem onClick={() => { anexoRef.current = { nota: n, tipo: "xml" }; fileRef.current?.click(); }}><Upload className="h-4 w-4 mr-2" />Anexar XML</DropdownMenuItem>}
                            {n.status === "autorizada" && n.chave && !n.danfe_path && !n.danfe_url && <DropdownMenuItem onClick={() => { anexoRef.current = { nota: n, tipo: "pdf" }; fileRef.current?.click(); }}><Upload className="h-4 w-4 mr-2" />Anexar DANFE (PDF)</DropdownMenuItem>}
                            {n.status === "autorizada" && <>
                              <DropdownMenuSeparator />
                              {n.origem === "emissor" && emissor.ativo && <DropdownMenuItem onClick={() => setCce(n)}><FilePen className="h-4 w-4 mr-2" />Carta de correção</DropdownMenuItem>}
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setCancelar(n)}><Ban className="h-4 w-4 mr-2" />Cancelar nota</DropdownMenuItem>
                            </>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {cancelar && <CancelarNotaDialog nota={cancelar} emissorAtivo={emissor.ativo} onClose={() => setCancelar(null)} onFeito={() => { setCancelar(null); load(); }} />}
      {cce && <CartaCorrecaoDialog nota={cce} onClose={() => setCce(null)} onFeito={() => { setCce(null); load(); }} />}
      {inutilizar && <InutilizarDialog onClose={() => setInutilizar(false)} />}
    </div>
  );
}

function CancelarNotaDialog({ nota, emissorAtivo, onClose, onFeito }: { nota: NotaFiscal; emissorAtivo: boolean; onClose: () => void; onFeito: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [protocolo, setProtocolo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const externa = nota.origem === "externa";
  const horas = nota.emitida_em ? (Date.now() - new Date(nota.emitida_em).getTime()) / 3600000 : 0;

  async function confirmar() {
    setEnviando(true);
    try {
      if (externa) {
        const { data, error } = await supabase.rpc("registrar_cancelamento_externo", { p_nf_id: nota.id, p_protocolo: protocolo || null, p_motivo: motivo });
        if (error) throw error;
        const r = data as { ok: boolean; error?: string };
        if (!r.ok) { toast.error(r.error ?? "Não foi possível."); return; }
      } else {
        if (!emissorAtivo) { toast.error("Emissor desativado."); return; }
        const r = await chamarEmissor({ acao: "cancelar", notaId: nota.id, justificativa: motivo });
        if (!r.ok) { toast.error(r.erro ?? "SEFAZ não aceitou o cancelamento."); return; }
      }
      toast.success(`NF-e ${nota.numero} cancelada.${nota.tipo === "venda" ? " O pedido voltou para \"pronto\" e as contas em aberto foram canceladas." : ""}`);
      onFeito();
    } catch (e) { toast.error(friendlyError(e)); } finally { setEnviando(false); }
  }

  return (
    <Dialog open onOpenChange={v => !v && !enviando && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Ban className="h-5 w-5 text-destructive" />Cancelar NF-e {nota.numero}</DialogTitle>
          <DialogDescription>{nota.destinatario_nome} · {formatBRL(Number(nota.valor_total ?? 0))}</DialogDescription>
        </DialogHeader>
        {externa && <p className="text-sm rounded-xl bg-muted/40 px-3 py-2">Esta nota foi emitida em outro sistema. <strong>Cancele primeiro lá</strong> (na SEFAZ) e registre aqui o protocolo do cancelamento.</p>}
        {horas > 24 && <p className="text-sm rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 px-3 py-2">Passaram mais de 24 h da emissão. Em SP o prazo normal de cancelamento é 24 h — fora dele a SEFAZ pode recusar (cancelamento extemporâneo). Consulte o contador.</p>}
        <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Motivo (mín. 15 caracteres)</span>
          <Textarea value={motivo} onChange={e => setMotivo(e.target.value.slice(0, 255))} rows={3} placeholder="Ex.: erro no valor dos itens, pedido cancelado pelo cliente" />
          <span className="text-xs text-muted-foreground">{motivo.trim().length}/15</span></label>
        {externa && <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Protocolo do cancelamento</span>
          <Input value={protocolo} onChange={e => setProtocolo(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="h-11" /></label>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={enviando}>Voltar</Button>
          <Button variant="destructive" onClick={confirmar} disabled={enviando || motivo.trim().length < 15} className="gap-1.5">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}Cancelar nota
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CartaCorrecaoDialog({ nota, onClose, onFeito }: { nota: NotaFiscal; onClose: () => void; onFeito: () => void }) {
  const anteriores = (nota.eventos ?? []).filter(e => e.tipo === "carta_correcao");
  const [texto, setTexto] = useState(anteriores.at(-1)?.texto ?? "");
  const [enviando, setEnviando] = useState(false);
  async function enviar() {
    setEnviando(true);
    const r = await chamarEmissor({ acao: "carta_correcao", notaId: nota.id, correcao: texto });
    setEnviando(false);
    if (!r.ok) { toast.error(r.erro ?? "Não aceita."); return; }
    toast.success("Carta de correção registrada."); onFeito();
  }
  return (
    <Dialog open onOpenChange={v => !v && !enviando && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FilePen className="h-5 w-5 text-primary" />Carta de correção · NF-e {nota.numero}</DialogTitle>
          <DialogDescription>Cada nova carta substitui a anterior — escreva todas as correções juntas.</DialogDescription>
        </DialogHeader>
        <p className="text-xs rounded-xl bg-muted/40 px-3 py-2">Não pode corrigir: valores, impostos, quantidade, preço, dados cadastrais que mudem o remetente/destinatário e data de emissão/saída.</p>
        <Textarea value={texto} onChange={e => setTexto(e.target.value.slice(0, 1000))} rows={5} placeholder="Ex.: Onde se lê 'Transportadora X', leia-se 'Transportadora Y'." />
        <p className="text-xs text-muted-foreground">{texto.trim().length}/1000 (mín. 15) · {anteriores.length} carta(s) já enviada(s) de 20 possíveis</p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={enviando}>Voltar</Button>
          <Button onClick={enviar} disabled={enviando || texto.trim().length < 15 || anteriores.length >= 20} className="gap-1.5">{enviando && <Loader2 className="h-4 w-4 animate-spin" />}Enviar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InutilizarDialog({ onClose }: { onClose: () => void }) {
  const [serie, setSerie] = useState("1");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [just, setJust] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function enviar() {
    setEnviando(true);
    const r = await chamarEmissor({ acao: "inutilizar", serie, inicio: Number(inicio), fim: Number(fim || inicio), justificativa: just });
    setEnviando(false);
    if (!r.ok) { toast.error(r.erro ?? "Não aceito."); return; }
    toast.success("Numeração inutilizada."); onClose();
  }
  return (
    <Dialog open onOpenChange={v => !v && !enviando && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Inutilizar numeração</DialogTitle>
          <DialogDescription>Para números pulados (nota não emitida). Faça até o dia 10 do mês seguinte.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <label className="block space-y-1"><span className="text-xs font-semibold text-muted-foreground">Série</span><Input value={serie} onChange={e => setSerie(e.target.value.replace(/\D/g, ""))} className="h-11" /></label>
          <label className="block space-y-1"><span className="text-xs font-semibold text-muted-foreground">Do nº</span><Input value={inicio} onChange={e => setInicio(e.target.value.replace(/\D/g, ""))} className="h-11" /></label>
          <label className="block space-y-1"><span className="text-xs font-semibold text-muted-foreground">Até o nº</span><Input value={fim} onChange={e => setFim(e.target.value.replace(/\D/g, ""))} className="h-11" /></label>
        </div>
        <Textarea value={just} onChange={e => setJust(e.target.value.slice(0, 255))} rows={2} placeholder="Justificativa (mín. 15 caracteres)" />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Voltar</Button>
          <Button onClick={enviar} disabled={enviando || !inicio || just.trim().length < 15}>{enviando && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Inutilizar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
