/**
 * TabelaPrecos — tabela de preços compartilhada.
 *
 *  modo="comercial"  → só leitura, SEM custo e SEM margem (nem são buscados
 *                      do banco). É o que as vendedoras veem.
 *  modo="financeiro" → edição de custo, venda, desconto máx., margem mínima,
 *                      NCM, CFOP e IPI (dados fiscais usados na NF-e).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Pencil, Printer, RefreshCw, Search, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { escHtml } from "@/lib/escHtml";
import { friendlyError } from "@/lib/errorMessages";
import { baixarCsv, hojeISO, parseValor } from "@/lib/financeiro";
import { carregarCatalogoVenda } from "@/lib/catalogoVenda";

interface Peca {
  id: string; model: string; reference: string; internal_code: string | null;
  ncm: string | null; cfop_padrao: string | null; ipi_pct: number | null; unidade: string | null;
  preco_venda: number; desconto_max_pct: number; ativo: boolean; observacoes_preco: string | null;
  preco_custo?: number; margem_minima_pct?: number;
}

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const margemDe = (p: Peca) => p.preco_venda > 0 && p.preco_custo != null ? ((p.preco_venda - p.preco_custo) / p.preco_venda) * 100 : null;

type Filtro = "ativas" | "com_saldo" | "sem_preco" | "margem_baixa" | "todas";
type Ordem = "nome" | "preco_asc" | "preco_desc";
interface Saldo { disp: number; prod: number }
const LIMITE = 150;
const pct = (v: number) => `${String(Math.round(v * 10) / 10).replace(".", ",")}%`;
const precoMin = (p: Peca) => p.preco_venda * (1 - (p.desconto_max_pct ?? 0) / 100);

export function TabelaPrecos({ modo = "comercial" }: { modo?: "comercial" | "financeiro" }) {
  const financeiro = modo === "financeiro";
  const [pecas, setPecas] = useState<Peca[]>([]);
  const [saldos, setSaldos] = useState<Map<string, Saldo> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("ativas");
  const [ordem, setOrdem] = useState<Ordem>("nome");
  const [limite, setLimite] = useState(LIMITE);
  const [editando, setEditando] = useState<Peca | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Modo comercial: custo e margem NÃO são buscados do banco.
    const campos = "id,model,reference,internal_code,ncm,cfop_padrao,ipi_pct,unidade,preco_venda,desconto_max_pct,ativo,observacoes_preco"
      + (financeiro ? ",preco_custo,margem_minima_pct" : "");
    const todas: Peca[] = [];
    for (let de = 0; de < 50000; de += 1000) {
      const { data, error } = await supabase.from("devices").select(campos).order("model").range(de, de + 999);
      if (error) { toast.error(friendlyError(error)); break; }
      todas.push(...((data ?? []) as unknown as Peca[]));
      if ((data?.length ?? 0) < 1000) break;
    }
    setPecas(todas.map(p => ({ ...p, preco_venda: Number(p.preco_venda ?? 0), desconto_max_pct: Number(p.desconto_max_pct ?? 0) })));
    setLoading(false);
    // Saldo na expedição (só para a vendedora; se falhar, a tabela funciona sem essa coluna).
    if (!financeiro) {
      carregarCatalogoVenda()
        .then(cat => setSaldos(new Map(cat.map(c => [c.device_id, { disp: c.disponivel_total, prod: c.em_producao }]))))
        .catch(() => setSaldos(null));
    }
  }, [financeiro]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setLimite(LIMITE); }, [busca, filtro, ordem]);

  const lista = useMemo(() => {
    const termos = norm(busca.trim()).split(/\s+/).filter(Boolean);
    const f = pecas.filter(p => {
      if (filtro !== "todas" && !p.ativo) return false;
      if (filtro === "sem_preco" && p.preco_venda > 0) return false;
      if (filtro === "com_saldo" && !((saldos?.get(p.id)?.disp ?? 0) > 0)) return false;
      if (filtro === "margem_baixa") { const m = margemDe(p); if (m == null || m >= (p.margem_minima_pct ?? 0)) return false; }
      if (!termos.length) return true;
      const alvo = norm(`${p.model} ${p.reference} ${p.internal_code ?? ""} ${p.ncm ?? ""}`);
      return termos.every(t => alvo.includes(t));
    });
    if (ordem === "preco_asc") f.sort((a, b) => a.preco_venda - b.preco_venda);
    else if (ordem === "preco_desc") f.sort((a, b) => b.preco_venda - a.preco_venda);
    return f;
  }, [pecas, busca, filtro, ordem, saldos]);

  const ativas = pecas.filter(p => p.ativo);
  const semPreco = ativas.filter(p => p.preco_venda <= 0).length;
  const comMargem = ativas.map(margemDe).filter((m): m is number => m != null);
  const margemMedia = comMargem.length ? comMargem.reduce((a, b) => a + b, 0) / comMargem.length : null;
  const margemBaixa = ativas.filter(p => { const m = margemDe(p); return m != null && m < (p.margem_minima_pct ?? 0); }).length;
  const comSaldo = saldos ? ativas.filter(p => (saldos.get(p.id)?.disp ?? 0) > 0).length : null;

  function exportar() {
    const cab = ["Peça", "Referência", "Código", "Unidade", "Preço de venda", "Desconto máx. %", "Preço mínimo", "NCM"];
    if (financeiro) cab.push("Custo", "Margem %", "Margem mín. %", "CFOP", "IPI %");
    else if (saldos) cab.push("Disponível na expedição");
    baixarCsv(`tabela-precos-${hojeISO()}.csv`, cab, lista.map(p => {
      const l: (string | number | null)[] = [p.model, p.reference, p.internal_code, p.unidade ?? "UN", p.preco_venda, p.desconto_max_pct, precoMin(p), p.ncm];
      if (financeiro) l.push(p.preco_custo ?? 0, margemDe(p) ?? 0, p.margem_minima_pct ?? 0, p.cfop_padrao, p.ipi_pct ?? 0);
      else if (saldos) l.push(saldos.get(p.id)?.disp ?? 0);
      return l;
    }));
  }

  function imprimir() {
    const linhas = lista.map(p => `<tr><td>${escHtml(p.model)}</td><td>${escHtml(p.reference)}</td>
      <td style="text-align:right">${escHtml(formatBRL(p.preco_venda))}</td><td style="text-align:center">${p.desconto_max_pct}%</td>
      <td style="text-align:right">${escHtml(formatBRL(precoMin(p)))}</td>
      ${financeiro ? `<td style="text-align:right">${escHtml(formatBRL(p.preco_custo ?? 0))}</td><td style="text-align:center">${margemDe(p)?.toFixed(1) ?? "—"}%</td>` : ""}</tr>`).join("");
    const w = window.open("", "_blank");
    if (!w) { toast.error("Permita pop-ups para imprimir."); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Tabela de preços</title>
      <style>body{font:11px Arial;padding:16px}table{width:100%;border-collapse:collapse}th,td{padding:5px 8px;border-bottom:1px solid #eee;text-align:left}th{font-size:9px;text-transform:uppercase;color:#555}</style>
      </head><body><h2 style="margin:0 0 4px">Tabela de preços</h2><p style="color:#666;margin:0 0 12px">${new Date().toLocaleString("pt-BR")} · ${lista.length} peças</p>
      <table><thead><tr><th>Peça</th><th>Referência</th><th style="text-align:right">Venda</th><th style="text-align:center">Desc. máx.</th><th style="text-align:right">Preço mín.</th>
      ${financeiro ? '<th style="text-align:right">Custo</th><th style="text-align:center">Margem</th>' : ""}</tr></thead><tbody>${linhas}</tbody></table>
      <script>window.print()</script></body></html>`);
    w.document.close();
  }

  const kpis: { l: string; v: string; alerta?: boolean; f?: Filtro }[] = financeiro
    ? [
        { l: "Peças ativas", v: String(ativas.length), f: "ativas" },
        { l: "Sem preço", v: String(semPreco), alerta: semPreco > 0, f: "sem_preco" },
        { l: "Margem média", v: margemMedia == null ? "—" : pct(margemMedia) },
        { l: "Abaixo da margem mín.", v: String(margemBaixa), alerta: margemBaixa > 0, f: "margem_baixa" },
      ]
    : [
        { l: "Peças ativas", v: String(ativas.length), f: "ativas" },
        ...(comSaldo != null ? [{ l: "Com saldo p/ vender", v: String(comSaldo), f: "com_saldo" as Filtro }] : []),
        { l: "Sem preço", v: String(semPreco), alerta: semPreco > 0, f: "sem_preco" },
      ];

  const filtros: [Filtro, string][] = [["ativas", "Ativas"], ...(!financeiro && saldos ? [["com_saldo", "Com saldo"] as [Filtro, string]] : []), ["sem_preco", "Sem preço"], ...(financeiro ? [["margem_baixa", "Margem baixa"] as [Filtro, string]] : []), ["todas", "Todas"]];
  const saldoDe = (p: Peca) => saldos?.get(p.id);

  return (
    <div className="space-y-4">
      <div className={cn("grid gap-3", financeiro ? "grid-cols-2 lg:grid-cols-4" : kpis.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {kpis.map(k => (
          <button key={k.l} type="button" disabled={!k.f} onClick={() => k.f && setFiltro(k.f)}
            className={cn("text-left rounded-2xl border bg-card p-3 sm:p-4 min-w-0 transition", k.f && "hover:border-primary/40 hover:shadow-sm", k.f && filtro === k.f && "border-primary/50 ring-1 ring-primary/20")}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground leading-tight line-clamp-2">{k.l}</p>
            <p className={cn("mt-1 text-xl sm:text-2xl font-bold tabular-nums", k.alerta && "text-amber-600 dark:text-amber-400")}>{k.v}</p>
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[12rem]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Nome, referência, código ou NCM..." className="h-11 pl-9 pr-9" aria-label="Buscar peça" />
            {busca && (
              <button type="button" onClick={() => setBusca("")} aria-label="Limpar busca" className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            )}
          </div>
          <select value={ordem} onChange={e => setOrdem(e.target.value as Ordem)} aria-label="Ordenar"
            className="h-11 flex-1 sm:flex-none rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="nome">Nome A–Z</option>
            <option value="preco_asc">Menor preço</option>
            <option value="preco_desc">Maior preço</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 overflow-x-auto rounded-xl border bg-muted/40 p-1 max-w-full" role="radiogroup" aria-label="Filtro">
            {filtros.map(([id, l]) => (
              <button key={id} type="button" role="radio" aria-checked={filtro === id} onClick={() => setFiltro(id)}
                className={cn("h-9 px-3 rounded-lg text-sm font-medium whitespace-nowrap", filtro === id ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>{l}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="outline" size="icon" className="h-10 w-10" onClick={load} disabled={loading} aria-label="Atualizar" title="Atualizar"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></Button>
            <Button variant="outline" className="h-10 gap-1.5" onClick={exportar} disabled={!lista.length}><FileSpreadsheet className="h-4 w-4" />Excel</Button>
            <Button variant="outline" className="h-10 gap-1.5" onClick={imprimir} disabled={!lista.length}><Printer className="h-4 w-4" /><span className="hidden sm:inline">Imprimir</span></Button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div>
        ) : lista.length === 0 ? (
          <div className="py-14 px-6 text-center space-y-3">
            <Tag className="h-8 w-8 mx-auto opacity-30" />
            <p className="text-sm text-muted-foreground">{busca ? "Nenhuma peça encontrada com essa busca." : "Nenhuma peça neste filtro."}</p>
            {(busca || filtro !== "ativas") && <Button variant="outline" onClick={() => { setBusca(""); setFiltro("ativas"); }}>Limpar filtros</Button>}
          </div>
        ) : (
          <>
            {/* Celular */}
            <ul className="md:hidden divide-y">
              {lista.slice(0, limite).map(p => {
                const m = margemDe(p);
                const baixa = m != null && m < (p.margem_minima_pct ?? 0);
                const sd = saldoDe(p);
                const Linha = financeiro ? "button" : "div";
                return (
                  <li key={p.id}>
                    <Linha {...(financeiro ? { type: "button" as const, onClick: () => setEditando(p), "aria-label": `Editar preço de ${p.model}` } : {})}
                      className={cn("w-full text-left p-4 flex items-start justify-between gap-3", !p.ativo && "opacity-60", financeiro && "hover:bg-muted/40 active:bg-muted")}>
                      <div className="min-w-0 space-y-1">
                        <p className="font-semibold leading-snug">{p.model}</p>
                        <p className="text-xs text-muted-foreground truncate">{p.reference}{p.internal_code && p.internal_code !== p.reference ? ` · ${p.internal_code}` : ""}{!p.ativo ? " · inativa" : ""}</p>
                        <div className="flex flex-wrap gap-1.5 text-xs">
                          {p.desconto_max_pct > 0 && <span className="rounded-full bg-muted px-2 py-0.5">desc. até {p.desconto_max_pct}%</span>}
                          {financeiro && m != null && <span className={cn("rounded-full px-2 py-0.5", baixa ? "bg-red-500/10 text-red-700 dark:text-red-400 font-medium" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400")}>margem {pct(m)}</span>}
                          {sd && (sd.disp > 0
                            ? <span className="rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2 py-0.5">{sd.disp.toLocaleString("pt-BR")} na expedição</span>
                            : <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">sem saldo{sd.prod > 0 ? ` · ${sd.prod.toLocaleString("pt-BR")} em produção` : ""}</span>)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn("font-bold tabular-nums", p.preco_venda <= 0 && "text-amber-600 dark:text-amber-400")}>{p.preco_venda > 0 ? formatBRL(p.preco_venda) : "Sem preço"}</p>
                        {p.preco_venda > 0 && p.desconto_max_pct > 0 && <p className="text-xs text-muted-foreground tabular-nums">mín. {formatBRL(precoMin(p))}</p>}
                        {financeiro && <p className="text-xs text-muted-foreground tabular-nums">custo {formatBRL(p.preco_custo ?? 0)}</p>}
                        {financeiro && <span className="inline-flex items-center gap-1 text-xs text-primary font-medium mt-1"><Pencil className="h-3 w-3" />Editar</span>}
                      </div>
                    </Linha>
                  </li>
                );
              })}
            </ul>
            {/* Computador */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2.5 font-semibold">Peça</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Preço de venda</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Desc. máx.</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Preço mín.</th>
                  {financeiro && <>
                    <th className="px-3 py-2.5 font-semibold text-right">Custo</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Margem</th>
                    <th className="px-3 py-2.5 font-semibold">NCM / CFOP / IPI</th>
                    <th className="px-3 py-2.5" />
                  </>}
                  {!financeiro && <>
                    {saldos && <th className="px-3 py-2.5 font-semibold text-right">Expedição</th>}
                    <th className="px-3 py-2.5 font-semibold">Unid.</th>
                  </>}
                </tr></thead>
                <tbody>
                  {lista.slice(0, limite).map(p => {
                    const m = margemDe(p);
                    const baixa = m != null && m < (p.margem_minima_pct ?? 0);
                    const sd = saldoDe(p);
                    return (
                      <tr key={p.id} className={cn("border-t hover:bg-muted/30", !p.ativo && "opacity-60")}>
                        <td className="px-3 py-2.5"><p className="font-medium">{p.model}</p><p className="text-xs text-muted-foreground">{p.reference}{p.internal_code && p.internal_code !== p.reference ? ` · ${p.internal_code}` : ""}{!p.ativo ? " · inativa" : ""}{p.observacoes_preco ? ` · ${p.observacoes_preco}` : ""}</p></td>
                        <td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", p.preco_venda <= 0 && "text-amber-600 dark:text-amber-400")}>{p.preco_venda > 0 ? formatBRL(p.preco_venda) : "Sem preço"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{p.desconto_max_pct}%</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{p.preco_venda > 0 ? formatBRL(precoMin(p)) : "—"}</td>
                        {financeiro && <>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatBRL(p.preco_custo ?? 0)}</td>
                          <td className={cn("px-3 py-2.5 text-right tabular-nums font-medium", baixa ? "text-red-600" : "text-green-700 dark:text-green-400")}>
                            {m == null ? "—" : pct(m)}{baixa && <AlertTriangle className="inline h-3.5 w-3.5 ml-1 -mt-0.5" />}
                          </td>
                          <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground">{p.ncm || "—"} · {p.cfop_padrao || "—"} · {p.ipi_pct ?? 0}%</td>
                          <td className="px-3 py-2.5 text-right"><Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => setEditando(p)}><Pencil className="h-3.5 w-3.5" />Editar</Button></td>
                        </>}
                        {!financeiro && <>
                          {saldos && <td className="px-3 py-2.5 text-right tabular-nums">{sd && sd.disp > 0 ? <span className="text-emerald-700 dark:text-emerald-400 font-medium">{sd.disp.toLocaleString("pt-BR")}</span> : <span className="text-muted-foreground" title={sd && sd.prod > 0 ? `${sd.prod} em produção` : undefined}>0{sd && sd.prod > 0 ? ` (+${sd.prod.toLocaleString("pt-BR")} prod.)` : ""}</span>}</td>}
                          <td className="px-3 py-2.5 text-muted-foreground">{p.unidade ?? "UN"}</td>
                        </>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {lista.length > limite && (
              <div className="border-t p-3 text-center">
                <Button variant="outline" className="h-10" onClick={() => setLimite(l => l + LIMITE)}>Mostrar mais ({lista.length - limite} restantes)</Button>
              </div>
            )}
          </>
        )}
      </div>
      {financeiro ? (
        <p className="text-xs text-muted-foreground">NCM, CFOP e IPI daqui são usados na emissão da NF-e. O custo e a margem aparecem só no Financeiro — a tabela do Comercial mostra apenas o preço de venda.</p>
      ) : (
        <p className="text-xs text-muted-foreground">Preço mínimo = preço de venda com o desconto máximo permitido. Preços são definidos pelo Financeiro.</p>
      )}
      {editando && <EditarPrecoDialog peca={editando} onClose={() => setEditando(null)} onSalvo={p => { setPecas(prev => prev.map(x => x.id === p.id ? p : x)); setEditando(null); }} />}
    </div>
  );
}

function EditarPrecoDialog({ peca, onClose, onSalvo }: { peca: Peca; onClose: () => void; onSalvo: (p: Peca) => void }) {
  const [f, setF] = useState({
    venda: peca.preco_venda ? String(peca.preco_venda).replace(".", ",") : "",
    custo: peca.preco_custo ? String(peca.preco_custo).replace(".", ",") : "",
    desc: String(peca.desconto_max_pct ?? 0), margem: String(peca.margem_minima_pct ?? 0),
    ncm: peca.ncm ?? "", cfop: peca.cfop_padrao ?? "5101", ipi: String(peca.ipi_pct ?? 0), unidade: peca.unidade ?? "UN",
    ativo: peca.ativo, obs: peca.observacoes_preco ?? "",
  });
  const [salvando, setSalvando] = useState(false);
  const venda = parseValor(f.venda), custo = parseValor(f.custo);
  const margem = venda > 0 ? ((venda - custo) / venda) * 100 : null;

  async function salvar() {
    if (f.ncm && !/^\d{8}$/.test(f.ncm)) { toast.error("NCM deve ter 8 números."); return; }
    if (!/^\d{4}$/.test(f.cfop)) { toast.error("CFOP deve ter 4 números."); return; }
    const payload = {
      preco_venda: venda, preco_custo: custo,
      desconto_max_pct: Math.min(100, Math.max(0, parseValor(f.desc))), margem_minima_pct: Math.min(100, Math.max(0, parseValor(f.margem))),
      ncm: f.ncm, cfop_padrao: f.cfop, ipi_pct: Math.max(0, parseValor(f.ipi)), unidade: f.unidade.trim().toUpperCase() || "UN",
      ativo: f.ativo, observacoes_preco: f.obs.trim() || null,
    };
    setSalvando(true);
    const { error } = await supabase.from("devices").update(payload).eq("id", peca.id);
    setSalvando(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Preço salvo.");
    onSalvo({ ...peca, ...payload });
  }

  const campo = (label: string, k: keyof typeof f, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="space-y-1.5 block">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <Input value={f[k] as string} onChange={e => setF(v => ({ ...v, [k]: e.target.value }))} className="h-11" {...props} />
    </label>
  );

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader className="text-left">
          <DialogTitle className="pr-6">{peca.model}</DialogTitle>
          <DialogDescription>{peca.reference}{peca.internal_code ? ` · ${peca.internal_code}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {campo("Preço de venda (R$)", "venda", { inputMode: "decimal", placeholder: "0,00" })}
          {campo("Custo (R$)", "custo", { inputMode: "decimal", placeholder: "0,00" })}
          {campo("Desconto máx. (%)", "desc", { inputMode: "decimal" })}
          {campo("Margem mínima (%)", "margem", { inputMode: "decimal" })}
        </div>
        <p className={cn("text-sm rounded-xl px-3 py-2 bg-muted/40", margem != null && margem < parseValor(f.margem) && "bg-red-500/10 text-red-700 dark:text-red-400")}>
          Margem com esses valores: <strong>{margem == null ? "—" : `${margem.toFixed(1).replace(".", ",")}%`}</strong>
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {campo("NCM", "ncm", { inputMode: "numeric", maxLength: 8 })}
          {campo("CFOP", "cfop", { inputMode: "numeric", maxLength: 4 })}
          {campo("IPI (%)", "ipi", { inputMode: "decimal" })}
          {campo("Unidade", "unidade", { maxLength: 6 })}
        </div>
        {campo("Observação", "obs", { maxLength: 120 })}
        <label className="flex items-center gap-2 text-sm min-h-10">
          <input type="checkbox" checked={f.ativo} onChange={e => setF(v => ({ ...v, ativo: e.target.checked }))} className="h-4 w-4" />
          Peça ativa (aparece para venda)
        </label>
        <DialogFooter className="gap-2 flex-row">
          <Button variant="outline" className="flex-1 sm:flex-none h-11" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando} className="flex-1 sm:flex-none h-11 gap-1.5">{salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
