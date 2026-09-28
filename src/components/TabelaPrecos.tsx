/**
 * TabelaPrecos — tabela de preços compartilhada.
 *
 *  modo="comercial"  → só leitura, SEM custo e SEM margem (nem são buscados
 *                      do banco). É o que as vendedoras veem.
 *  modo="financeiro" → edição de custo, venda, desconto máx., margem mínima,
 *                      NCM, CFOP e IPI (dados fiscais usados na NF-e).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Pencil, Printer, RefreshCw, Search, Tag } from "lucide-react";
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

interface Peca {
  id: string; model: string; reference: string; internal_code: string | null;
  ncm: string | null; cfop_padrao: string | null; ipi_pct: number | null; unidade: string | null;
  preco_venda: number; desconto_max_pct: number; ativo: boolean; observacoes_preco: string | null;
  preco_custo?: number; margem_minima_pct?: number;
}

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const margemDe = (p: Peca) => p.preco_venda > 0 && p.preco_custo != null ? ((p.preco_venda - p.preco_custo) / p.preco_venda) * 100 : null;

export function TabelaPrecos({ modo = "comercial" }: { modo?: "comercial" | "financeiro" }) {
  const financeiro = modo === "financeiro";
  const [pecas, setPecas] = useState<Peca[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"ativas" | "sem_preco" | "margem_baixa" | "todas">("ativas");
  const [editando, setEditando] = useState<Peca | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const campos = "id,model,reference,internal_code,ncm,cfop_padrao,ipi_pct,unidade,preco_venda,desconto_max_pct,ativo,observacoes_preco"
      + (financeiro ? ",preco_custo,margem_minima_pct" : "");
    const todas: Peca[] = [];
    for (let de = 0; de < 50000; de += 1000) {
      const { data, error } = await supabase.from("devices").select(campos).order("model").range(de, de + 999);
      if (error) { toast.error(friendlyError(error)); break; }
      todas.push(...((data ?? []) as unknown as Peca[]));
      if ((data?.length ?? 0) < 1000) break;
    }
    setPecas(todas);
    setLoading(false);
  }, [financeiro]);
  useEffect(() => { load(); }, [load]);

  const lista = useMemo(() => {
    const termos = norm(busca.trim()).split(/\s+/).filter(Boolean);
    return pecas.filter(p => {
      if (filtro !== "todas" && !p.ativo) return false;
      if (filtro === "sem_preco" && p.preco_venda > 0) return false;
      if (filtro === "margem_baixa") { const m = margemDe(p); if (m == null || m >= (p.margem_minima_pct ?? 0)) return false; }
      if (!termos.length) return true;
      const alvo = norm(`${p.model} ${p.reference} ${p.internal_code ?? ""} ${p.ncm ?? ""}`);
      return termos.every(t => alvo.includes(t));
    });
  }, [pecas, busca, filtro]);

  const ativas = pecas.filter(p => p.ativo);
  const semPreco = ativas.filter(p => p.preco_venda <= 0).length;
  const comMargem = ativas.map(margemDe).filter((m): m is number => m != null);
  const margemMedia = comMargem.length ? comMargem.reduce((a, b) => a + b, 0) / comMargem.length : null;
  const margemBaixa = ativas.filter(p => { const m = margemDe(p); return m != null && m < (p.margem_minima_pct ?? 0); }).length;

  function exportar() {
    const cab = ["Peça", "Referência", "Código", "Unidade", "Preço de venda", "Desconto máx. %", "NCM"];
    if (financeiro) cab.push("Custo", "Margem %", "Margem mín. %", "CFOP", "IPI %");
    baixarCsv(`tabela-precos-${hojeISO()}.csv`, cab, lista.map(p => {
      const l: (string | number | null)[] = [p.model, p.reference, p.internal_code, p.unidade ?? "UN", p.preco_venda, p.desconto_max_pct, p.ncm];
      if (financeiro) l.push(p.preco_custo ?? 0, margemDe(p) ?? 0, p.margem_minima_pct ?? 0, p.cfop_padrao, p.ipi_pct ?? 0);
      return l;
    }));
  }

  function imprimir() {
    const linhas = lista.map(p => `<tr><td>${escHtml(p.model)}</td><td>${escHtml(p.reference)}</td>
      <td style="text-align:right">${escHtml(formatBRL(p.preco_venda))}</td><td style="text-align:center">${p.desconto_max_pct}%</td>
      ${financeiro ? `<td style="text-align:right">${escHtml(formatBRL(p.preco_custo ?? 0))}</td><td style="text-align:center">${margemDe(p)?.toFixed(1) ?? "—"}%</td>` : ""}</tr>`).join("");
    const w = window.open("", "_blank");
    if (!w) { toast.error("Permita pop-ups para imprimir."); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Tabela de preços</title>
      <style>body{font:11px Arial;padding:16px}table{width:100%;border-collapse:collapse}th,td{padding:5px 8px;border-bottom:1px solid #eee;text-align:left}th{font-size:9px;text-transform:uppercase;color:#555}</style>
      </head><body><h2 style="margin:0 0 4px">Tabela de preços</h2><p style="color:#666;margin:0 0 12px">${new Date().toLocaleString("pt-BR")} · ${lista.length} peças</p>
      <table><thead><tr><th>Peça</th><th>Referência</th><th style="text-align:right">Venda</th><th style="text-align:center">Desc. máx.</th>
      ${financeiro ? '<th style="text-align:right">Custo</th><th style="text-align:center">Margem</th>' : ""}</tr></thead><tbody>${linhas}</tbody></table>
      <script>window.print()</script></body></html>`);
    w.document.close();
  }

  const kpis = financeiro
    ? [
        { l: "Peças ativas", v: String(ativas.length) },
        { l: "Sem preço", v: String(semPreco), alerta: semPreco > 0 },
        { l: "Margem média", v: margemMedia == null ? "—" : `${margemMedia.toFixed(1).replace(".", ",")}%` },
        { l: "Abaixo da margem mín.", v: String(margemBaixa), alerta: margemBaixa > 0 },
      ]
    : [
        { l: "Peças ativas", v: String(ativas.length) },
        { l: "Sem preço", v: String(semPreco), alerta: semPreco > 0 },
      ];

  return (
    <div className="space-y-4">
      <div className={cn("grid gap-3", financeiro ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2")}>
        {kpis.map(k => (
          <div key={k.l} className="rounded-2xl border bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{k.l}</p>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums", k.alerta && "text-amber-600")}>{k.v}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome, referência, código ou NCM..." className="h-11 pl-9" />
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl border bg-muted/40 p-1" role="radiogroup" aria-label="Filtro">
          {([["ativas", "Ativas"], ["sem_preco", "Sem preço"], ...(financeiro ? [["margem_baixa", "Margem baixa"]] : []), ["todas", "Todas"]] as [typeof filtro, string][]).map(([id, l]) => (
            <button key={id} type="button" role="radio" aria-checked={filtro === id} onClick={() => setFiltro(id)}
              className={cn("h-9 px-3 rounded-lg text-sm font-medium", filtro === id ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>{l}</button>
          ))}
        </div>
        <Button variant="outline" size="icon" className="h-11 w-11" onClick={load} disabled={loading} aria-label="Atualizar"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></Button>
        <Button variant="outline" className="h-11 gap-1.5" onClick={exportar} disabled={!lista.length}><FileSpreadsheet className="h-4 w-4" />Excel</Button>
        <Button variant="outline" className="h-11 gap-1.5" onClick={imprimir} disabled={!lista.length}><Printer className="h-4 w-4" />Imprimir</Button>
      </div>

      <div className="rounded-2xl border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div>
        ) : lista.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground"><Tag className="h-8 w-8 mx-auto mb-2 opacity-40" />Nenhuma peça encontrada.</div>
        ) : (
          <>
            {/* Celular */}
            <ul className="md:hidden divide-y">
              {lista.slice(0, 300).map(p => {
                const m = margemDe(p);
                return (
                  <li key={p.id} className={cn("p-4 flex items-start justify-between gap-3", !p.ativo && "opacity-60")}>
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{p.model}</p>
                      <p className="text-xs text-muted-foreground truncate">{p.reference}{p.internal_code && p.internal_code !== p.reference ? ` · ${p.internal_code}` : ""}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Desc. máx. {p.desconto_max_pct}%{financeiro && m != null ? ` · margem ${m.toFixed(1)}%` : ""}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={cn("font-bold tabular-nums", p.preco_venda > 0 ? "" : "text-amber-600")}>{p.preco_venda > 0 ? formatBRL(p.preco_venda) : "Sem preço"}</p>
                      {financeiro && <p className="text-xs text-muted-foreground tabular-nums">custo {formatBRL(p.preco_custo ?? 0)}</p>}
                      {financeiro && <Button size="sm" variant="ghost" className="h-8 mt-1 gap-1" onClick={() => setEditando(p)}><Pencil className="h-3.5 w-3.5" />Editar</Button>}
                    </div>
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
                  {financeiro && <>
                    <th className="px-3 py-2.5 font-semibold text-right">Custo</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Margem</th>
                    <th className="px-3 py-2.5 font-semibold">NCM / CFOP / IPI</th>
                    <th className="px-3 py-2.5" />
                  </>}
                  {!financeiro && <th className="px-3 py-2.5 font-semibold">Unid.</th>}
                </tr></thead>
                <tbody>
                  {lista.map(p => {
                    const m = margemDe(p);
                    const baixa = m != null && m < (p.margem_minima_pct ?? 0);
                    return (
                      <tr key={p.id} className={cn("border-t", !p.ativo && "opacity-60")}>
                        <td className="px-3 py-2.5"><p className="font-medium">{p.model}</p><p className="text-xs text-muted-foreground">{p.reference}{p.internal_code && p.internal_code !== p.reference ? ` · ${p.internal_code}` : ""}{!p.ativo ? " · inativa" : ""}</p></td>
                        <td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", p.preco_venda <= 0 && "text-amber-600")}>{p.preco_venda > 0 ? formatBRL(p.preco_venda) : "Sem preço"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{p.desconto_max_pct}%</td>
                        {financeiro && <>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatBRL(p.preco_custo ?? 0)}</td>
                          <td className={cn("px-3 py-2.5 text-right tabular-nums font-medium", baixa ? "text-red-600" : "text-green-700 dark:text-green-400")}>
                            {m == null ? "—" : `${m.toFixed(1).replace(".", ",")}%`}{baixa && <AlertTriangle className="inline h-3.5 w-3.5 ml-1 -mt-0.5" />}
                          </td>
                          <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground">{p.ncm || "—"} · {p.cfop_padrao || "—"} · {p.ipi_pct ?? 0}%</td>
                          <td className="px-3 py-2.5 text-right"><Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => setEditando(p)}><Pencil className="h-3.5 w-3.5" />Editar</Button></td>
                        </>}
                        {!financeiro && <td className="px-3 py-2.5 text-muted-foreground">{p.unidade ?? "UN"}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {financeiro && (
        <p className="text-xs text-muted-foreground">NCM, CFOP e IPI daqui são usados na emissão da NF-e. O custo e a margem aparecem só no Financeiro — a tabela do Comercial mostra apenas o preço de venda.</p>
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
        <DialogHeader>
          <DialogTitle>{peca.model}</DialogTitle>
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
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.ativo} onChange={e => setF(v => ({ ...v, ativo: e.target.checked }))} className="h-4 w-4" />
          Peça ativa (aparece para venda)
        </label>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando} className="gap-1.5">{salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
