/**
 * StockNav — Navegação mobile-first com ícones animados e preview de contagens
 *
 * Substitui o bloco de navegação (Tabs) na página Estoque.tsx.
 * Cole este componente no topo do arquivo e use <StockNav ... /> no lugar
 * do bloco <div className="flex items-stretch gap-2"> atual.
 */

import { useState, useCallback, useRef } from "react";
import {
  LayoutDashboard,
  Package,
  Truck,
  Wrench,
  Inbox,
  AlertTriangle,
  ShoppingBag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { StockItem } from "@/hooks/useStock";

// ── Tipos ──────────────────────────────────────────────────────────────────────
export type ActiveView =
  | "dashboard"
  | "intermediaria"
  | "expedicao"
  | "retrabalho"
  | "recebimento"
  | "pedidos"

interface StockNavProps {
  activeView: ActiveView;
  onViewChange: (view: ActiveView) => void;
  intermediariaItems: StockItem[];
  expedicaoItems: StockItem[];
  retrabalhoItems: StockItem[];
  loading: boolean;
  pedidosPendentes?: number;
}

// ── Configuração das abas ──────────────────────────────────────────────────────
const TABS = [
  {
    id: "dashboard" as ActiveView,
    label: "Dashboard",
    Icon: LayoutDashboard,
    activeColor: "text-primary",
    activeBg: "bg-primary/10",
    activeBorder: "border-primary/40",
    badgeBg: "bg-primary/15",
    badgeText: "text-primary",
    animation: "animate-pop",
  },
  {
    id: "intermediaria" as ActiveView,
    label: "Interm.",
    Icon: Package,
    activeColor: "text-primary",
    activeBg: "bg-primary/10",
    activeBorder: "border-primary/40",
    badgeBg: "bg-primary/15",
    badgeText: "text-primary",
    animation: "animate-bounce-once",
  },
  {
    id: "expedicao" as ActiveView,
    label: "Expedição",
    Icon: Truck,
    activeColor: "text-success",
    activeBg: "bg-success/10",
    activeBorder: "border-success/40",
    badgeBg: "bg-success/15",
    badgeText: "text-success",
    animation: "animate-spin-once",
  },
  {
    id: "retrabalho" as ActiveView,
    label: "Retrab.",
    Icon: Wrench,
    activeColor: "text-orange-500",
    activeBg: "bg-orange-500/10",
    activeBorder: "border-orange-500/40",
    badgeBg: "bg-orange-500/15",
    badgeText: "text-orange-500",
    animation: "animate-shake",
  },
  {
    id: "recebimento" as ActiveView,
    label: "Recebim.",
    Icon: Inbox,
    activeColor: "text-cyan-600 dark:text-cyan-400",
    activeBg: "bg-cyan-500/10",
    activeBorder: "border-cyan-500/40",
    badgeBg: "bg-cyan-500/15",
    badgeText: "text-cyan-600 dark:text-cyan-400",
    animation: "animate-tilt",
  },
  {
    id: "pedidos" as ActiveView,
    label: "Pedidos",
    Icon: ShoppingBag,
    activeColor: "text-amber-600 dark:text-amber-400",
    activeBg: "bg-amber-500/10",
    activeBorder: "border-amber-500/40",
    badgeBg: "bg-amber-500/15",
    badgeText: "text-amber-600 dark:text-amber-400",
    animation: "animate-pop",
  },
] as const;

// ── Preview de métricas por aba ─────────────────────────────────────────────────
function PreviewCard({
  items,
  view,
  label,
  pecasExpedicao,
  pecasRetrabalho,
  tiposBaixo,
  pedidosSeparando,
}: {
  items: StockItem[];
  view: ActiveView;
  label: string;
  pecasExpedicao?: number;
  pecasRetrabalho?: number;
  tiposBaixo?: number;
  pedidosSeparando?: number;
}) {
  // Para o dashboard: agrupa por device_id para não contar a mesma peça em múltiplas fases
  const byDevice = new Map<string, { quantity: number; min_quantity: number }>();
  for (const i of items) {
    const cur = byDevice.get(i.device_id);
    byDevice.set(i.device_id, {
      quantity: (cur?.quantity ?? 0) + i.quantity,
      min_quantity: Math.max(cur?.min_quantity ?? 0, i.min_quantity),
    });
  }
  const devEntries = Array.from(byDevice.values());

  const ok = (view === "dashboard" ? devEntries : items).filter((i) => i.quantity > i.min_quantity).length;
  const low = (view === "dashboard" ? devEntries : items).filter(
    (i) => i.quantity > 0 && i.quantity <= i.min_quantity
  ).length;
  const empty = (view === "dashboard" ? devEntries : items).filter((i) => i.quantity === 0).length;
  const total = items.reduce((s, i) => s + i.quantity, 0);

  const totalIntermediaria = items
    .filter(i => i.fase === "intermediaria")
    .reduce((s, i) => s + i.quantity, 0);

  if (view === "dashboard") {
    return (
      <div className="grid grid-cols-4 gap-2">
        <PreviewStat value={(pecasExpedicao ?? 0).toLocaleString("pt-BR")} label="Expedição" color="text-primary" />
        <PreviewStat value={(pecasRetrabalho ?? 0).toLocaleString("pt-BR")} label="Retrabalho" color="text-amber-500" />
        <PreviewStat value={tiposBaixo ?? 0} label="Baixo" color="text-warning" />
        <PreviewStat value={pedidosSeparando ?? 0} label="Separando" color="text-blue-500" />
      </div>
    );
  }

  if (view === "recebimento" || view === "pedidos") {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {view === "pedidos"
          ? <><ShoppingBag className="h-3.5 w-3.5" />Pedidos das vendedoras para separar</>
          : <><Inbox className="h-3.5 w-3.5" />Registre entradas por lote aqui</>
        }
      </div>
    );
  }

  // Sem preview de stats para as abas de lista
  return null;
}

function PreviewStat({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl bg-background border border-border/30 py-2 px-1 gap-0.5">
      <span className={cn("text-[15px] font-bold tabular-nums leading-none", color)}>
        {value}
      </span>
      <span className="text-[9px] text-muted-foreground/70 leading-tight">{label}</span>
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────
export function StockNav({
  activeView,
  onViewChange,
  intermediariaItems,
  expedicaoItems,
  retrabalhoItems,
  loading,
  pedidosPendentes = 0,
}: StockNavProps) {
  const [animating, setAnimating] = useState<ActiveView | null>(null);
  // Ref para evitar closure stale no handleClick (activeView pode ficar desatualizado
  // em taps rápidos mobile porque o useCallback não re-executa imediatamente).
  const activeViewRef = useRef<ActiveView>(activeView);
  activeViewRef.current = activeView;

  const handleClick = useCallback(
    (view: ActiveView) => {
      if (view === activeViewRef.current) return;
      setAnimating(view);
      setTimeout(() => setAnimating(null), 500);
      onViewChange(view);
    },
    [onViewChange]
  );

  // Mapeamento de view → itens para o preview
  const previewItems: Record<ActiveView, StockItem[]> = {
    dashboard: [...intermediariaItems, ...expedicaoItems, ...retrabalhoItems],
    intermediaria: intermediariaItems,
    expedicao: expedicaoItems,
    retrabalho: retrabalhoItems,
    recebimento: [],
    pedidos: [],
  };

  // Métricas do dashboard (espelham o StockDashboard)
  const pecasExpedicao = expedicaoItems.reduce((s, i) => s + i.quantity, 0);
  const pecasRetrabalho = retrabalhoItems.reduce((s, i) => s + i.quantity, 0);
  const expByDevice = new Map<string, number>();
  for (const i of expedicaoItems) expByDevice.set(i.device_id, (expByDevice.get(i.device_id) ?? 0) + i.quantity);
  const tiposBaixo = Array.from(expByDevice.values()).filter(q => q > 0 && q < 100).length;

  // Contagens para badges
  const counts: Partial<Record<ActiveView, number>> = {
    intermediaria: intermediariaItems.length,
    expedicao: expedicaoItems.length,
    retrabalho: retrabalhoItems.length,
    pedidos: pedidosPendentes || undefined,
  };

  const activeTab = TABS.find((t) => t.id === activeView)!;

  return (
    <div className="space-y-2">
      {/* ── Barra de ícones ── */}
      <div className="flex items-stretch gap-1.5 rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm p-1.5">
        {TABS.map((tab) => {
          const isActive = tab.id === activeView;
          const count = counts[tab.id];
          const isAnimating = animating === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleClick(tab.id)}
              className={cn(
                "relative flex flex-1 flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl border transition-all duration-200",
                isActive
                  ? cn(tab.activeBg, tab.activeBorder)
                  : "border-transparent hover:bg-muted/30"
              )}
              aria-label={tab.label}
              aria-pressed={isActive}
            >
              {/* Badge */}
              {!loading && count !== undefined && count > 0 && (
                <span
                  className={cn(
                    "absolute top-1 right-1 min-w-[14px] h-[14px] rounded-full text-[9px] font-bold flex items-center justify-center px-[3px] leading-none",
                    isActive ? cn(tab.badgeBg, tab.badgeText) : "bg-muted/60 text-muted-foreground"
                  )}
                >
                  {count}
                </span>
              )}

              {/* Ícone com animação */}
              <div
                className={cn(
                  "flex items-center justify-center w-9 h-9 rounded-full transition-all duration-200",
                  isActive ? tab.activeBg : ""
                )}
              >
                <tab.Icon
                  className={cn(
                    "h-[18px] w-[18px] transition-all duration-200",
                    isActive ? cn(tab.activeColor, "scale-110") : "text-muted-foreground",
                    isAnimating && "animate-[wiggle_0.4s_ease]"
                  )}
                  style={
                    isAnimating
                      ? { animation: "navIconPop 0.35s cubic-bezier(.36,.07,.19,.97)" }
                      : {}
                  }
                />
              </div>

              {/* Label */}
              <span
                className={cn(
                  "text-[9px] font-medium leading-tight hidden sm:block",
                  isActive ? tab.activeColor : "text-muted-foreground"
                )}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Preview card (aparece sempre, animado) ── */}
      {!loading && (
        <div
          key={activeView}
          className={cn(
            "rounded-2xl border border-border/30 bg-muted/20 px-3 py-2.5",
            "animate-in fade-in slide-in-from-top-1 duration-200"
          )}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <activeTab.Icon
              className={cn("h-3 w-3", activeTab.activeColor)}
            />
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              {activeTab.label === "Interm." ? "Intermediário" : activeTab.label}
            </span>
          </div>
          <PreviewCard
            items={previewItems[activeView]}
            view={activeView}
            label={activeTab.label}
            pecasExpedicao={pecasExpedicao}
            pecasRetrabalho={pecasRetrabalho}
            tiposBaixo={tiposBaixo}
            pedidosSeparando={pedidosPendentes ?? 0}
          />
        </div>
      )}

      <style>{`
        @keyframes navIconPop {
          0%   { transform: scale(1.1); }
          30%  { transform: scale(1.45) rotate(-10deg); }
          60%  { transform: scale(0.95) rotate(6deg); }
          100% { transform: scale(1.1) rotate(0deg); }
        }
      `}</style>
    </div>
  );
}
