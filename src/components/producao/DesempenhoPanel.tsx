/**
 * DesempenhoPanel — Unifica Dashboard, Metas e Relatórios numa única aba
 * do menu de Produção. Os três mostram variações do mesmo dado (OEE,
 * paradas e refugo agregados) — Dashboard no mês atual, Metas comparando
 * com a meta definida, Relatórios com período customizável e exportação.
 * Este wrapper só adiciona navegação interna; nenhuma lógica dos três
 * painéis originais foi alterada.
 */
import { useState } from "react";
import { LayoutDashboard, Target, FileBarChart2, CalendarRange, Timer } from "lucide-react";
import { PageNav, type PageNavTab } from "@/components/PageNav";
import { DashboardPanel } from "@/components/producao/DashboardPanel";
import { MetasPanel } from "@/components/producao/MetasPanel";
import { RelatoriosPanel } from "@/components/producao/RelatoriosPanel";
import { SemestralPanel } from "@/components/producao/SemestralPanel";
import { TempoPecaPanel } from "@/components/producao/TempoPecaPanel";

type DesempenhoView = "semestre" | "tempo_peca" | "visao_geral" | "metas" | "relatorios";

const TABS: PageNavTab<DesempenhoView>[] = [
  { id: "semestre",    label: "Semestre",    Icon: CalendarRange },
  { id: "tempo_peca",  label: "Tempo de peça", Icon: Timer },
  { id: "visao_geral", label: "Mês", Icon: LayoutDashboard, activeColor: "text-blue-600 dark:text-blue-400",     activeBg: "bg-blue-500/10",     activeBorder: "border-blue-500/40",     badgeBg: "bg-blue-500/15",     badgeText: "text-blue-600 dark:text-blue-400" },
  { id: "metas",       label: "Metas",       Icon: Target,          activeColor: "text-emerald-600 dark:text-emerald-400", activeBg: "bg-emerald-500/10", activeBorder: "border-emerald-500/40", badgeBg: "bg-emerald-500/15", badgeText: "text-emerald-600 dark:text-emerald-400" },
  { id: "relatorios",  label: "Relatórios",  Icon: FileBarChart2,   activeColor: "text-indigo-600 dark:text-indigo-400", activeBg: "bg-indigo-500/10",   activeBorder: "border-indigo-500/40",   badgeBg: "bg-indigo-500/15",   badgeText: "text-indigo-600 dark:text-indigo-400" },
];

export function DesempenhoPanel() {
  const [view, setView] = useState<DesempenhoView>("semestre");

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <PageNav tabs={TABS} activeTab={view} onTabChange={setView} ariaLabel="Visões de desempenho" />
      {view === "semestre" && <SemestralPanel />}
      {view === "tempo_peca" && <TempoPecaPanel />}
      {view === "visao_geral" && <DashboardPanel />}
      {view === "metas" && <MetasPanel />}
      {view === "relatorios" && <RelatoriosPanel />}
    </div>
  );
}
