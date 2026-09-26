/**
 * PageNav — barra de abas reutilizável por todos os módulos.
 *
 * Redesenho (set/2026):
 *  - Rótulo SEMPRE visível ao lado do ícone (antes: 8–9px, e escondido no
 *    celular — só ícone, sem como saber o que era cada aba).
 *  - Acessível: role="tablist"/"tab", aria-selected e navegação por setas
 *    (← → Home End), como um componente de abas nativo.
 *  - A aba ativa rola automaticamente para a área visível no celular.
 *  - `cols` continua disponível (grade fixa) para quem já usava.
 */

import { useCallback, useEffect, useRef } from "react";
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
  /** Grade com N colunas fixas em vez de rolagem horizontal. */
  cols?: number;
  /** Rótulo acessível do grupo de abas. */
  ariaLabel?: string;
}

export function PageNav<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  loading = false,
  cols,
  ariaLabel = "Seções",
}: PageNavProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<T>(activeTab);
  activeRef.current = activeTab;

  const select = useCallback(
    (tab: T) => {
      if (tab === activeRef.current) return;
      onTabChange(tab);
    },
    [onTabChange]
  );

  // Mantém a aba ativa visível quando a barra rola na horizontal (celular).
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [activeTab]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = tabs.findIndex((t) => t.id === activeTab);
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(tabs[next].id);
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${tabs[next].id}"]`)?.focus();
    });
  };

  const renderTab = (tab: PageNavTab<T>) => {
    const isActive     = tab.id === activeTab;
    const activeColor  = tab.activeColor  ?? "text-primary";
    const activeBg     = tab.activeBg     ?? "bg-primary/10";
    const activeBorder = tab.activeBorder ?? "border-primary/30";
    const badgeBg      = tab.badgeBg      ?? "bg-primary/15";
    const badgeText    = tab.badgeText    ?? "text-primary";
    const showBadge    = !loading && tab.badge !== undefined && tab.badge > 0;

    return (
      <button
        key={tab.id}
        type="button"
        role="tab"
        id={`tab-${tab.id}`}
        data-tab-id={tab.id}
        aria-selected={isActive}
        tabIndex={isActive ? 0 : -1}
        onClick={() => select(tab.id)}
        className={cn(
          "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border px-3.5 h-10",
          "text-[13px] font-medium transition-colors duration-150 select-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          cols ? "w-full px-2" : "shrink-0",
          isActive
            ? cn(activeBg, activeBorder, activeColor, "font-semibold shadow-sm")
            : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/70"
        )}
      >
        <tab.Icon className={cn("h-4 w-4 shrink-0", isActive ? activeColor : "text-muted-foreground")} aria-hidden />
        <span className={cn(cols && "truncate")}>{tab.label}</span>
        {showBadge && (
          <span
            className={cn(
              "min-w-[18px] h-[18px] rounded-full text-[10px] font-bold inline-flex items-center justify-center px-1 leading-none tabular-nums",
              isActive ? cn(badgeBg, badgeText) : "bg-muted text-muted-foreground"
            )}
            aria-label={`${tab.badge} pendente(s)`}
          >
            {tab.badge! > 99 ? "99+" : tab.badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="rounded-2xl border border-border/70 bg-card/90 shadow-xs backdrop-blur-sm p-1.5">
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className={cn(
          cols
            ? "grid gap-1"
            : "flex items-center gap-1 overflow-x-auto scrollbar-none scroll-px-2"
        )}
        style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
      >
        {tabs.map(renderTab)}
      </div>
    </div>
  );
}
