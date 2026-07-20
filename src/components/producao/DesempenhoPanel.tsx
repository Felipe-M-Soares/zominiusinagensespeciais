/**
 * DesempenhoPanel — Unifica Dashboard, Metas e Relatórios numa única aba
 * do menu de Produção. Os três mostram variações do mesmo dado (OEE,
 * paradas e refugo agregados) — Dashboard no mês atual, Metas comparando
 * com a meta definida, Relatórios com período customizável e exportação.
 * Este wrapper só adiciona navegação interna; nenhuma lógica dos três
 * painéis originais foi alterada.
 */
import { useState } from "react";
import { LayoutDashboard, Target, FileBarChart2 } from "lucide-react";
import { PageNav, type PageNavTab } from "@/components/PageNav";
import { useTranslation } from "react-i18next";
import { DashboardPanel } from "@/components/producao/DashboardPanel";
import { MetasPanel } from "@/components/producao/MetasPanel";
import { RelatoriosPanel } from "@/components/producao/RelatoriosPanel";

type DesempenhoView = "visao_geral" | "metas" | "relatorios";

function buildTabs(t: (k: string) => string): PageNavTab<DesempenhoView>[] { return [
  { id: "visao_geral", label: t("producao.overview"), Icon: LayoutDashboard, activeColor: "text-blue-600 dark:text-blue-400",     activeBg: "bg-blue-500/10",     activeBorder: "border-blue-500/40",     badgeBg: "bg-blue-500/15",     badgeText: "text-blue-600 dark:text-blue-400" },
  { id: "metas",       label: t("producao.goals"),       Icon: Target,          activeColor: "text-emerald-600 dark:text-emerald-400", activeBg: "bg-emerald-500/10", activeBorder: "border-emerald-500/40", badgeBg: "bg-emerald-500/15", badgeText: "text-emerald-600 dark:text-emerald-400" },
  { id: "relatorios",  label: t("producao.reports"),  Icon: FileBarChart2,   activeColor: "text-indigo-600 dark:text-indigo-400", activeBg: "bg-indigo-500/10",   activeBorder: "border-indigo-500/40",   badgeBg: "bg-indigo-500/15",   badgeText: "text-indigo-600 dark:text-indigo-400" },
]; }

export function DesempenhoPanel() {
  const { t } = useTranslation();
  const TABS = buildTabs(t);
  const [view, setView] = useState<DesempenhoView>("visao_geral");

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <PageNav tabs={TABS} activeTab={view} onTabChange={setView} cols={3} />
      {view === "visao_geral" && <DashboardPanel />}
      {view === "metas" && <MetasPanel />}
      {view === "relatorios" && <RelatoriosPanel />}
    </div>
  );
}
