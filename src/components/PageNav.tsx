/**
 * PageNav — Barra de navegação reutilizável com ícones animados.
 * Mesmo padrão visual do StockNav para harmonia entre todas as páginas.
 */

import { useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

export interface PageNavTab<T extends string> {
  id: T;
  label: string;
  Icon: React.ElementType;
  badge?: number;
  activeColor?: string;
  activeBg?: string;
  activeBorder?: string;
  badgeBg?: string;
  badgeText?: string;
}

interface PageNavProps<T extends string> {
  tabs: PageNavTab<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  loading?: boolean;
  /** Quando true, usa grid flex-wrap em 2 linhas em vez de scroll horizontal (útil p/ muitas abas) */
  wrap?: boolean;
}

export function PageNav<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  loading = false,
  wrap = false,
}: PageNavProps<T>) {
  const [animating, setAnimating] = useState<T | null>(null);
  const activeRef = useRef<T>(activeTab);
  activeRef.current = activeTab;

  const handleClick = useCallback(
    (tab: T) => {
      if (tab === activeRef.current) return;
      setAnimating(tab);
      setTimeout(() => setAnimating(null), 400);
      onTabChange(tab);
    },
    [onTabChange]
  );

  return (
    <div className="space-y-2">
      {wrap ? (
        /* Modo wrap: grid flex-wrap, 2 linhas para muitas abas */
        <div className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm p-1.5">
          <div className="flex flex-wrap gap-1.5">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTab;
              const isAnimating = animating === tab.id;
              const activeColor = tab.activeColor ?? "text-primary";
              const activeBg    = tab.activeBg    ?? "bg-primary/10";
              const activeBorder= tab.activeBorder ?? "border-primary/40";
              const badgeBg     = tab.badgeBg     ?? "bg-primary/15";
              const badgeText   = tab.badgeText   ?? "text-primary";
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleClick(tab.id)}
                  className={cn(
                    "relative flex items-center gap-1.5 py-1.5 px-2.5 rounded-xl border transition-all duration-200",
                    isActive
                      ? cn(activeBg, activeBorder)
                      : "border-transparent hover:bg-muted/30"
                  )}
                  aria-label={tab.label}
                  aria-pressed={isActive}
                >
                  {!loading && tab.badge !== undefined && tab.badge > 0 && (
                    <span className={cn(
                      "absolute top-0.5 right-0.5 min-w-[14px] h-[14px] rounded-full text-[9px] font-bold flex items-center justify-center px-[3px] leading-none",
                      isActive ? cn(badgeBg, badgeText) : "bg-muted/60 text-muted-foreground"
                    )}>
                      {tab.badge}
                    </span>
                  )}
                  <div className={cn(
                    "flex items-center justify-center w-6 h-6 rounded-full transition-all duration-200",
                    isActive ? activeBg : ""
                  )}>
                    <tab.Icon
                      className={cn(
                        "h-[15px] w-[15px] transition-all duration-200",
                        isActive ? cn(activeColor, "scale-110") : "text-muted-foreground"
                      )}
                      style={isAnimating ? { animation: "pageNavPop 0.35s cubic-bezier(.36,.07,.19,.97)" } : {}}
                    />
                  </div>
                  <span className={cn(
                    "text-[10px] font-medium leading-tight",
                    isActive ? activeColor : "text-muted-foreground"
                  )}>
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
      /* Modo padrão: scroll horizontal */
      /* py-1 garante espaço vertical para a borda/sombra do container interno não ser clipada pelo overflow-x-auto */
      <div className="overflow-x-auto scrollbar-none -mx-1 px-1 py-1">
        <div className="flex items-stretch gap-1.5 rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm p-1.5 min-w-max sm:min-w-0">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab;
            const isAnimating = animating === tab.id;
            const activeColor = tab.activeColor ?? "text-primary";
            const activeBg    = tab.activeBg    ?? "bg-primary/10";
            const activeBorder= tab.activeBorder ?? "border-primary/40";
            const badgeBg     = tab.badgeBg     ?? "bg-primary/15";
            const badgeText   = tab.badgeText   ?? "text-primary";

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleClick(tab.id)}
                className={cn(
                  "relative flex flex-1 flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl border transition-all duration-200",
                  isActive
                    ? cn(activeBg, activeBorder)
                    : "border-transparent hover:bg-muted/30"
                )}
                aria-label={tab.label}
                aria-pressed={isActive}
              >
                {/* Badge */}
                {!loading && tab.badge !== undefined && tab.badge > 0 && (
                  <span
                    className={cn(
                      "absolute top-1 right-1 min-w-[14px] h-[14px] rounded-full text-[9px] font-bold flex items-center justify-center px-[3px] leading-none",
                      isActive ? cn(badgeBg, badgeText) : "bg-muted/60 text-muted-foreground"
                    )}
                  >
                    {tab.badge}
                  </span>
                )}

                {/* Ícone */}
                <div
                  className={cn(
                    "flex items-center justify-center w-9 h-9 rounded-full transition-all duration-200",
                    isActive ? activeBg : ""
                  )}
                >
                  <tab.Icon
                    className={cn(
                      "h-[18px] w-[18px] transition-all duration-200",
                      isActive ? cn(activeColor, "scale-110") : "text-muted-foreground"
                    )}
                    style={
                      isAnimating
                        ? { animation: "pageNavPop 0.35s cubic-bezier(.36,.07,.19,.97)" }
                        : {}
                    }
                  />
                </div>

                {/* Label */}
                <span
                  className={cn(
                    "text-[9px] font-medium leading-tight hidden sm:block",
                    isActive ? activeColor : "text-muted-foreground"
                  )}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      )} {/* fim do bloco modo padrão / wrap */}

      <style>{`
        @keyframes pageNavPop {
          0%   { transform: scale(1.1); }
          30%  { transform: scale(1.45) rotate(-10deg); }
          60%  { transform: scale(0.95) rotate(6deg); }
          100% { transform: scale(1.1) rotate(0deg); }
        }
      `}</style>
    </div>
  );
}
