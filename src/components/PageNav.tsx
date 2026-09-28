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
 *  - Rolagem horizontal suave: a aba ativa é centralizada SÓ dentro da barra
 *    (sem mexer na rolagem da página) e há um esmaecido nas bordas indicando
 *    que existem mais abas para os lados.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

  // Esmaecido nas bordas quando há abas escondidas para os lados.
  const [edges, setEdges] = useState({ left: false, right: false });
  const updateEdges = useCallback(() => {
    const el = listRef.current;
    if (!el || cols) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, [cols]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || cols) return;
    updateEdges();
    el.addEventListener("scroll", updateEdges, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateEdges) : null;
    ro?.observe(el);
    return () => { el.removeEventListener("scroll", updateEdges); ro?.disconnect(); };
  }, [cols, updateEdges, tabs.length]);

  // Mantém a aba ativa visível (centralizada) quando a barra rola na
  // horizontal. Mexe só no scrollLeft da barra — scrollIntoView também
  // rolava a página na vertical. Refaz quando os selos (badges) mudam de
  // largura depois de carregar.
  const firstRun = useRef(true);
  const badgeKey = tabs.map((t) => `${t.id}:${loading ? "" : t.badge ?? ""}`).join("|");
  useLayoutEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !el || cols) return;
    const target = el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2;
    const max = list.scrollWidth - list.clientWidth;
    const left = Math.max(0, Math.min(max, target));
    if (Math.abs(list.scrollLeft - left) > 1) {
      list.scrollTo({ left, behavior: firstRun.current ? "auto" : "smooth" });
    }
    firstRun.current = false;
    updateEdges();
  }, [activeTab, cols, badgeKey, updateEdges]);

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
    // 3+ colunas no celular: ícone em cima do rótulo para o nome caber inteiro.
    const stacked      = !!cols && cols >= 3;
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
          "relative inline-flex items-center justify-center whitespace-nowrap rounded-xl border font-medium transition-colors duration-150 select-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          // Grade (celular): ícone em cima do rótulo, para o nome inteiro caber
          // em colunas estreitas (antes cortava "Faturame…", "Configur…").
          stacked ? "w-full min-w-0 flex-col gap-0.5 px-1.5 py-1.5 min-h-[52px] text-[12px] leading-tight sm:flex-row sm:gap-2 sm:px-2 sm:py-0 sm:min-h-0 sm:h-10 sm:text-[13px]"
            : cols ? "w-full min-w-0 gap-2 px-2 h-10 text-[13px]" : "shrink-0 gap-2 px-3.5 h-10 text-[13px]",
          isActive
            ? cn(activeBg, activeBorder, activeColor, "font-semibold shadow-sm")
            : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/70"
        )}
      >
        <tab.Icon className={cn("h-4 w-4 shrink-0", isActive ? activeColor : "text-muted-foreground")} aria-hidden />
        <span className={cn(cols && "max-w-full truncate")}>{tab.label}</span>
        {showBadge && (
          <span
            className={cn(
              "min-w-[18px] h-[18px] rounded-full text-[10px] font-bold inline-flex items-center justify-center px-1 leading-none tabular-nums",
              stacked && "absolute top-1 right-1 sm:static",
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
    <div className="relative rounded-2xl border border-border/70 bg-card/90 shadow-xs backdrop-blur-sm p-1.5">
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className={cn(
          cols
            ? "grid gap-1"
            : "relative flex items-center gap-1 overflow-x-auto scrollbar-none overscroll-x-contain"
        )}
        style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
      >
        {tabs.map(renderTab)}
      </div>
      {!cols && (
        <>
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-y-1.5 left-1.5 w-8 rounded-l-xl bg-gradient-to-r from-card to-transparent transition-opacity duration-200",
              edges.left ? "opacity-100" : "opacity-0"
            )}
          />
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-y-1.5 right-1.5 w-8 rounded-r-xl bg-gradient-to-l from-card to-transparent transition-opacity duration-200",
              edges.right ? "opacity-100" : "opacity-0"
            )}
          />
        </>
      )}
    </div>
  );
}
