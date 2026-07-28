/**
 * Produção — Hub de Controle Industrial
 * Layout harmonizado com o restante do app: header + PageNav (mesmo padrão
 * de Qualidade/Financeiro/Admin). Entra direto na primeira aba (Desempenho),
 * sem tela de menu intermediária — mesmo comportamento de Financeiro.tsx.
 *
 * CONSOLIDAÇÃO: 11 → 7 módulos no menu, sem remover nenhuma funcionalidade —
 * só reorganiza onde cada coisa mora, seguindo o fluxo real de uso:
 *  - Dashboard + Metas + Relatórios → "Desempenho" (3 sub-abas, mesmo dado
 *    em variações: mês atual / vs. meta / período customizável+export)
 *  - Máquinas + Produtos + Ferramentas CNC → "Cadastros" (3 sub-abas, eram
 *    3 telas de CRUD administrativo puro que só alimentam dropdowns)
 *  - Importar Excel (PPI-51) migrou de dentro de "Relatórios" para
 *    "Controle" — é uma forma alternativa de lançar apontamento, não um
 *    relatório.
 *  - Controle, Planejamento, Paradas, Refugo e Matéria-Prima ficam como
 *    estavam: cada um tem fluxo operacional genuinamente distinto (ex:
 *    Paradas tem cronômetro ao vivo; Refugo tem ficha de medições
 *    dimensionais que não cabe no apontamento resumido de Controle).
 */

import { useState, useEffect, lazy, Suspense } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useIsMobile } from "@/hooks/use-mobile";
import { getStoredTheme, applyTheme } from "@/lib/theme";
import {
  LayoutDashboard, ClipboardList, CalendarClock,
  Settings2, OctagonPause, ShieldAlert, Boxes,
  Factory, WifiOff, RefreshCw, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LoadingScreen } from "@/components/LoadingScreen";
import { PageNav, type PageNavTab } from "@/components/PageNav";
import { ClearHistoryButton } from "@/components/admin/ClearHistoryButton";

const LancamentoDiario  = lazy(() => import("@/components/producao/LancamentoDiarioPanel").then(m => ({ default: m.LancamentoDiarioPanel })));
const DesempenhoPanel   = lazy(() => import("@/components/producao/DesempenhoPanel").then(m => ({ default: m.DesempenhoPanel })));
const ControlePanel     = lazy(() => import("@/components/producao/ControlePanel").then(m => ({ default: m.ControlePanel })));
const PlanejamentoPanel = lazy(() => import("@/components/producao/PlanejamentoPanel").then(m => ({ default: m.PlanejamentoPanel })));
const CadastrosPanel    = lazy(() => import("@/components/producao/CadastrosPanel").then(m => ({ default: m.CadastrosPanel })));
const ParadasPanel      = lazy(() => import("@/components/producao/ParadasPanel").then(m => ({ default: m.ParadasPanel })));
const QualidadePanel    = lazy(() => import("@/components/producao/QualidadeProducaoPanel").then(m => ({ default: m.QualidadeProducaoPanel })));
const MateriaPrimaPanel = lazy(() => import("@/components/producao/MateriaPrimaPanel").then(m => ({ default: m.MateriaPrimaPanel })));
const ImportadorPPI51   = lazy(() => import("@/components/producao/ImportadorPPI51").then(m => ({ default: m.ImportadorPPI51 })));

type ProdView = "diario"|"desempenho"|"controle"|"planejamento"|"cadastros"|"paradas"|"qualidade"|"materiaprima";

interface ProdModule {
  id: ProdView; label: string;
  Icon: React.ElementType;
  activeColor: string; activeBg: string; activeBorder: string; badgeBg: string; badgeText: string;
  /** Restringe a aba a quem tem role admin ou producao — usado em
   * "Cadastros" (máquinas/produtos/ferramentas), que o banco já permite
   * a role producao escrever (ver políticas RLS maq_insert/prod_insert/
   * ferr_write), mas a navegação ficava restrita só a admin por engano. */
  restrictedTo?: ("admin" | "producao")[];
}

const MODULES: ProdModule[] = [
  { id:"diario",       label:"Diário",       Icon:Zap,             activeColor:"text-cyan-600 dark:text-cyan-400",     activeBg:"bg-cyan-500/10",     activeBorder:"border-cyan-500/40",     badgeBg:"bg-cyan-500/15",     badgeText:"text-cyan-600 dark:text-cyan-400" },
  { id:"desempenho",   label:"Desempenho",   Icon:LayoutDashboard, activeColor:"text-blue-600 dark:text-blue-400",     activeBg:"bg-blue-500/10",     activeBorder:"border-blue-500/40",     badgeBg:"bg-blue-500/15",     badgeText:"text-blue-600 dark:text-blue-400" },
  { id:"controle",     label:"Controle",     Icon:ClipboardList,   activeColor:"text-green-600 dark:text-green-400",   activeBg:"bg-green-500/10",    activeBorder:"border-green-500/40",    badgeBg:"bg-green-500/15",    badgeText:"text-green-600 dark:text-green-400" },
  { id:"planejamento", label:"Planejamento", Icon:CalendarClock,   activeColor:"text-amber-600 dark:text-amber-400",   activeBg:"bg-amber-500/10",    activeBorder:"border-amber-500/40",    badgeBg:"bg-amber-500/15",    badgeText:"text-amber-600 dark:text-amber-400" },
  { id:"cadastros",    label:"Cadastros",    Icon:Settings2,       activeColor:"text-purple-600 dark:text-purple-400", activeBg:"bg-purple-500/10",   activeBorder:"border-purple-500/40",   badgeBg:"bg-purple-500/15",   badgeText:"text-purple-600 dark:text-purple-400", restrictedTo:["admin","producao"] },
  { id:"paradas",      label:"Paradas",      Icon:OctagonPause,    activeColor:"text-red-600 dark:text-red-400",       activeBg:"bg-red-500/10",      activeBorder:"border-red-500/40",      badgeBg:"bg-red-500/15",      badgeText:"text-red-600 dark:text-red-400" },
  { id:"qualidade",    label:"Refugo",       Icon:ShieldAlert,     activeColor:"text-orange-600 dark:text-orange-400", activeBg:"bg-orange-500/10",   activeBorder:"border-orange-500/40",   badgeBg:"bg-orange-500/15",   badgeText:"text-orange-600 dark:text-orange-400" },
  { id:"materiaprima", label:"Mat.-Prima",   Icon:Boxes,           activeColor:"text-teal-600 dark:text-teal-400",     activeBg:"bg-teal-500/10",     activeBorder:"border-teal-500/40",     badgeBg:"bg-teal-500/15",     badgeText:"text-teal-600 dark:text-teal-400" },
];

function OfflineBanner({ pending, syncing, onSync }: { pending:number; syncing:boolean; onSync:()=>void }) {
  const offline = !navigator.onLine;
  if (!offline && pending === 0) return null;
  return (
    <div className={cn("flex items-center gap-2 px-4 py-1.5 text-xs font-medium border-b",
      offline ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
               : "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20")}>
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      {offline
        ? "Modo offline — dados salvos localmente, serão sincronizados ao reconectar"
        : `${pending} operaç${pending===1?"ão pendente":"ões pendentes"} de sincronização`}
      {!offline && pending > 0 && (
        <button onClick={onSync} disabled={syncing}
          className="ml-auto flex items-center gap-1 hover:opacity-70 transition-opacity">
          <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
          {syncing ? "Sincronizando..." : "Sincronizar agora"}
        </button>
      )}
    </div>
  );
}

export default function Producao() {
  const { role } = useAuth();
  const { isOnline, pendingCount, syncing, syncQueue } = useOfflineSync();
  const isMobile = useIsMobile();
  const isAdmin = role === "admin";
  const canWriteCadastros = role === "admin" || role === "producao";
  const [view, setView] = useState<ProdView>("diario");
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => { applyTheme(getStoredTheme()); }, []);

  // Mesmo padrão de filtro por role que já existia, agora também libera
  // "Cadastros" para quem tem role producao (o banco já permite via RLS).
  const visibleModules = MODULES.filter(m => !m.restrictedTo || m.restrictedTo.includes(role as "admin" | "producao"));
  const PAGE_NAV_TABS: PageNavTab<ProdView>[] = visibleModules.map(m => ({
    id: m.id, label: m.label, Icon: m.Icon,
    activeColor: m.activeColor, activeBg: m.activeBg, activeBorder: m.activeBorder,
    badgeBg: m.badgeBg, badgeText: m.badgeText,
  }));

  return (
    <>
    <div className="flex flex-col h-full bg-transparent">
      {/* Header harmonizado — mesmo padrão de Qualidade/Financeiro/Admin */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="px-3 sm:px-4 h-12 sm:h-14 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <Factory className="h-4 w-4 text-primary shrink-0" />
            <h1 className="text-sm font-semibold">Produção</h1>
          </div>
          <div className="flex items-center gap-1.5">
            {isAdmin && (
              <ClearHistoryButton
                rpc="admin_clear_producao"
                confirmTitle="Apagar histórico de produção?"
                confirmDescription="Apaga todos os apontamentos de produção. Máquinas e produtos continuam cadastrados."
              />
            )}
            {!isOnline && (
              <div className="flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                <WifiOff className="h-3 w-3" />
                <span className="hidden sm:inline">Offline</span>
              </div>
            )}
          </div>
        </div>
        <OfflineBanner pending={pendingCount} syncing={syncing} onSync={syncQueue} />
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="px-3 sm:px-4 py-4 space-y-4">
          <PageNav
            tabs={PAGE_NAV_TABS}
            activeTab={view}
            onTabChange={setView}
            cols={isMobile ? 3 : undefined}
          />

          <Suspense fallback={<LoadingScreen />}>
            {view === "diario"       && <LancamentoDiario />}
            {view === "desempenho"   && <DesempenhoPanel />}
            {view === "controle"     && <ControlePanel onImport={() => setImportOpen(true)} />}
            {view === "planejamento" && <PlanejamentoPanel isAdmin={isAdmin} />}
            {view === "cadastros"    && <CadastrosPanel isAdmin={isAdmin} canWrite={canWriteCadastros} />}
            {view === "paradas"      && <ParadasPanel />}
            {view === "qualidade"    && <QualidadePanel />}
            {view === "materiaprima" && <MateriaPrimaPanel />}
          </Suspense>
        </div>
      </main>
    </div>
      {importOpen && (
        <Suspense fallback={null}>
          <ImportadorPPI51 onClose={() => setImportOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
