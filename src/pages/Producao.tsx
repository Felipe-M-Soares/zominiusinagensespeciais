/**
 * Produção — Hub de Controle Industrial
 * Módulos: Dashboard, Controle de Produção, Planejamento, Máquinas,
 * Produtos, Paradas, Refugo/Qualidade, Matéria-Prima, Relatórios,
 * Usuários, Funcionalidades Futuras
 */

import { useState, useEffect, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getStoredTheme, applyTheme } from "@/pages/Settings";
import {
  ArrowLeft,
  ChevronRight,
  LayoutDashboard,
  ClipboardList,
  CalendarClock,
  Settings2,
  Package,
  OctagonPause,
  ShieldAlert,
  Boxes,
  FileBarChart2,
  Users,
  Sparkles,
  Factory,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";
import { LoadingScreen } from "@/components/LoadingScreen";

// Lazy-load dos painéis
const DashboardPanel      = lazy(() => import("@/components/producao/DashboardPanel").then(m => ({ default: m.DashboardPanel })));
const ControlePanel       = lazy(() => import("@/components/producao/ControlePanel").then(m => ({ default: m.ControlePanel })));
const PlanejamentoPanel   = lazy(() => import("@/components/producao/PlanejamentoPanel").then(m => ({ default: m.PlanejamentoPanel })));
const MaquinasPanel       = lazy(() => import("@/components/producao/MaquinasPanel").then(m => ({ default: m.MaquinasPanel })));
const ProdutosPanel       = lazy(() => import("@/components/producao/ProdutosPanel").then(m => ({ default: m.ProdutosPanel })));
const ParadasPanel        = lazy(() => import("@/components/producao/ParadasPanel").then(m => ({ default: m.ParadasPanel })));
const QualidadePanel      = lazy(() => import("@/components/producao/QualidadeProducaoPanel").then(m => ({ default: m.QualidadeProducaoPanel })));
const MateriaPrimaPanel   = lazy(() => import("@/components/producao/MateriaPrimaPanel").then(m => ({ default: m.MateriaPrimaPanel })));
const RelatoriosPanel     = lazy(() => import("@/components/producao/RelatoriosPanel").then(m => ({ default: m.RelatoriosPanel })));
const UsuariosPanel       = lazy(() => import("@/components/producao/UsuariosProducaoPanel").then(m => ({ default: m.UsuariosProducaoPanel })));
const FuturasPanel        = lazy(() => import("@/components/producao/FuturasPanel").then(m => ({ default: m.FuturasPanel })));

// ── Tipos ──────────────────────────────────────────────────────────────────────

type ProdView =
  | "menu"
  | "dashboard"
  | "controle"
  | "planejamento"
  | "maquinas"
  | "produtos"
  | "paradas"
  | "qualidade"
  | "materiaprima"
  | "relatorios"
  | "usuarios"
  | "futuras";

interface ProdModule {
  id: ProdView;
  label: string;
  sublabel: string;
  Icon: React.ElementType;
  color: string;
  bg: string;
  border: string;
  adminOnly?: boolean;
  badge?: string;
}

const MODULES: ProdModule[] = [
  {
    id: "dashboard",
    label: "Dashboard Industrial",
    sublabel: "OEE, metas, eficiência por máquina e produção em tempo real",
    Icon: LayoutDashboard,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    badge: "Tempo real",
  },
  {
    id: "controle",
    label: "Controle de Produção",
    sublabel: "Apontamento, registro por lote, turno e operador",
    Icon: ClipboardList,
    color: "text-green-600 dark:text-green-400",
    bg: "bg-green-500/10",
    border: "border-green-500/20",
  },
  {
    id: "planejamento",
    label: "Planejamento de Produção",
    sublabel: "Ordens de produção, carga por máquina e previsão de turnos",
    Icon: CalendarClock,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  {
    id: "maquinas",
    label: "Cadastro de Máquinas",
    sublabel: "Status, disponibilidade, histórico de manutenção e setores",
    Icon: Settings2,
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
    adminOnly: true,
  },
  {
    id: "produtos",
    label: "Cadastro de Produtos",
    sublabel: "Código, tempo de ciclo, peças/hora, material e lead time",
    Icon: Package,
    color: "text-cyan-600 dark:text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/20",
    adminOnly: true,
  },
  {
    id: "paradas",
    label: "Controle de Paradas",
    sublabel: "Registro, motivos, cronômetro automático e indicadores de perda",
    Icon: OctagonPause,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
  },
  {
    id: "qualidade",
    label: "Refugo e Qualidade",
    sublabel: "Defeitos, fotos, controle dimensional e índice de perdas",
    Icon: ShieldAlert,
    color: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/20",
  },
  {
    id: "materiaprima",
    label: "Controle de Matéria-Prima",
    sublabel: "Estoque, baixa automática, rastreabilidade e alertas de lote",
    Icon: Boxes,
    color: "text-teal-600 dark:text-teal-400",
    bg: "bg-teal-500/10",
    border: "border-teal-500/20",
  },
  {
    id: "relatorios",
    label: "Relatórios",
    sublabel: "Produção diária/mensal, eficiência, paradas, exportação PDF/Excel",
    Icon: FileBarChart2,
    color: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-500/10",
    border: "border-indigo-500/20",
  },
  {
    id: "usuarios",
    label: "Controle de Usuários",
    sublabel: "Perfis admin, supervisor, operador e qualidade com permissões",
    Icon: Users,
    color: "text-pink-600 dark:text-pink-400",
    bg: "bg-pink-500/10",
    border: "border-pink-500/20",
    adminOnly: true,
  },
  {
    id: "futuras",
    label: "Funcionalidades Futuras",
    sublabel: "Roadmap: IoT, ERP, IA preditiva, mobile e alertas automáticos",
    Icon: Sparkles,
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/20",
    badge: "Roadmap",
  },
];

// ── Menu Principal ─────────────────────────────────────────────────────────────

function ProdMenu({ isAdmin, onSelect }: { isAdmin: boolean; onSelect: (v: ProdView) => void }) {
  const visible = MODULES.filter(m => !m.adminOnly || isAdmin);

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="rounded-2xl border bg-card/60 p-4">
        <div className="flex items-center gap-3 mb-1">
          <Factory className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Controle Industrial de Produção</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Sistema completo de manufatura: dashboard em tempo real, apontamento, planejamento,
          qualidade, matéria-prima, relatórios e muito mais.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map(m => (
          <button
            key={m.id}
            onClick={() => onSelect(m.id)}
            className={cn(
              "rounded-2xl border p-4 text-left flex items-center gap-4 transition-all",
              "hover:shadow-sm active:scale-[0.99]",
              m.bg, m.border
            )}
          >
            <div className={cn("h-11 w-11 rounded-xl flex items-center justify-center shrink-0", m.bg)}>
              <m.Icon className={cn("h-5 w-5", m.color)} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className={cn("font-semibold text-sm", m.color)}>{m.label}</p>
                {m.badge && (
                  <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md", m.bg, m.color)}>
                    {m.badge}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
                {m.sublabel}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function Producao() {
  const navigate = useNavigate();
  const { profile, role } = useAuth();
  const isAdmin = role === "admin";
  const [view, setView] = useState<ProdView>("menu");

  useEffect(() => {
    applyTheme(getStoredTheme());
  }, []);

  const currentModule = MODULES.find(m => m.id === view);

  function goBack() {
    if (view !== "menu") setView("menu");
    else navigate(-1);
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={goBack}
            className="h-8 w-8 rounded-xl flex items-center justify-center hover:bg-muted/40 transition-colors shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Logo className="h-7 w-auto shrink-0" />
          <div className="h-5 w-px bg-border/50" />
          <div className="flex items-center gap-2 min-w-0">
            <Factory className="h-4 w-4 text-primary shrink-0" />
            <span className="font-semibold text-sm truncate">
              {view === "menu" ? "Produção" : currentModule?.label ?? "Produção"}
            </span>
          </div>
          <div className="flex-1" />
          {profile?.display_name && (
            <span className="text-[11px] text-muted-foreground hidden sm:block truncate max-w-[140px]">
              {profile.display_name}
            </span>
          )}
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-4">
        {view === "menu" && (
          <ProdMenu isAdmin={isAdmin} onSelect={setView} />
        )}
        {view !== "menu" && (
          <Suspense fallback={<LoadingScreen />}>
            {view === "dashboard"    && <DashboardPanel />}
            {view === "controle"     && <ControlePanel isAdmin={isAdmin} />}
            {view === "planejamento" && <PlanejamentoPanel isAdmin={isAdmin} />}
            {view === "maquinas"     && <MaquinasPanel isAdmin={isAdmin} />}
            {view === "produtos"     && <ProdutosPanel isAdmin={isAdmin} />}
            {view === "paradas"      && <ParadasPanel />}
            {view === "qualidade"    && <QualidadePanel />}
            {view === "materiaprima" && <MateriaPrimaPanel />}
            {view === "relatorios"   && <RelatoriosPanel isAdmin={isAdmin} />}
            {view === "usuarios"     && <UsuariosPanel isAdmin={isAdmin} />}
            {view === "futuras"      && <FuturasPanel />}
          </Suspense>
        )}
      </main>
    </div>
  );
}
