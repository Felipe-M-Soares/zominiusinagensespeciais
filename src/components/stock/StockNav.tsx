/**
 * StockNav — abas do módulo Estoque.
 *
 * Agora é uma camada fina sobre o PageNav (mesmo visual de todos os módulos).
 * Antes era uma cópia do componente com rótulos de 8px abreviados
 * ("Interm.", "Retrab.", "Recebim.") difíceis de ler.
 */

import { useMemo } from "react";
import { LayoutDashboard, Package, Truck, Wrench, Inbox, ShoppingBag } from "lucide-react";
import { PageNav, type PageNavTab } from "@/components/PageNav";

export type ActiveView =
  | "dashboard"
  | "intermediaria"
  | "expedicao"
  | "retrabalho"
  | "recebimento"
  | "pedidos";

interface StockNavProps {
  activeView: ActiveView;
  onViewChange: (view: ActiveView) => void;
  loading: boolean;
  pedidosPendentes?: number;
  qtyByFase?: {
    intermediaria: number; expedicao: number; retrabalho: number;
    count_intermediaria: number; count_expedicao: number; count_retrabalho: number;
  };
}

export function StockNav({ activeView, onViewChange, loading, pedidosPendentes = 0, qtyByFase }: StockNavProps) {
  const tabs = useMemo<PageNavTab<ActiveView>[]>(() => [
    { id: "dashboard",     label: "Visão geral",   Icon: LayoutDashboard },
    { id: "intermediaria", label: "Intermediário", Icon: Package, badge: qtyByFase?.count_intermediaria },
    {
      id: "expedicao", label: "Expedição", Icon: Truck, badge: qtyByFase?.count_expedicao,
      activeColor: "text-success", activeBg: "bg-success/10", activeBorder: "border-success/30",
      badgeBg: "bg-success/15", badgeText: "text-success",
    },
    {
      id: "retrabalho", label: "Retrabalho", Icon: Wrench, badge: qtyByFase?.count_retrabalho,
      activeColor: "text-orange-600 dark:text-orange-400", activeBg: "bg-orange-500/10", activeBorder: "border-orange-500/30",
      badgeBg: "bg-orange-500/15", badgeText: "text-orange-600 dark:text-orange-400",
    },
    {
      id: "recebimento", label: "Recebimento", Icon: Inbox,
      activeColor: "text-cyan-700 dark:text-cyan-400", activeBg: "bg-cyan-500/10", activeBorder: "border-cyan-500/30",
    },
    {
      id: "pedidos", label: "Pedidos", Icon: ShoppingBag, badge: pedidosPendentes,
      activeColor: "text-amber-700 dark:text-amber-400", activeBg: "bg-amber-500/10", activeBorder: "border-amber-500/30",
      badgeBg: "bg-amber-500/15", badgeText: "text-amber-700 dark:text-amber-400",
    },
  ], [qtyByFase, pedidosPendentes]);

  return (
    <PageNav
      tabs={tabs}
      activeTab={activeView}
      onTabChange={onViewChange}
      loading={loading}
      ariaLabel="Seções do estoque"
    />
  );
}
