/**
 * Produção — Hub de Controle Industrial
 * Layout harmonizado com o restante do app: header + PageNav (mesmo padrão
 * de Qualidade/Financeiro/Admin), em vez do grid de cards customizado
 * anterior. Entra direto na primeira aba (Dashboard), sem tela de menu
 * intermediária — mesmo comportamento de Financeiro.tsx.
 */

import { useState, useEffect, lazy, Suspense } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useIsMobile } from "@/hooks/use-mobile";
import { getStoredTheme, applyTheme } from "@/lib/theme";
import {
  LayoutDashboard, ClipboardList, CalendarClock,
  Settings2, Package, OctagonPause, ShieldAlert, Boxes, FileBarChart2,
  Factory, WifiOff, RefreshCw, Wrench, Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LoadingScreen } from "@/components/LoadingScreen";
import { PageNav, type PageNavTab } from "@/components/PageNav";
import { ClearHistoryButton } from "@/components/admin/ClearHistoryButton";

const DashboardPanel    = lazy(() => import("@/components/producao/DashboardPanel").then(m => ({ default: m.DashboardPanel })));
const ControlePanel     = lazy(() => import("@/components/producao/ControlePanel").then(m => ({ default: m.ControlePanel })));
const PlanejamentoPanel = lazy(() => import("@/components/producao/PlanejamentoPanel").then(m => ({ default: m.PlanejamentoPanel })));
const MaquinasPanel     = lazy(() => import("@/components/producao/MaquinasPanel").then(m => ({ default: m.MaquinasPanel })));
const ProdutosPanel     = lazy(() => import("@/components/producao/ProdutosPanel").then(m => ({ default: m.ProdutosPanel })));
const ParadasPanel      = lazy(() => import("@/components/producao/ParadasPanel").then(m => ({ default: m.ParadasPanel })));
const QualidadePanel    = lazy(() => import("@/components/producao/QualidadeProducaoPanel").then(m => ({ default: m.QualidadeProducaoPanel })));
const MateriaPrimaPanel = lazy(() => import("@/components/producao/MateriaPrimaPanel").then(m => ({ default: m.MateriaPrimaPanel })));
const RelatoriosPanel   = lazy(() => import("@/components/producao/RelatoriosPanel").then(m => ({ default: m.RelatoriosPanel })));
const ImportadorPPI51  = lazy(() => import("@/components/producao/ImportadorPPI51").then(m => ({ default: m.ImportadorPPI51 })));
const FerramentasPanel  = lazy(() => import("@/components/producao/FerramentasPanel").then(m => ({ default: m.FerramentasPanel })));
const MetasPanel        = lazy(() => import("@/components/producao/MetasPanel").then(m => ({ default: m.MetasPanel })));

type ProdView = "dashboard"|"controle"|"planejamento"|"metas"|"maquinas"|"produtos"|"paradas"|"qualidade"|"ferramentas"|"materiaprima"|"relatorios";

interface ProdModule {
  id: ProdView; label: string;
  Icon: React.ElementType;
  activeColor: string; activeBg: string; activeBorder: string; badgeBg: string; badgeText: string;
  adminOnly?: boolean;
}

// Mesmas cores temáticas de antes, só reorganizadas no formato que PageNav espera
// (activeColor/activeBg/activeBorder/badgeBg/badgeText) — mesmo padrão usado em
// Qualidade.tsx e Financeiro.tsx para as próprias abas.
const MODULES: ProdModule[] = [
  { id:"dashboard",    label:"Dashboard",    Icon:LayoutDashboard, activeColor:"text-blue-600 dark:text-blue-400",     activeBg:"bg-blue-500/10",     activeBorder:"border-blue-500/40",     badgeBg:"bg-blue-500/15",     badgeText:"text-blue-600 dark:text-blue-400" },
  { id:"controle",     label:"Controle",     Icon:ClipboardList,   activeColor:"text-green-600 dark:text-green-400",   activeBg:"bg-green-500/10",    activeBorder:"border-green-500/40",    badgeBg:"bg-green-500/15",    badgeText:"text-green-600 dark:text-green-400" },
  { id:"planejamento", label:"Planejamento", Icon:CalendarClock,   activeColor:"text-amber-600 dark:text-amber-400",   activeBg:"bg-amber-500/10",    activeBorder:"border-amber-500/40",    badgeBg:"bg-amber-500/15",    badgeText:"text-amber-600 dark:text-amber-400" },
  { id:"maquinas",     label:"Máquinas",     Icon:Settings2,       activeColor:"text-purple-600 dark:text-purple-400", activeBg:"bg-purple-500/10",   activeBorder:"border-purple-500/40",   badgeBg:"bg-purple-500/15",   badgeText:"text-purple-600 dark:text-purple-400", adminOnly:true },
  { id:"produtos",     label:"Produtos",     Icon:Package,         activeColor:"text-cyan-600 dark:text-cyan-400",     activeBg:"bg-cyan-500/10",     activeBorder:"border-cyan-500/40",     badgeBg:"bg-cyan-500/15",     badgeText:"text-cyan-600 dark:text-cyan-400", adminOnly:true },
  { id:"paradas",      label:"Paradas",      Icon:OctagonPause,    activeColor:"text-red-600 dark:text-red-400",       activeBg:"bg-red-500/10",      activeBorder:"border-red-500/40",      badgeBg:"bg-red-500/15",      badgeText:"text-red-600 dark:text-red-400" },
  { id:"qualidade",    label:"Refugo",       Icon:ShieldAlert,     activeColor:"text-orange-600 dark:text-orange-400", activeBg:"bg-orange-500/10",   activeBorder:"border-orange-500/40",   badgeBg:"bg-orange-500/15",   badgeText:"text-orange-600 dark:text-orange-400" },
  { id:"materiaprima", label:"Mat.-Prima",   Icon:Boxes,           activeColor:"text-teal-600 dark:text-teal-400",     activeBg:"bg-teal-500/10",     activeBorder:"border-teal-500/40",     badgeBg:"bg-teal-500/15",     badgeText:"text-teal-600 dark:text-teal-400" },
  { id:"metas",        label:"Metas",        Icon:Target,          activeColor:"text-emerald-600 dark:text-emerald-400", activeBg:"bg-emerald-500/10", activeBorder:"border-emerald-500/40", badgeBg:"bg-emerald-500/15", badgeText:"text-emerald-600 dark:text-emerald-400" },
  { id:"ferramentas",  label:"Ferramentas",  Icon:Wrench,          activeColor:"text-rose-600 dark:text-rose-400",     activeBg:"bg-rose-500/10",     activeBorder:"border-rose-500/40",     badgeBg:"bg-rose-500/15",     badgeText:"text-rose-600 dark:text-rose-400" },
  { id:"relatorios",   label:"Relatórios",   Icon:FileBarChart2,   activeColor:"text-indigo-600 dark:text-indigo-400", activeBg:"bg-indigo-500/10",    activeBorder:"border-indigo-500/40",   badgeBg:"bg-indigo-500/15",   badgeText:"text-indigo-600 dark:text-indigo-400" },
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
  const [view, setView] = useState<ProdView>("dashboard");
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => { applyTheme(getStoredTheme()); }, []);

  // Mesmo padrão de filtro por role que já existia, só reaplicado às tabs do PageNav
  const visibleModules = MODULES.filter(m => !m.adminOnly || isAdmin);
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
            {view === "dashboard"    && <DashboardPanel />}
            {view === "controle"     && <ControlePanel />}
            {view === "planejamento" && <PlanejamentoPanel isAdmin={isAdmin} />}
            {view === "maquinas"     && <MaquinasPanel isAdmin={isAdmin} />}
            {view === "produtos"     && <ProdutosPanel isAdmin={isAdmin} />}
            {view === "paradas"      && <ParadasPanel />}
            {view === "qualidade"    && <QualidadePanel />}
            {view === "metas"        && <MetasPanel />}
            {view === "ferramentas"  && <FerramentasPanel />}
            {view === "materiaprima" && <MateriaPrimaPanel />}
            {view === "relatorios"   && <RelatoriosPanel onImport={() => setImportOpen(true)} />}
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
