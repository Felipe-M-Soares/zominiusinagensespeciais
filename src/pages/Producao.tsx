/**
 * Produção — Hub de Controle Industrial
 * Layout harmonizado com Estoque (PageNav + cards clicáveis)
 */

import { useState, useEffect, lazy, Suspense } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { getStoredTheme, applyTheme } from "@/lib/theme";
import {
  ChevronRight, LayoutDashboard, ClipboardList, CalendarClock,
  Settings2, Package, OctagonPause, ShieldAlert, Boxes, FileBarChart2,
  Factory, WifiOff, RefreshCw, ArrowLeft, Wrench, Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LoadingScreen } from "@/components/LoadingScreen";
import { PageNav } from "@/components/PageNav";
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

type ProdView = "menu"|"dashboard"|"controle"|"planejamento"|"metas"|"maquinas"|"produtos"|"paradas"|"qualidade"|"ferramentas"|"materiaprima"|"relatorios";

interface ProdModule {
  id: ProdView; label: string; sublabel: string;
  Icon: React.ElementType; color: string; bg: string; border: string;
  adminOnly?: boolean; badge?: string;
}

const MODULES: ProdModule[] = [
  { id:"dashboard",   label:"Dashboard Industrial",       sublabel:"OEE, metas, eficiência por máquina e produção em tempo real",        Icon:LayoutDashboard, color:"text-blue-600 dark:text-blue-400",   bg:"bg-blue-500/10",   border:"border-blue-500/20",   badge:"Tempo real" },
  { id:"controle",    label:"Controle de Produção",       sublabel:"Apontamento, registro por lote, turno e operador",                    Icon:ClipboardList,   color:"text-green-600 dark:text-green-400",  bg:"bg-green-500/10",  border:"border-green-500/20"  },
  { id:"planejamento",label:"Planejamento de Produção",   sublabel:"Ordens de produção, carga por máquina e previsão de turnos",          Icon:CalendarClock,   color:"text-amber-600 dark:text-amber-400",  bg:"bg-amber-500/10",  border:"border-amber-500/20"  },
  { id:"maquinas",    label:"Cadastro de Máquinas",       sublabel:"Status, disponibilidade, histórico de manutenção e setores",          Icon:Settings2,       color:"text-purple-600 dark:text-purple-400",bg:"bg-purple-500/10", border:"border-purple-500/20", adminOnly:true },
  { id:"produtos",    label:"Cadastro de Produtos",       sublabel:"Código, tempo de ciclo, peças/hora, material e lead time",            Icon:Package,         color:"text-cyan-600 dark:text-cyan-400",    bg:"bg-cyan-500/10",   border:"border-cyan-500/20",   adminOnly:true },
  { id:"paradas",     label:"Controle de Paradas",        sublabel:"Registro, motivos, cronômetro automático e indicadores de perda",     Icon:OctagonPause,    color:"text-red-600 dark:text-red-400",      bg:"bg-red-500/10",    border:"border-red-500/20"    },
  { id:"qualidade",   label:"Refugo e Qualidade",         sublabel:"Defeitos, fotos, controle dimensional e índice de perdas",            Icon:ShieldAlert,     color:"text-orange-600 dark:text-orange-400",bg:"bg-orange-500/10", border:"border-orange-500/20" },
  { id:"materiaprima",label:"Controle de Matéria-Prima",  sublabel:"Estoque, baixa automática, rastreabilidade e alertas de lote",        Icon:Boxes,           color:"text-teal-600 dark:text-teal-400",    bg:"bg-teal-500/10",   border:"border-teal-500/20"   },
  { id:"metas",       label:"Metas de Produção",        sublabel:"Defina e acompanhe metas mensais de OEE, disponibilidade e peças produzidas.", Icon:Target,         color:"text-emerald-600 dark:text-emerald-400",bg:"bg-emerald-500/10",border:"border-emerald-500/20" },
  { id:"ferramentas", label:"Ferramentas CNC",            sublabel:"Vida útil de brocas, insertos e pastilhas. Alertas de troca preventiva.", Icon:Wrench,         color:"text-rose-600 dark:text-rose-400",    bg:"bg-rose-500/10",   border:"border-rose-500/20"   },
  { id:"relatorios",  label:"Relatórios & Import PPI-51",                 sublabel:"Produção diária/mensal, eficiência, paradas, exportação PDF/Excel",   Icon:FileBarChart2,   color:"text-indigo-600 dark:text-indigo-400",bg:"bg-indigo-500/10", border:"border-indigo-500/20" },
];

// Nav tabs para módulos de Produção (só aparece quando dentro de um módulo)
const PROD_TABS = MODULES.map(m => ({
  id: m.id,
  label: m.label.split(" ")[0], // primeira palavra pra ficar curto
  Icon: m.Icon,
  activeColor: m.color,
  activeBg: m.bg,
  activeBorder: m.border.replace("border-", "border-").replace("/20", "/40"),
  badgeBg: m.bg,
  badgeText: m.color,
}));

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

// Menu principal de produção — grade de cards clicáveis (igual ao padrão Estoque)
function ProdMenu({ isAdmin, onSelect }: { isAdmin:boolean; onSelect:(v:ProdView)=>void }) {
  const visible = MODULES.filter(m => !m.adminOnly || isAdmin);
  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="rounded-xl border bg-primary/5 border-primary/20 text-primary/80 px-4 py-3 text-[12px]">
        Sistema completo de manufatura: dashboard em tempo real, apontamento, planejamento, qualidade, matéria-prima e relatórios.
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
            className={cn(
              "group rounded-2xl border p-4 text-left flex items-center gap-4",
              "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]",
              m.bg, m.border
            )}
            style={{
              boxShadow: "0 1px 2px hsl(var(--border) / 0.3), 0 4px 12px -2px hsl(var(--border) / 0.15)",
            }}
          >
            <div className={cn("h-11 w-11 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110", m.bg)}>
              <m.Icon className={cn("h-5 w-5", m.color)} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className={cn("font-semibold text-sm", m.color)}>{m.label}</p>
                {m.badge && (
                  <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md", m.bg, m.color)}>{m.badge}</span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">{m.sublabel}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0 transition-transform group-hover:translate-x-0.5" />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Producao() {
  const { role } = useAuth();
  const { isOnline, pendingCount, syncing, syncQueue } = useOfflineSync();
  const isAdmin = role === "admin";
  const [view, setView] = useState<ProdView>("menu");
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => { applyTheme(getStoredTheme()); }, []);

  const currentModule = MODULES.find(m => m.id === view);

  return (
    <>
    <div className="flex flex-col h-full bg-transparent">
      {/* Header harmonizado */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="max-w-7xl mx-auto px-2 sm:px-4 h-14 flex items-center gap-3">
          {view !== "menu" && (
            <button
              type="button"
              onClick={() => setView("menu")}
              className="h-8 w-8 rounded-xl flex items-center justify-center hover:bg-muted/40 transition-colors shrink-0 text-muted-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <Factory className="h-4 w-4 text-primary shrink-0" />
          <span className="font-semibold text-sm truncate">
            {view === "menu" ? "Produção" : currentModule?.label ?? "Produção"}
          </span>
          <div className="flex-1" />
          {view === "menu" && isAdmin && (
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
        <OfflineBanner pending={pendingCount} syncing={syncing} onSync={syncQueue} />
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto w-full px-3 sm:px-4 py-4 space-y-4">
        {view === "menu" && <ProdMenu isAdmin={isAdmin} onSelect={setView} />}
        {view !== "menu" && (
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
        )}
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
