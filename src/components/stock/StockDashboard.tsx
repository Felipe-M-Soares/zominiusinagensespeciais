/**
 * StockDashboard — aba "Visão geral" do Estoque.
 *
 *  - KPIs clicáveis: saldo por fase, abaixo do mínimo, pedidos para separar
 *  - Ações rápidas grandes: Entrada, Retirada, Mover p/ Expedição, Separar pedido
 *  - Pesquisa geral (todas as fases, lotes e reservas)
 *  - Precisa de atenção (estoque baixo) + últimas movimentações
 *  - Distribuição da expedição por peça
 *
 * Os números vêm dos dados já carregados pela página (RPC load_stock_page) —
 * antes o painel refazia várias consultas pesadas por conta própria.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDownCircle, ArrowUpCircle, ChevronRight, ClipboardList,
  Package, ShoppingBag, Truck, Wrench,
} from "lucide-react";
import type { AllMovement, StockItem } from "@/hooks/useStock";
import { fetchAllMovements } from "@/hooks/useStock";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StockGlobalSearch } from "./StockGlobalSearch";
import { LIMITE_EXPEDICAO_BAIXA } from "./EstoqueDialogs";
import { FASE_CFG, abaixoDoMinimo, fmtDataHora, fmtNum, saldoUtil } from "./estoqueUi";
import type { ActiveView } from "./StockNav";

type QtyByFase = {
  intermediaria: number; expedicao: number; retrabalho: number;
  count_intermediaria: number; count_expedicao: number; count_retrabalho: number;
};

interface Props {
  items: StockItem[];
  qtyByFase: QtyByFase;
  loteMap: Map<string, number>;
  loading: boolean;
  pedidosParaSeparar: number;
  onIrPara: (v: ActiveView) => void;
  onEstoqueBaixo: () => void;
  onAcaoRapida: (a: "entrada" | "saida" | "transferir") => void;
  onAbrirItem: (i: StockItem) => void;
}

export function StockDashboard({
  items, qtyByFase, loteMap, loading, pedidosParaSeparar, onIrPara, onEstoqueBaixo, onAcaoRapida, onAbrirItem,
}: Props) {
  const [movements, setMovements] = useState<AllMovement[]>([]);
  const [movLoading, setMovLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchAllMovements(50).then(data => {
      if (cancelled) return;
      // Mostra só o que é do estoque: tira baixas de pedido comercial e de NF
      setMovements(data.filter(m => {
        const r = m.reason ?? "";
        return !r.startsWith("Pedido comercial") && !/^NF\s/i.test(r);
      }).slice(0, 8));
      setMovLoading(false);
    }).catch(() => { if (!cancelled) setMovLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const r = useMemo(() => {
    const porFase = (f: StockItem["fase"]) => items.filter(i => i.fase === f);
    const exp = porFase("expedicao");
    const soma = (arr: StockItem[], k: "quantity" | "quantity_reserved") => arr.reduce((s, i) => s + (i[k] ?? 0), 0);
    const lotesDe = (arr: StockItem[]) => arr.reduce((s, i) => s + (loteMap.get(i.id) ?? 0), 0);
    const abaixoMin = items.filter(abaixoDoMinimo);
    const expBaixa = exp.filter(i => i.quantity < LIMITE_EXPEDICAO_BAIXA);
    const topExp = [...exp].filter(i => i.quantity > 0).sort((a, b) => b.quantity - a.quantity).slice(0, 8);
    const atencao = [...abaixoMin, ...expBaixa.filter(i => !abaixoMin.includes(i))]
      .sort((a, b) => saldoUtil(a) - saldoUtil(b)).slice(0, 6);
    return {
      inter: { un: qtyByFase.intermediaria || soma(porFase("intermediaria"), "quantity"), tipos: qtyByFase.count_intermediaria || porFase("intermediaria").length, lotes: lotesDe(porFase("intermediaria")) },
      exp: { un: qtyByFase.expedicao || soma(exp, "quantity"), tipos: qtyByFase.count_expedicao || exp.length, lotes: lotesDe(exp), reservado: soma(exp, "quantity_reserved") },
      ret: { un: qtyByFase.retrabalho || soma(porFase("retrabalho"), "quantity"), tipos: qtyByFase.count_retrabalho || porFase("retrabalho").filter(i => i.quantity > 0).length, lotes: lotesDe(porFase("retrabalho")) },
      abaixoMin: abaixoMin.length,
      expBaixa: expBaixa.length,
      topExp,
      maxExp: Math.max(1, ...topExp.map(i => i.quantity)),
      atencao,
    };
  }, [items, qtyByFase, loteMap]);

  const pl = (n: number, s: string, p: string) => `${fmtNum(n)} ${n === 1 ? s : p}`;
  const itemPorId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

  if (loading && items.length === 0) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => <div key={i} className="rounded-2xl border bg-muted/30 h-24 animate-pulse" />)}
        </div>
        <div className="rounded-2xl border bg-muted/30 h-40 animate-pulse" />
      </div>
    );
  }

  const kpis: { id: string; l: string; v: number; sub: string; Icon: React.ElementType; cls: string; onClick: () => void; destaque?: boolean }[] = [
    { id: "inter", l: "Intermediário", v: r.inter.un, sub: `${pl(r.inter.tipos, "peça", "peças")} · ${pl(r.inter.lotes, "lote", "lotes")}`, Icon: FASE_CFG.intermediaria.Icon, cls: FASE_CFG.intermediaria.text, onClick: () => onIrPara("intermediaria") },
    { id: "exp", l: "Expedição", v: r.exp.un, sub: r.exp.reservado > 0 ? `${fmtNum(r.exp.reservado)} reservadas · ${pl(r.exp.lotes, "lote", "lotes")}` : `${pl(r.exp.tipos, "peça", "peças")} · ${pl(r.exp.lotes, "lote", "lotes")}`, Icon: FASE_CFG.expedicao.Icon, cls: FASE_CFG.expedicao.text, onClick: () => onIrPara("expedicao") },
    { id: "ret", l: "Retrabalho", v: r.ret.un, sub: `${pl(r.ret.tipos, "peça", "peças")} · ${pl(r.ret.lotes, "lote", "lotes")}`, Icon: FASE_CFG.retrabalho.Icon, cls: FASE_CFG.retrabalho.text, onClick: () => onIrPara("retrabalho") },
    { id: "baixo", l: "Abaixo do mínimo", v: r.abaixoMin, sub: `${fmtNum(r.expBaixa)} na expedição com < ${LIMITE_EXPEDICAO_BAIXA} un.`, Icon: AlertTriangle, cls: r.abaixoMin > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground", onClick: onEstoqueBaixo, destaque: r.abaixoMin > 0 },
    { id: "ped", l: "Pedidos para separar", v: pedidosParaSeparar, sub: pedidosParaSeparar > 0 ? "Aguardando o estoque" : "Nada pendente", Icon: ShoppingBag, cls: pedidosParaSeparar > 0 ? "text-blue-600 dark:text-blue-400" : "text-foreground", onClick: () => onIrPara("pedidos"), destaque: pedidosParaSeparar > 0 },
  ];

  const acoes: { l: string; d: string; Icon: React.ElementType; cls: string; onClick: () => void; badge?: number }[] = [
    { l: "Registrar entrada", d: "Chegou peça da produção", Icon: ArrowDownCircle, cls: "bg-primary/10 text-primary", onClick: () => onAcaoRapida("entrada") },
    { l: "Mover p/ Expedição", d: "Peça embalada e pronta", Icon: Truck, cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", onClick: () => onAcaoRapida("transferir") },
    { l: "Registrar retirada", d: "Saída da expedição", Icon: ArrowUpCircle, cls: "bg-red-500/10 text-red-600 dark:text-red-400", onClick: () => onAcaoRapida("saida") },
    { l: "Separar pedido", d: "Pedidos do Comercial", Icon: ClipboardList, cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400", onClick: () => onIrPara("pedidos"), badge: pedidosParaSeparar },
  ];

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kpis.map((k, idx) => (
          <button key={k.id} type="button" onClick={k.onClick}
            className={cn(
              "rounded-2xl border bg-card p-4 text-left transition-colors hover:bg-muted/40 active:scale-[0.99]",
              k.destaque && (k.id === "baixo" ? "border-amber-500/40" : "border-blue-500/40"),
              idx === kpis.length - 1 && "col-span-2 lg:col-span-1"
            )}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{k.l}</p>
              <k.Icon className={cn("h-4 w-4 shrink-0", k.cls)} />
            </div>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums", k.cls)}>{fmtNum(k.v)}</p>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{k.sub}</p>
          </button>
        ))}
      </div>

      {/* Ações rápidas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {acoes.map(a => (
          <button key={a.l} type="button" onClick={a.onClick}
            className="relative rounded-2xl border bg-card p-3 sm:p-4 flex items-center gap-3 text-left hover:bg-muted/40 active:scale-[0.99] min-h-[64px]">
            <span className={cn("h-10 w-10 sm:h-11 sm:w-11 rounded-xl flex items-center justify-center shrink-0", a.cls)}><a.Icon className="h-5 w-5" /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight">{a.l}</span>
              <span className="block text-xs text-muted-foreground leading-tight mt-0.5">{a.d}</span>
            </span>
            {!!a.badge && a.badge > 0 && (
              <span className="absolute top-2 right-2 min-w-[20px] h-5 px-1 rounded-full bg-blue-600 text-white text-[11px] font-bold inline-flex items-center justify-center">{a.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Pesquisa geral */}
      <section className="rounded-2xl border bg-card">
        <div className="px-4 py-3 border-b">
          <p className="text-sm font-semibold">Onde está a peça?</p>
          <p className="text-xs text-muted-foreground">Busca em todas as fases: saldo, lotes, localização, reservas e retrabalho.</p>
        </div>
        <div className="p-3 sm:p-4"><StockGlobalSearch /></div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Precisa de atenção */}
        <section className="rounded-2xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
            <p className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" />Precisa de atenção</p>
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={onEstoqueBaixo}>Ver tudo<ChevronRight className="h-3.5 w-3.5" /></Button>
          </div>
          {r.atencao.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma peça com estoque baixo.</p>
          ) : (
            <ul className="divide-y">
              {r.atencao.map(i => (
                <li key={i.id}>
                  <button type="button" onClick={() => onAbrirItem(i)} className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{i.device.model}</p>
                      <p className="text-xs text-muted-foreground">{FASE_CFG[i.fase].label}{i.min_quantity > 0 ? ` · mínimo ${fmtNum(i.min_quantity)}` : ""}</p>
                    </div>
                    <span className={cn("text-base font-bold tabular-nums", saldoUtil(i) === 0 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400")}>{fmtNum(saldoUtil(i))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Últimas movimentações */}
        <section className="rounded-2xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <p className="text-sm font-semibold flex items-center gap-2"><Activity className="h-4 w-4 text-muted-foreground" />Últimas movimentações</p>
          </div>
          {movLoading ? (
            <div className="p-4 space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-10 rounded-xl bg-muted/40 animate-pulse" />)}</div>
          ) : movements.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma movimentação registrada.</p>
          ) : (
            <ul className="divide-y">
              {movements.map(m => {
                const entrada = m.type === "entrada";
                const it = itemPorId.get(m.stock_item_id);
                return (
                  <li key={m.id}>
                    <button type="button" disabled={!it} onClick={() => it && onAbrirItem(it)}
                      className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-muted/40 disabled:hover:bg-transparent">
                      {entrada
                        ? <ArrowDownCircle className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        : <ArrowUpCircle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{m.device_model}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {FASE_CFG[m.fase].label}{m.lote ? ` · Lote ${m.lote}` : ""} · {m.user_display_name ?? "—"} · {fmtDataHora(m.created_at)}
                        </p>
                      </div>
                      <span className={cn("text-sm font-bold tabular-nums shrink-0", entrada ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
                        {entrada ? "+" : "−"}{fmtNum(m.quantity)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Distribuição da expedição */}
      {r.topExp.length > 0 && (
        <section className="rounded-2xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
            <p className="text-sm font-semibold flex items-center gap-2"><Package className="h-4 w-4 text-muted-foreground" />Maiores saldos na expedição</p>
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => onIrPara("expedicao")}>Abrir<ChevronRight className="h-3.5 w-3.5" /></Button>
          </div>
          <ul className="p-4 space-y-2.5">
            {r.topExp.map(i => (
              <li key={i.id}>
                <button type="button" onClick={() => onAbrirItem(i)} className="w-full text-left group">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate group-hover:underline">{i.device.model}</span>
                    <span className="font-semibold tabular-nums shrink-0">{fmtNum(i.quantity)} un.</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${Math.max(2, Math.round((i.quantity / r.maxExp) * 100))}%` }} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.ret.un > 0 && (
        <button type="button" onClick={() => onIrPara("retrabalho")}
          className="w-full rounded-2xl border border-orange-500/30 bg-orange-500/5 px-4 py-3 flex items-center gap-3 text-left hover:bg-orange-500/10">
          <Wrench className="h-5 w-5 text-orange-600 dark:text-orange-400 shrink-0" />
          <span className="text-sm flex-1"><strong>{fmtNum(r.ret.un)} un.</strong> em retrabalho aguardando conclusão.</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
