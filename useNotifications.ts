/**
 * RelatoriosEstoquePanel — Relatórios avançados de estoque
 * Giro de estoque, Curva ABC, Previsão de ruptura
 * Usa stock_items + stock_movements + devices (já existentes)
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { RefreshCw, Download, TrendingUp, AlertTriangle, BarChart3, Package } from "lucide-react";

interface ItemRelatorio {
  id: string;
  model: string;
  reference: string;
  fase: string;
  quantity: number;
  min_quantity: number;
  entradas: number;
  saidas: number;
  giro: number;        // saidas / max(quantity,1)
  diasRuptura: number; // quantity / (saidas/90) — dias até zerar
  valorEstoque: number;
  curvaABC: "A" | "B" | "C";
}

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function badge(cls: "A" | "B" | "C") {
  return cls === "A"
    ? "bg-primary/10 text-primary border-primary/30"
    : cls === "B"
    ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
    : "bg-muted/40 text-muted-foreground border-border/40";
}

type Vis = "abc" | "giro" | "ruptura";

export function RelatoriosEstoquePanel() {
  const [data, setData]       = useState<ItemRelatorio[]>([]);
  const [loading, setLoading] = useState(true);
  const [vis, setVis]         = useState<Vis>("abc");
  const [filtroABC, setFiltroABC] = useState<"todos" | "A" | "B" | "C">("todos");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Busca stock_items com device
      const { data: items, error: eItems } = await supabase
        .from("stock_items")
        .select("id,quantity,min_quantity,fase,device:devices(model,reference,preco_venda)")
        .in("fase", ["expedicao", "intermediaria"]);
      if (eItems) throw eItems;

      // Busca movimentos dos últimos 90 dias
      const since = new Date(Date.now() - 90 * 86400000).toISOString();
      const { data: movs, error: eMovs } = await supabase
        .from("stock_movements")
        .select("stock_item_id,type,quantity")
        .gte("created_at", since);
      if (eMovs) throw eMovs;

      // Agrega movimentos por item
      const movMap: Record<string, { entradas: number; saidas: number }> = {};
      for (const m of (movs ?? [])) {
        if (!movMap[m.stock_item_id]) movMap[m.stock_item_id] = { entradas: 0, saidas: 0 };
        if (m.type === "entrada") movMap[m.stock_item_id].entradas += m.quantity;
        if (m.type === "saida")   movMap[m.stock_item_id].saidas   += m.quantity;
      }

      // Monta relatorio
      const rows: ItemRelatorio[] = (items ?? []).map((item: any) => {
        const dev = Array.isArray(item.device) ? item.device[0] : item.device;
        const mv = movMap[item.id] ?? { entradas: 0, saidas: 0 };
        const preco = dev?.preco_venda ?? 0;
        const giro = item.quantity > 0 ? mv.saidas / item.quantity : mv.saidas > 0 ? 99 : 0;
        const saidaDia = mv.saidas / 90;
        const diasRuptura = saidaDia > 0 ? Math.floor(item.quantity / saidaDia) : 999;
        return {
          id: item.id,
          model: dev?.model ?? "—",
          reference: dev?.reference ?? "—",
          fase: item.fase,
          quantity: item.quantity,
          min_quantity: item.min_quantity,
          entradas: mv.entradas,
          saidas: mv.saidas,
          giro: Math.round(giro * 10) / 10,
          diasRuptura,
          valorEstoque: item.quantity * preco,
          curvaABC: "C", // será calculada abaixo
        };
      });

      // Curva ABC pelo valor de estoque (80/15/5)
      const sorted = [...rows].sort((a, b) => b.valorEstoque - a.valorEstoque);
      const totalVal = sorted.reduce((s, r) => s + r.valorEstoque, 0);
      let acum = 0;
      for (const r of sorted) {
        acum += r.valorEstoque;
        const pct = totalVal > 0 ? acum / totalVal : 1;
        r.curvaABC = pct <= 0.8 ? "A" : pct <= 0.95 ? "B" : "C";
      }

      setData(rows);
    } catch (err) {
      logger.error("RelatoriosEstoquePanel: erro", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const displayed = useMemo(() => {
    let rows = [...data];
    if (vis === "abc") {
      if (filtroABC !== "todos") rows = rows.filter(r => r.curvaABC === filtroABC);
      rows.sort((a, b) => b.valorEstoque - a.valorEstoque);
    } else if (vis === "giro") {
      rows.sort((a, b) => b.giro - a.giro);
    } else {
      // Ruptura — mostrar só os que têm saídas e estoque baixo
      rows = rows.filter(r => r.saidas > 0).sort((a, b) => a.diasRuptura - b.diasRuptura);
    }
    return rows.slice(0, 100);
  }, [data, vis, filtroABC]);

  const stats = useMemo(() => ({
    A: data.filter(r => r.curvaABC === "A").length,
    B: data.filter(r => r.curvaABC === "B").length,
    C: data.filter(r => r.curvaABC === "C").length,
    criticos: data.filter(r => r.diasRuptura < 30 && r.saidas > 0).length,
    valorTotal: data.reduce((s, r) => s + r.valorEstoque, 0),
  }), [data]);

  function exportCSV() {
    const header = "referencia,modelo,fase,estoque,min,entradas90d,saidas90d,giro,dias_ruptura,valor_estoque,curva_abc\n";
    const rows = displayed.map(r =>
      [r.reference,r.model,r.fase,r.quantity,r.min_quantity,r.entradas,r.saidas,r.giro,
       r.diasRuptura === 999 ? "∞" : r.diasRuptura, r.valorEstoque.toFixed(2),r.curvaABC].join(",")
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `relatorio-estoque-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "Curva A", val: stats.A, sub: "alto valor", color: "text-primary" },
          { label: "Curva B", val: stats.B, sub: "médio valor", color: "text-amber-600" },
          { label: "Curva C", val: stats.C, sub: "baixo valor", color: "text-muted-foreground" },
          { label: "< 30 dias", val: stats.criticos, sub: "risco de ruptura", color: stats.criticos > 0 ? "text-destructive" : "text-emerald-600" },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-border/40 bg-card p-3">
            <p className="text-[10px] text-muted-foreground">{k.label}</p>
            <p className={cn("text-xl font-black", k.color)}>{k.val}</p>
            <p className="text-[10px] text-muted-foreground">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs de visualização */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { id: "abc" as Vis, label: "Curva ABC", Icon: BarChart3 },
          { id: "giro" as Vis, label: "Giro de Estoque", Icon: TrendingUp },
          { id: "ruptura" as Vis, label: "Risco Ruptura", Icon: AlertTriangle },
        ]).map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setVis(id)}
            className={cn("h-8 px-3 rounded-lg text-[12px] font-medium border transition-colors flex items-center gap-1.5",
              vis === id ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-muted/40")}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
        {vis === "abc" && (
          <>
            <div className="w-px h-5 bg-border/40" />
            {(["todos","A","B","C"] as const).map(f => (
              <button key={f} onClick={() => setFiltroABC(f)}
                className={cn("h-8 px-3 rounded-lg text-[12px] font-medium border transition-colors",
                  filtroABC === f ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-muted/40")}>
                {f === "todos" ? "Todos" : `Classe ${f}`}
              </button>
            ))}
          </>
        )}
        <div className="ml-auto flex gap-2">
          <button onClick={load} className="h-8 w-8 flex items-center justify-center rounded-lg border border-input hover:bg-muted/40">
            <RefreshCw className={cn("h-3.5 w-3.5 text-muted-foreground", loading && "animate-spin")} />
          </button>
          <button onClick={exportCSV} className="h-8 px-3 rounded-lg border border-input text-[12px] flex items-center gap-1.5 hover:bg-muted/40">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      {/* Legenda */}
      {vis === "abc" && (
        <div className="rounded-xl bg-muted/20 border border-border/30 px-3 py-2 flex items-center gap-4 text-[10px] text-muted-foreground flex-wrap">
          <span className="font-semibold">Curva ABC:</span>
          <span><strong className="text-primary">A</strong> = 80% do valor total (alto giro/valor — prioridade máxima)</span>
          <span><strong className="text-amber-600">B</strong> = 15% do valor total (giro médio)</span>
          <span><strong className="text-muted-foreground">C</strong> = 5% do valor total (baixo giro)</span>
        </div>
      )}
      {vis === "giro" && (
        <div className="rounded-xl bg-muted/20 border border-border/30 px-3 py-2 text-[10px] text-muted-foreground">
          <strong>Giro</strong> = saídas nos últimos 90 dias ÷ estoque atual. Maior = produto mais rotativo.
        </div>
      )}
      {vis === "ruptura" && (
        <div className="rounded-xl bg-muted/20 border border-border/30 px-3 py-2 text-[10px] text-muted-foreground">
          <strong>Dias até ruptura</strong> = estoque atual ÷ média diária de saídas (90d). Apenas produtos com saídas registradas.
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-8">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Tabela */}
      {!loading && displayed.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
          <Package className="h-8 w-8 opacity-20" />
          <p className="text-sm">Nenhum dado encontrado</p>
        </div>
      )}

      {!loading && displayed.length > 0 && (
        <div className="rounded-xl border border-border/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/30 border-b border-border/40">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Referência</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground hidden sm:table-cell">Modelo</th>
                  <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Fase</th>
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Estoque</th>
                  {vis === "abc" && (
                    <>
                      <th className="text-right px-3 py-2 font-semibold text-muted-foreground hidden sm:table-cell">Valor</th>
                      <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Classe</th>
                    </>
                  )}
                  {vis === "giro" && (
                    <>
                      <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Saídas 90d</th>
                      <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Giro</th>
                    </>
                  )}
                  {vis === "ruptura" && (
                    <>
                      <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Saídas 90d</th>
                      <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Dias Ruptura</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {displayed.map((r, idx) => (
                  <tr key={r.id} className={cn("hover:bg-muted/20 transition-colors",
                    vis === "ruptura" && r.diasRuptura < 15 && "bg-red-500/5",
                    vis === "ruptura" && r.diasRuptura >= 15 && r.diasRuptura < 30 && "bg-amber-500/5",
                  )}>
                    <td className="px-3 py-2 font-mono font-medium">{r.reference}</td>
                    <td className="px-3 py-2 text-muted-foreground truncate max-w-[150px] hidden sm:table-cell">{r.model}</td>
                    <td className="px-3 py-2 text-center">
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-muted/40">
                        {r.fase === "expedicao" ? "Exp." : "Int."}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-bold">{r.quantity.toLocaleString("pt-BR")}</td>
                    {vis === "abc" && (
                      <>
                        <td className="px-3 py-2 text-right text-muted-foreground hidden sm:table-cell">{BRL(r.valorEstoque)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold border", badge(r.curvaABC))}>
                            {r.curvaABC}
                          </span>
                        </td>
                      </>
                    )}
                    {vis === "giro" && (
                      <>
                        <td className="px-3 py-2 text-right">{r.saidas.toLocaleString("pt-BR")}</td>
                        <td className="px-3 py-2 text-right font-bold">{r.giro}x</td>
                      </>
                    )}
                    {vis === "ruptura" && (
                      <>
                        <td className="px-3 py-2 text-right">{r.saidas.toLocaleString("pt-BR")}</td>
                        <td className={cn("px-3 py-2 text-right font-bold",
                          r.diasRuptura < 15 ? "text-destructive" :
                          r.diasRuptura < 30 ? "text-amber-600" : "text-foreground")}>
                          {r.diasRuptura >= 999 ? "∞" : `${r.diasRuptura}d`}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 border-t border-border/30 text-[10px] text-muted-foreground bg-muted/10">
            {displayed.length} items · Valor total em estoque: <strong>{BRL(stats.valorTotal)}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
