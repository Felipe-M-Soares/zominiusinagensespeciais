import { Package, AlertTriangle, TrendingDown, Wrench, ArrowDownCircle, ArrowUpCircle, Truck, Activity, PackageCheck, X } from "lucide-react";
import type { StockItem, AllMovement } from "@/hooks/useStock";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { fetchAllMovements } from "@/hooks/useStock";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  items: StockItem[];
  loading: boolean;
}

interface KpiCardProps {
  icon: React.ElementType;
  label: string;
  value: number | string;
  color: string;
  bg: string;
  border: string;
  description?: string;
  onClick?: () => void;
}

function KpiCard({ icon: Icon, label, value, color, bg, border, description, onClick }: KpiCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4 flex items-start gap-3 transition-colors",
        bg, border,
        onClick && "cursor-pointer hover:brightness-110"
      )}
      onClick={onClick}
    >
      <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", bg)}>
        <Icon className={cn("h-5 w-5", color)} />
      </div>
      <div>
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <p className={cn("text-2xl font-bold tabular-nums", color)}>{value}</p>
        {description && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{description}</p>}
      </div>
    </div>
  );
}

interface PecaBaixoEstoque {
  model: string;
  reference: string;
  quantity: number;
}

export function StockDashboard({ items, loading }: Props) {
  const [movements, setMovements] = useState<AllMovement[]>([]);
  const [movLoading, setMovLoading] = useState(true);
  const [pedidosPendentes, setPedidosPendentes] = useState(0);
  const [totalExpedicao, setTotalExpedicao] = useState(0);
  const [totalTipos, setTotalTipos] = useState(0);
  const [tiposBaixo, setTiposBaixo] = useState(0);
  const [lotesRetrabalho, setLotesRetrabalho] = useState(0);
  const [pecasBaixo, setPecasBaixo] = useState<PecaBaixoEstoque[]>([]);
  const [showBaixoModal, setShowBaixoModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMovLoading(true);
    fetchAllMovements(10).then(data => {
      if (!cancelled) { setMovements(data); setMovLoading(false); }
    }).catch(() => { if (!cancelled) setMovLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    async function loadAll() {
      // 1. Pedidos separando (em separação ativa)
      supabase
        .from("pedidos_comerciais")
        .select("id", { count: "exact", head: true })
        .eq("status", "separando")
        .then(({ count }) => setPedidosPendentes(count ?? 0));

      // 2. Totais por fase + peças expedição com estoque baixo
      const PAGE_SIZE = 1000;
      let allRows: { device_id: string; quantity: number; fase: string }[] = [];
      let page = 0;
      while (true) {
        const { data, error } = await supabase
          .from("stock_items")
          .select("device_id, quantity, fase")
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (error || !data || data.length === 0) break;
        allRows = allRows.concat(data as { device_id: string; quantity: number; fase: string }[]);
        if (data.length < PAGE_SIZE) break;
        page++;
      }

      if (allRows.length) {
        const tiposSet = new Set<string>();
        const expByDevice = new Map<string, number>();
        let exped = 0;

        for (const row of allRows) {
          tiposSet.add(row.device_id);
          if (row.fase === "expedicao") {
            exped += row.quantity;
            expByDevice.set(row.device_id, (expByDevice.get(row.device_id) ?? 0) + row.quantity);
          }
        }

        const deviceIdsBaixo = Array.from(expByDevice.entries())
          .filter(([, q]) => q > 0 && q < 100)
          .map(([id]) => id);

        setTotalExpedicao(exped);
        setTotalTipos(tiposSet.size);
        setTiposBaixo(deviceIdsBaixo.length);

        if (deviceIdsBaixo.length > 0) {
          const { data: devs } = await supabase
            .from("devices")
            .select("id, model, reference")
            .in("id", deviceIdsBaixo);
          if (devs) {
            const lista: PecaBaixoEstoque[] = (devs as { id: string; model: string; reference: string }[]).map(d => ({
              model: d.model,
              reference: d.reference,
              quantity: expByDevice.get(d.id) ?? 0,
            })).sort((a, b) => a.quantity - b.quantity);
            setPecasBaixo(lista);
          }
        } else {
          setPecasBaixo([]);
        }
      }

      // 3. Lotes em retrabalho — lotes com saldo > 0 nos stock_items de fase retrabalho
      const { data: retrabItems } = await supabase
        .from("stock_items")
        .select("id, quantity")
        .eq("fase", "retrabalho")
        .gt("quantity", 0);

      if (retrabItems && retrabItems.length > 0) {
        const retrabIds = (retrabItems as { id: string }[]).map(r => r.id);
        const { data: movs } = await supabase
          .from("stock_movements")
          .select("stock_item_id, lote, type, quantity")
          .in("stock_item_id", retrabIds)
          .not("lote", "is", null);

        const saldos = new Map<string, number>();
        for (const m of (movs ?? []) as { stock_item_id: string; lote: string; type: string; quantity: number }[]) {
          const key = `${m.stock_item_id}|${m.lote.toUpperCase()}`;
          const cur = saldos.get(key) ?? 0;
          saldos.set(key, m.type === "entrada" ? cur + m.quantity : cur - m.quantity);
        }
        const lotesAtivos = Array.from(saldos.values()).filter(s => s > 0).length;
        setLotesRetrabalho(lotesAtivos);
      } else {
        setLotesRetrabalho(0);
      }
    }

    loadAll();
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-2xl border bg-muted/20 p-4 h-24 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={Package}
          label="Total de Peças"
          value={totalExpedicao.toLocaleString("pt-BR")}
          color="text-primary"
          bg="bg-primary/5"
          border="border-primary/20"
          description={`${totalTipos} tipos registrados`}
        />
        <KpiCard
          icon={Wrench}
          label="Lotes em Retrabalho"
          value={lotesRetrabalho}
          color="text-amber-500"
          bg="bg-amber-500/5"
          border="border-amber-500/20"
          description="Lotes aguardando retrabalho"
        />
        <KpiCard
          icon={TrendingDown}
          label="Estoque Baixo"
          value={tiposBaixo}
          color="text-warning"
          bg="bg-warning/5"
          border="border-warning/20"
          description="Peças na expedição < 100 un."
          onClick={tiposBaixo > 0 ? () => setShowBaixoModal(true) : undefined}
        />
        <KpiCard
          icon={PackageCheck}
          label="Pedidos Separando"
          value={pedidosPendentes}
          color="text-blue-500"
          bg="bg-blue-500/5"
          border="border-blue-500/20"
          description="Em separação no estoque"
        />
      </div>

      {/* Modal estoque baixo */}
      {showBaixoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => setShowBaixoModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card border border-border/30 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/20">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-warning" />
                <p className="text-sm font-semibold">Estoque Baixo — Expedição</p>
              </div>
              <button
                type="button"
                onClick={() => setShowBaixoModal(false)}
                className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-border/20">
              {pecasBaixo.map((p, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate">{p.model}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{p.reference}</p>
                  </div>
                  <span className={cn(
                    "text-[13px] font-bold tabular-nums shrink-0",
                    p.quantity < 20 ? "text-destructive" : "text-warning"
                  )}>
                    {p.quantity} un.
                  </span>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-border/20">
              <p className="text-[11px] text-muted-foreground/60 text-center">
                {pecasBaixo.length} {pecasBaixo.length === 1 ? "peça abaixo" : "peças abaixo"} de 100 unidades na expedição
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Últimas Movimentações */}
      <div className="rounded-2xl border border-border/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Últimas Movimentações</p>
        </div>
        {movLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 rounded-xl bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : movements.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground/60">Nenhuma movimentação registrada</div>
        ) : (
          <div className="divide-y divide-border/20">
            {movements.map(m => {
              const isEntrada = m.type === "entrada";
              return (
                <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/10 transition-colors">
                  <div className={cn(
                    "h-7 w-7 rounded-lg flex items-center justify-center shrink-0",
                    isEntrada ? "bg-primary/10" : "bg-success/10"
                  )}>
                    {isEntrada
                      ? <ArrowDownCircle className="h-3.5 w-3.5 text-primary" />
                      : <ArrowUpCircle className="h-3.5 w-3.5 text-success" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium truncate">{m.device_model}</p>
                    <p className="text-[10px] text-muted-foreground/60">
                      {m.user_display_name ?? "—"} · {new Date(m.created_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={cn("text-[13px] font-bold tabular-nums", isEntrada ? "text-primary" : "text-success")}>
                      {isEntrada ? "+" : "-"}{m.quantity}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50">un.</span>
                    {m.fase === "expedicao" && (
                      <Truck className="h-3 w-3 text-muted-foreground/40" title="Expedição" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
