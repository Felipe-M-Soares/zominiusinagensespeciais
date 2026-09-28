/**
 * Aba Histórico do Comercial: todos os pedidos com filtro por período,
 * cliente, vendedora (admin/gerente) e situação; totais do filtro, exportação
 * para Excel (CSV) e, no celular, lista em cards. Clique abre o pedido.
 * O antigo "Histórico geral" (movimentações da expedição) segue acessível
 * pelo botão "Movimentações".
 */
import { useMemo, useState } from "react";
import { ChevronRight, FileSpreadsheet, History, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { baixarCsv, hojeISO } from "@/lib/financeiro";
import { FORMAS_PGTO_PEDIDO, SITUACAO_PEDIDO, STATUS_VENDA, pedidoAtrasado, totalPedido, type PedidoCompleto } from "@/types/comercial";

export type SituacaoFiltro = "todas" | "vendas" | "atrasados" | PedidoCompleto["status"];
export interface FiltroHistorico {
  de: string;
  ate: string;
  situacao: SituacaoFiltro;
  /** chave da vendedora (id ou "nome:<nome>"); "" = todas */
  vendedora: string;
  cliente: string;
}

export const chaveVendedora = (p: Pick<PedidoCompleto, "vendedora_id" | "vendedora_nome">) =>
  p.vendedora_id ?? `nome:${p.vendedora_nome ?? "—"}`;

const iso = (d: Date) => hojeISO(d);
export function periodoRapido(tipo: "mes" | "mes_passado" | "90d" | "ano" | "tudo"): { de: string; ate: string } {
  const h = new Date();
  if (tipo === "mes") return { de: iso(new Date(h.getFullYear(), h.getMonth(), 1)), ate: "" };
  if (tipo === "mes_passado") return { de: iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), ate: iso(new Date(h.getFullYear(), h.getMonth(), 0)) };
  if (tipo === "90d") { const d = new Date(h); d.setDate(d.getDate() - 90); return { de: iso(d), ate: "" }; }
  if (tipo === "ano") return { de: iso(new Date(h.getFullYear(), 0, 1)), ate: "" };
  return { de: "", ate: "" };
}

export const FILTRO_HISTORICO_PADRAO: FiltroHistorico = { ...periodoRapido("90d"), situacao: "todas", vendedora: "", cliente: "" };

const COR: Record<string, string> = {
  pendente: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  separando: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  pronto: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  faturado: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  enviado: "bg-teal-500/10 text-teal-700 dark:text-teal-400",
  cancelado: "bg-muted text-muted-foreground",
  retorno: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
};

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const LIMITE = 100;

interface Props {
  pedidos: PedidoCompleto[];
  loading: boolean;
  verTudo: boolean;
  /** Pedidos da própria vendedora (quando não é admin/gerente). */
  meus: (p: PedidoCompleto) => boolean;
  inicial: FiltroHistorico;
  onAbrirPedido: (p: PedidoCompleto) => void;
  onMovimentacoes: () => void;
}

export function HistoricoPanel({ pedidos, loading, verTudo, meus, inicial, onAbrirPedido, onMovimentacoes }: Props) {
  const [f, setF] = useState<FiltroHistorico>(inicial);
  const [limite, setLimite] = useState(LIMITE);
  const set = (p: Partial<FiltroHistorico>) => { setF(v => ({ ...v, ...p })); setLimite(LIMITE); };

  const base = useMemo(() => verTudo ? pedidos : pedidos.filter(meus), [pedidos, verTudo, meus]);

  const vendedoras = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pedidos) m.set(chaveVendedora(p), p.vendedora_nome ?? "Sem vendedora");
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [pedidos]);

  const lista = useMemo(() => {
    const termos = semAcento(f.cliente.trim()).split(/\s+/).filter(Boolean);
    const agora = new Date();
    return base.filter(p => {
      const dia = p.created_at.slice(0, 10);
      if (f.de && dia < f.de) return false;
      if (f.ate && dia > f.ate) return false;
      if (f.vendedora && chaveVendedora(p) !== f.vendedora) return false;
      if (f.situacao === "vendas" && !STATUS_VENDA.includes(p.status)) return false;
      if (f.situacao === "atrasados" && !pedidoAtrasado(p, agora)) return false;
      if (f.situacao === "enviado" && !["faturado", "enviado"].includes(p.status)) return false;
      if (!["todas", "vendas", "atrasados", "enviado"].includes(f.situacao) && p.status !== f.situacao) return false;
      if (termos.length) {
        const alvo = semAcento(`${p.cliente_nome} ${p.id.slice(0, 8)} ${p.nota_fiscal ?? ""}`);
        if (!termos.every(t => alvo.includes(t))) return false;
      }
      return true;
    });
  }, [base, f]);

  const resumo = useMemo(() => {
    const validos = lista.filter(p => p.status !== "cancelado");
    return {
      total: validos.reduce((s, p) => s + totalPedido(p), 0),
      pecas: validos.reduce((s, p) => s + p.itens.reduce((si, i) => si + i.quantidade, 0), 0),
    };
  }, [lista]);

  function exportar() {
    baixarCsv(`pedidos-comercial-${hojeISO()}.csv`,
      ["Data", "Pedido", "Cliente", "Vendedora", "Situação", "NF", "Pagamento", "Parcelas", "Peças", "Frete", "Total"],
      lista.map(p => [
        new Date(p.created_at).toLocaleDateString("pt-BR"), p.id.slice(0, 8).toUpperCase(), p.cliente_nome, p.vendedora_nome ?? "",
        SITUACAO_PEDIDO[p.status] ?? p.status, p.nota_fiscal ?? "", p.forma_pagamento ? FORMAS_PGTO_PEDIDO[p.forma_pagamento] ?? p.forma_pagamento : "",
        p.parcelas ?? 1, p.itens.reduce((s, i) => s + i.quantidade, 0), p.frete ?? 0, totalPedido(p),
      ]));
  }

  const rapidos: [Parameters<typeof periodoRapido>[0], string][] = [["mes", "Este mês"], ["mes_passado", "Mês passado"], ["90d", "90 dias"], ["ano", "Este ano"], ["tudo", "Tudo"]];
  const rapidoAtivo = rapidos.find(([t]) => { const r = periodoRapido(t); return r.de === f.de && r.ate === f.ate; })?.[0];
  const temFiltro = f.situacao !== "todas" || !!f.vendedora || !!f.cliente;
  const selectCls = "h-11 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-0";

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border bg-card p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[12rem]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input value={f.cliente} onChange={e => set({ cliente: e.target.value })} placeholder="Cliente, nº do pedido ou NF..." className="h-11 pl-9" aria-label="Buscar no histórico" />
          </div>
          <select value={f.situacao} onChange={e => set({ situacao: e.target.value as SituacaoFiltro })} className={cn(selectCls, "flex-1 basis-0 sm:basis-auto sm:flex-none")} aria-label="Situação">
            <option value="todas">Todas as situações</option>
            <option value="vendas">Vendas (confirmados)</option>
            <option value="atrasados">Atrasados</option>
            {(["pendente", "separando", "pronto", "enviado", "retorno", "cancelado"] as const).map(s => (
              <option key={s} value={s}>{s === "enviado" ? "Faturados / enviados" : SITUACAO_PEDIDO[s]}</option>
            ))}
          </select>
          {verTudo && (
            <select value={f.vendedora} onChange={e => set({ vendedora: e.target.value })} className={cn(selectCls, "flex-1 basis-0 sm:basis-auto sm:flex-none")} aria-label="Vendedora">
              <option value="">Todas as vendedoras</option>
              {vendedoras.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {rapidos.map(([t, l]) => (
            <button key={t} type="button" onClick={() => set(periodoRapido(t))} aria-pressed={rapidoAtivo === t}
              className={cn("h-9 px-3 rounded-full text-sm font-medium border whitespace-nowrap",
                rapidoAtivo === t ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:border-primary/40")}>{l}</button>
          ))}
          <div className="flex items-center gap-1.5 text-sm w-full sm:w-auto sm:ml-1">
            <input type="date" value={f.de} onChange={e => set({ de: e.target.value })} aria-label="De" className="h-9 flex-1 sm:flex-none min-w-0 rounded-lg border border-input bg-background px-2 text-sm" />
            <span className="text-muted-foreground shrink-0">até</span>
            <input type="date" value={f.ate} onChange={e => set({ ate: e.target.value })} aria-label="Até" className="h-9 flex-1 sm:flex-none min-w-0 rounded-lg border border-input bg-background px-2 text-sm" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm"><strong className="tabular-nums">{lista.length}</strong> pedido{lista.length !== 1 ? "s" : ""} · <strong className="tabular-nums">{formatBRL(resumo.total)}</strong> · {resumo.pecas.toLocaleString("pt-BR")} peças
          {lista.some(p => p.status === "cancelado") && <span className="text-muted-foreground"> (cancelados fora da soma)</span>}</p>
        <div className="flex items-center gap-2 ml-auto">
          {temFiltro && <Button variant="ghost" className="h-10 gap-1" onClick={() => set({ situacao: "todas", vendedora: "", cliente: "" })}><X className="h-4 w-4" />Limpar</Button>}
          <Button variant="outline" className="h-10 gap-1.5" onClick={exportar} disabled={!lista.length}><FileSpreadsheet className="h-4 w-4" />Excel</Button>
          <Button variant="outline" className="h-10 gap-1.5" onClick={onMovimentacoes} title="Entradas e saídas da expedição"><History className="h-4 w-4" />Movimentações</Button>
        </div>
      </div>

      <div className="rounded-2xl border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando pedidos...</div>
        ) : lista.length === 0 ? (
          <div className="py-14 px-6 text-center space-y-3">
            <History className="h-10 w-10 text-muted-foreground/30 mx-auto" />
            <p className="font-medium">Nenhum pedido neste filtro</p>
            <p className="text-sm text-muted-foreground">Tente outro período ou limpe os filtros.</p>
            <Button variant="outline" onClick={() => set({ ...periodoRapido("tudo"), situacao: "todas", vendedora: "", cliente: "" })}>Ver todos os pedidos</Button>
          </div>
        ) : (
          <>
            {/* Celular */}
            <ul className="md:hidden divide-y">
              {lista.slice(0, limite).map(p => {
                const pecas = p.itens.reduce((s, i) => s + i.quantidade, 0);
                const atras = pedidoAtrasado(p);
                return (
                  <li key={p.id}>
                    <button type="button" onClick={() => onAbrirPedido(p)} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/40 active:bg-muted">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-start gap-2">
                          <p className="font-medium truncate flex-1">{p.cliente_nome}</p>
                          <p className={cn("font-semibold tabular-nums shrink-0", p.status === "cancelado" && "line-through text-muted-foreground")}>{formatBRL(totalPedido(p))}</p>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {new Date(p.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })} · #{p.id.slice(0, 8).toUpperCase()} · {pecas} pç{verTudo && p.vendedora_nome ? ` · ${p.vendedora_nome}` : ""}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", COR[p.status])}>{SITUACAO_PEDIDO[p.status]}</span>
                          {p.nota_fiscal && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">NF {p.nota_fiscal}</span>}
                          {atras && <span className="rounded-full bg-red-500/10 text-red-700 dark:text-red-400 px-2 py-0.5 text-xs font-medium">atrasado</span>}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {/* Computador */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2.5 font-semibold">Data</th>
                  <th className="px-3 py-2.5 font-semibold">Cliente</th>
                  {verTudo && <th className="px-3 py-2.5 font-semibold">Vendedora</th>}
                  <th className="px-3 py-2.5 font-semibold">Situação</th>
                  <th className="px-3 py-2.5 font-semibold">Pagamento</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Peças</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Total</th>
                </tr></thead>
                <tbody>
                  {lista.slice(0, limite).map(p => {
                    const atras = pedidoAtrasado(p);
                    return (
                      <tr key={p.id} className="border-t hover:bg-muted/40 cursor-pointer" onClick={() => onAbrirPedido(p)}>
                        <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{new Date(p.created_at).toLocaleDateString("pt-BR")}<p className="text-xs text-muted-foreground">#{p.id.slice(0, 8).toUpperCase()}</p></td>
                        <td className="px-3 py-2.5 max-w-[22rem]">
                          <button type="button" className="font-medium truncate block max-w-full text-left hover:underline" onClick={e => { e.stopPropagation(); onAbrirPedido(p); }}>{p.cliente_nome}</button>
                          {p.nota_fiscal && <p className="text-xs text-muted-foreground">NF {p.nota_fiscal}</p>}
                        </td>
                        {verTudo && <td className="px-3 py-2.5 text-muted-foreground">{p.vendedora_nome ?? "—"}</td>}
                        <td className="px-3 py-2.5">
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", COR[p.status])}>{SITUACAO_PEDIDO[p.status]}</span>
                          {atras && <span className="ml-1 rounded-full bg-red-500/10 text-red-700 dark:text-red-400 px-2 py-0.5 text-xs font-medium">atrasado</span>}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{p.forma_pagamento ? `${FORMAS_PGTO_PEDIDO[p.forma_pagamento] ?? p.forma_pagamento}${(p.parcelas ?? 1) > 1 ? ` ${p.parcelas}x` : ""}` : "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{p.itens.reduce((s, i) => s + i.quantidade, 0)}</td>
                        <td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", p.status === "cancelado" && "line-through text-muted-foreground")}>{formatBRL(totalPedido(p))}</td>
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
    </div>
  );
}
