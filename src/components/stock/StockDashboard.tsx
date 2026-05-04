import { Package, AlertTriangle, TrendingDown, Wrench, ArrowDownCircle, ArrowUpCircle, Truck, Activity, PackageCheck } from "lucide-react";
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
}

function KpiCard({ icon: Icon, label, value, color, bg, border, description }: KpiCardProps) {
  return (
    <div className={cn("rounded-2xl border p-4 flex items-start gap-3", bg, border)}>
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

export function StockDashboard({ items, loading }: Props) {
  const [movements, setMovements] = useState<AllMovement[]>([]);
  const [movLoading, setMovLoading] = useState(true);
  const [pedidosSeparando, setPedidosSeparando] = useState(0);
  const [totalIntermediaria, setTotalIntermediaria] = useState(0);
  const [totalExpedicao, setTotalExpedicao] = useState(0);
  const [totalRetrabalho, setTotalRetrabalho] = useState(0);
  const [totalTipos, setTotalTipos] = useState(0);
  const [tiposBaixo, setTiposBaixo] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setMovLoading(true);
    fetchAllMovements(10).then(data => {
      if (!cancelled) { setMovements(data); setMovLoading(false); }
    }).catch(() => { if (!cancelled) setMovLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // Pedidos separando
    supabase
      .from("pedidos_comerciais")
      .select("id", { count: "exact", head: true })
      .eq("status", "separando")
      .then(({ count }) => setPedidosSeparando(count ?? 0));

    // Totais por fase — busca tudo sem paginação usando aggregate
    async function loadTotals() {
      const { data } = await supabase
        .from("stock_items")
        .select("device_id, quantity, fase");

      if (!data) return;

      let interm = 0, exped = 0, retrab = 0;
      const tiposSet = new Set<string>();
      const expByDevice = new Map<string, number>();

      for (const row of data) {
        const qty = (row.quantity as number) ?? 0;
        const fase = row.fase as string;
        const deviceId = row.device_id as string;
        tiposSet.add(deviceId);
        if (fase === "intermediaria") interm += qty;
        else if (fase === "expedicao") {
          exped += qty;
          expByDevice.set(deviceId, (expByDevice.get(deviceId) ?? 0) + qty);
        }
        else if (fase === "retrabalho") retrab += qty;
      }

      const baixo = Array.from(expByDevice.values()).filter(q => q > 0 && q < 100).length;

      setTotalIntermediaria(interm);
      setTotalExpedicao(exped);
      setTotalRetrabalho(retrab);
      setTotalTipos(tiposSet.size);
      setTiposBaixo(baixo);
    }

    loadTotals();
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
          value={totalIntermediaria.toLocaleString("pt-BR")}
          color="text-primary"
          bg="bg-primary/5"
          border="border-primary/20"
          description={`${totalTipos} tipos · ${totalExpedicao} na expedição`}
        />
        <KpiCard
          icon={Wrench}
          label="Peças em Retrabalho"
          value={totalRetrabalho.toLocaleString("pt-BR")}
          color="text-amber-500"
          bg="bg-amber-500/5"
          border="border-amber-500/20"
          description="Aguardando retrabalho"
        />
        <KpiCard
          icon={TrendingDown}
          label="Estoque Baixo"
          value={tiposBaixo}
          color="text-warning"
          bg="bg-warning/5"
          border="border-warning/20"
          description="Tipos com menos de 100 un."
        />
        <KpiCard
          icon={PackageCheck}
          label="Pedidos Separando"
          value={pedidosSeparando}
          color="text-blue-500"
          bg="bg-blue-500/5"
          border="border-blue-500/20"
          description="Em separação no estoque"
        />
      </div>

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
