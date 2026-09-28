/**
 * Financeiro — 5 abas (antes eram 8):
 *   Visão geral · Faturamento (NF-e + devoluções) · Contas (a receber, a pagar,
 *   fluxo de caixa — inclui as antigas "Lançamentos") · Preços e custos ·
 *   Configurações (dados fiscais, emissor, bancos).
 * Compras e Fornecedores ficam no módulo Processos (antes eram duplicados aqui).
 */
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeftRight, LayoutDashboard, Receipt, Settings2, Tag, Wallet } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { temPapel } from "@/types/roles";
import { PageNav } from "@/components/PageNav";
import { useIsMobile } from "@/hooks/use-mobile";
import { ClearHistoryButton } from "@/components/admin/ClearHistoryButton";
import { carregarEmissor, EMISSOR_INICIAL, type EmissorStatus } from "@/components/financeiro/fiscal";
import { Loader2 } from "lucide-react";

const VisaoGeralPanel = lazy(() => import("@/components/financeiro/VisaoGeralPanel").then(m => ({ default: m.VisaoGeralPanel })));
const FaturamentoPanel = lazy(() => import("@/components/financeiro/FaturamentoPanel").then(m => ({ default: m.FaturamentoPanel })));
const ContasPanel = lazy(() => import("@/components/financeiro/FluxoCaixaPanel").then(m => ({ default: m.FluxoCaixaPanel })));
const ConfiguracoesPanel = lazy(() => import("@/components/financeiro/ConfiguracoesPanel").then(m => ({ default: m.ConfiguracoesPanel })));
const TabelaPrecos = lazy(() => import("@/components/TabelaPrecos").then(m => ({ default: m.TabelaPrecos })));

type Aba = "visao" | "faturamento" | "contas" | "precos" | "configuracoes";
const ABAS: Aba[] = ["visao", "faturamento", "contas", "precos", "configuracoes"];

const TABS = [
  { id: "visao" as const,         label: "Visão geral",      Icon: LayoutDashboard, activeColor: "text-primary", activeBg: "bg-primary/10", activeBorder: "border-primary/40", badgeBg: "bg-primary/15", badgeText: "text-primary" },
  { id: "faturamento" as const,   label: "Faturamento",      Icon: Receipt,        activeColor: "text-emerald-600 dark:text-emerald-400", activeBg: "bg-emerald-500/10", activeBorder: "border-emerald-500/40", badgeBg: "bg-emerald-500/15", badgeText: "text-emerald-600 dark:text-emerald-400" },
  { id: "contas" as const,        label: "Contas",           Icon: ArrowLeftRight, activeColor: "text-blue-600 dark:text-blue-400", activeBg: "bg-blue-500/10", activeBorder: "border-blue-500/40", badgeBg: "bg-blue-500/15", badgeText: "text-blue-600 dark:text-blue-400" },
  { id: "precos" as const,        label: "Preços e custos",  Icon: Tag,            activeColor: "text-amber-600 dark:text-amber-400", activeBg: "bg-amber-500/10", activeBorder: "border-amber-500/40", badgeBg: "bg-amber-500/15", badgeText: "text-amber-600 dark:text-amber-400" },
  { id: "configuracoes" as const, label: "Configurações",    Icon: Settings2,      activeColor: "text-violet-600 dark:text-violet-400", activeBg: "bg-violet-500/10", activeBorder: "border-violet-500/40", badgeBg: "bg-violet-500/15", badgeText: "text-violet-600 dark:text-violet-400" },
];

export default function Financeiro() {
  const { isAdmin, role } = useAuth();
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const abaUrl = params.get("aba") as Aba | null;
  const aba: Aba = abaUrl && ABAS.includes(abaUrl) ? abaUrl : "visao";
  const setAba = useCallback((a: Aba) => setParams(p => { const n = new URLSearchParams(p); n.set("aba", a); return n; }, { replace: true }), [setParams]);
  const [emissor, setEmissor] = useState<EmissorStatus>(EMISSOR_INICIAL);
  const [versao, setVersao] = useState(0);
  const atualizarEmissor = useCallback(() => { carregarEmissor().then(setEmissor); }, []);
  useEffect(() => { atualizarEmissor(); }, [atualizarEmissor]);

  if (!temPapel(role, "financeiro")) return null;

  return (
    <div className="flex flex-col h-full bg-transparent">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="px-3 sm:px-4 h-12 sm:h-14 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary shrink-0" />
            <div>
              <h1 className="text-sm font-semibold leading-tight">Financeiro</h1>
              <p className="hidden sm:block text-[10px] text-muted-foreground leading-tight">Faturamento, contas a pagar e receber, fluxo de caixa</p>
            </div>
          </div>
          {isAdmin && (
            <ClearHistoryButton
              rpc="admin_clear_financeiro"
              confirmTitle="Apagar histórico financeiro?"
              confirmDescription="Apaga contas a pagar/receber e devoluções SEM nota fiscal. Notas fiscais autorizadas e o que está ligado a elas são mantidos (guarda obrigatória de 5 anos)."
              onCleared={() => setVersao(v => v + 1)}
            />
          )}
        </div>
      </header>
      <main className="flex-1 overflow-y-auto">
        <div className="px-3 sm:px-4 py-4 space-y-4">
          <PageNav tabs={TABS} activeTab={aba} onTabChange={setAba} cols={isMobile ? 3 : undefined} />
          <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
            <div key={versao}>
              {aba === "visao" && <VisaoGeralPanel emissor={emissor} irPara={setAba} />}
              {aba === "faturamento" && <FaturamentoPanel emissor={emissor} onIrConfig={() => setAba("configuracoes")} />}
              {aba === "contas" && <ContasPanel />}
              {aba === "precos" && <TabelaPrecos modo="financeiro" />}
              {aba === "configuracoes" && <ConfiguracoesPanel emissor={emissor} onEmissorMudou={atualizarEmissor} />}
            </div>
          </Suspense>
        </div>
      </main>
    </div>
  );
}
