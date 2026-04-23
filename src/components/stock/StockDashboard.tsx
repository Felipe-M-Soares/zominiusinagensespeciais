import { Package, AlertTriangle, TrendingDown, TrendingUp, ArrowDownCircle, ArrowUpCircle, Truck, Activity } from "lucide-react";
import type { StockItem, AllMovement } from "@/hooks/useStock";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { fetchAllMovements } from "@/hooks/useStock";

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

  useEffect(() => {
    setMovLoading(true);
    fetchAllMovements(8).then(data => {
      setMovements(data);
      setMovLoading(false);
    });
  }, []);

  const total = items.length;
  const zerados = items.filter(i => i.quantity === 0).length;
  const baixo = items.filter(i => i.quantity > 0 && i.quantity <= i.min_quantity).length;
  const ok = items.filter(i => i.quantity > i.min_quantity).length;
  const totalPecas = items.reduce((sum, i) => sum + i.quantity, 0);

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
          value={totalPecas.toLocaleString("pt-BR")}
          color="text-primary"
          bg="bg-primary/5"
          border="border-primary/20"
          description={`${total} tipos cadastrados`}
        />
        <KpiCard
          icon={TrendingUp}
          label="Estoque OK"
          value={ok}
          color="text-success"
          bg="bg-success/5"
          border="border-success/20"
          description="Acima do mínimo"
        />
        <KpiCard
          icon={TrendingDown}
          label="Estoque Baixo"
          value={baixo}
          color="text-warning"
          bg="bg-warning/5"
          border="border-warning/20"
          description="Abaixo do mínimo"
        />
        <KpiCard
          icon={AlertTriangle}
          label="Zerados"
          value={zerados}
          color="text-destructive"
          bg="bg-destructive/5"
          border="border-destructive/20"
          description="Sem unidades"
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
