/**
 * MRP — Hub de Planejamento de Recursos de Manufatura
 * Navegação para todos os módulos MRP: BOM, OPs, Fornecedores, Financeiro.
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getStoredTheme, applyTheme } from "@/pages/Settings";
import {
  Factory, ArrowLeft, Layers, Building2,
  ClipboardList, DollarSign, ChevronRight, ShieldCheck,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";
import { lazy, Suspense } from "react";
import { LoadingScreen } from "@/components/LoadingScreen";

const FornecedoresPanel   = lazy(() => import("@/components/mrp/FornecedoresPanel").then(m => ({ default: m.FornecedoresPanel })));
const OrdensProducaoPanel = lazy(() => import("@/components/mrp/OrdensProducaoPanel").then(m => ({ default: m.OrdensProducaoPanel })));
const BOMPanel            = lazy(() => import("@/components/mrp/BOMPanel").then(m => ({ default: m.BOMPanel })));
const FinanceiroMRPPanel  = lazy(() => import("@/components/mrp/FinanceiroMRPPanel").then(m => ({ default: m.FinanceiroMRPPanel })));
const QualidadePanel      = lazy(() => import("@/components/mrp/QualidadePanel").then(m => ({ default: m.QualidadePanel })));

// ── Tipos ─────────────────────────────────────────────────────────────────────

type MRPView = "menu" | "bom" | "ops" | "fornecedores" | "financeiro" | "qualidade";

interface MRPModule {
  id: MRPView;
  label: string;
  sublabel: string;
  Icon: React.ElementType;
  color: string;
  bg: string;
  border: string;
  adminOnly?: boolean;
}

const MODULES: MRPModule[] = [
  {
    id: "ops",
    label: "Ordens de Produção",
    sublabel: "Criar, iniciar e concluir OPs com rastreamento completo",
    Icon: ClipboardList,
    color: "text-green-600 dark:text-green-400",
    bg: "bg-green-500/10",
    border: "border-green-500/20",
  },
  {
    id: "bom",
    label: "Estrutura de Produto",
    sublabel: "Bill of Materials — componentes e matérias-primas por produto",
    Icon: Layers,
    color: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/20",
    adminOnly: true,
  },
  {
    id: "fornecedores",
    label: "Fornecedores",
    sublabel: "Cadastro, avaliação e lead times de fornecedores",
    Icon: Building2,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    adminOnly: true,
  },
  {
    id: "financeiro",
    label: "Contas a Receber",
    sublabel: "Gestão de recebíveis e fluxo de caixa por período",
    Icon: DollarSign,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
  {
    id: "qualidade",
    label: "Qualidade / RNC",
    sublabel: "Registro e análise de não conformidades — causa raiz e ações corretivas",
    Icon: ShieldCheck,
    color: "text-destructive",
    bg: "bg-destructive/10",
    border: "border-destructive/20",
  },
];

// ── MRP Menu ──────────────────────────────────────────────────────────────────
function MRPMenu({ isAdmin, onSelect }: {
  isAdmin: boolean; onSelect: (v: MRPView) => void;
}) {
  const visible = MODULES.filter(m => !m.adminOnly || isAdmin);

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="rounded-2xl border bg-card/60 p-4">
        <div className="flex items-center gap-3 mb-1">
          <Factory className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Planejamento de Recursos (MRP)</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Módulos integrados de manufatura: estrutura de produto, ordens de produção,
          fornecedores e controle financeiro.
        </p>
      </div>

      <div className="grid gap-3">
        {visible.map(m => (
          <button key={m.id} onClick={() => onSelect(m.id)}
            className={cn(
              "rounded-2xl border p-4 text-left flex items-center gap-4 transition-all",
              "hover:shadow-sm active:scale-[0.99]",
              m.bg, m.border
            )}>
            <div className={cn("h-12 w-12 rounded-2xl flex items-center justify-center shrink-0", m.bg)}>
              <m.Icon className={cn("h-6 w-6", m.color)} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn("font-semibold text-sm", m.color)}>{m.label}</p>
              <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">{m.sublabel}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function MRP() {
  const navigate = useNavigate();
  const { profile, role } = useAuth();
  const isAdmin = role === "admin";
  const [view, setView] = useState<MRPView>("menu");

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
          <button onClick={goBack}
            className="h-8 w-8 rounded-xl flex items-center justify-center hover:bg-muted/40 transition-colors shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Logo className="h-7 w-auto shrink-0" />
          <div className="h-5 w-px bg-border/50" />
          <div className="flex items-center gap-2 min-w-0">
            <Factory className="h-4 w-4 text-primary shrink-0" />
            <span className="font-semibold text-sm truncate">
              {view === "menu" ? "MRP" : currentModule?.label ?? "MRP"}
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
          <MRPMenu isAdmin={isAdmin} onSelect={setView} />
        )}
        {view !== "menu" && (
          <Suspense fallback={<LoadingScreen />}>
            {view === "bom"          && <BOMPanel isAdmin={isAdmin} />}
            {view === "ops"          && <OrdensProducaoPanel isAdmin={isAdmin} />}
            {view === "fornecedores" && <FornecedoresPanel isAdmin={isAdmin} />}
            {view === "financeiro"   && <FinanceiroMRPPanel />}
            {view === "qualidade"    && <QualidadePanel />}
          </Suspense>
        )}
      </main>
    </div>
  );
}
