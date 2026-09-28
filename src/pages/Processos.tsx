/**
 * Processos — ferramentas de corte (vida útil), faltas → compras,
 * fornecedores e biblioteca de programas CNC.
 * A aba aberta fica na URL (?aba=...), como no Financeiro.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Boxes, ClipboardList, Code2, ShoppingCart, Truck, Workflow, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { PageNav, type PageNavTab } from "@/components/PageNav";
import { FornecedoresPanel } from "@/components/compras/FornecedoresPanel";
import { PedidosCompraPanel } from "@/components/compras/PedidosCompraPanel";
import { FerramentasPanel } from "@/components/processos/FerramentasPanel";
import { FaltasPanel } from "@/components/processos/FaltasPanel";
import { CodigosPanel } from "@/components/processos/CodigosPanel";
import { emFaltaStatus, type Ferramenta } from "@/components/processos/shared";
import { toast } from "sonner";

type Tab = "ferramentas" | "faltas" | "compras" | "fornecedores" | "codigos";
const TABS_VALIDAS: Tab[] = ["ferramentas", "faltas", "compras", "fornecedores", "codigos"];

export default function Processos() {
  const [params, setParams] = useSearchParams();
  const abaUrl = params.get("aba") as Tab | null;
  const tab: Tab = abaUrl && TABS_VALIDAS.includes(abaUrl) ? abaUrl : "ferramentas";
  const setTab = useCallback((t: Tab) => setParams(p => { const n = new URLSearchParams(p); n.set("aba", t); return n; }, { replace: true }), [setParams]);

  const [ferramentas, setFerramentas] = useState<Ferramenta[]>([]);
  const [loadingFerramentas, setLoadingFerramentas] = useState(true);
  const [pedidosAbertos, setPedidosAbertos] = useState(0);
  const [filtroFerr, setFiltroFerr] = useState<{ v: "todas" | "ativo" | "falta"; k: number }>({ v: "todas", k: 0 });

  const fetchFerramentas = useCallback(async () => {
    setLoadingFerramentas(true);
    const { data, error } = await supabase.from("ferramentas_cnc").select("*").order("codigo");
    if (error) { logger.error("fetchFerramentas error:", error.message); toast.error("Erro ao carregar ferramentas."); }
    else setFerramentas((data ?? []) as Ferramenta[]);
    setLoadingFerramentas(false);
  }, []);

  const fetchPedidosAbertos = useCallback(async () => {
    const { count } = await supabase
      .from("pedidos_compra")
      .select("id", { count: "exact", head: true })
      .not("status", "in", "(recebido,cancelado)");
    setPedidosAbertos(count ?? 0);
  }, []);

  useEffect(() => { fetchFerramentas(); fetchPedidosAbertos(); }, [fetchFerramentas, fetchPedidosAbertos]);
  // Ao sair de Compras, atualiza o contador de pedidos em aberto.
  useEffect(() => { if (tab !== "compras") fetchPedidosAbertos(); }, [tab, fetchPedidosAbertos]);

  const emFalta = useMemo(() => ferramentas.filter(emFaltaStatus), [ferramentas]);
  const totalAtivas = ferramentas.filter(f => f.status === "ativo").length;

  const tabs: PageNavTab<Tab>[] = useMemo(() => [
    { id: "ferramentas", label: "Ferramentas", Icon: Wrench, activeColor: "text-primary", activeBg: "bg-primary/10", activeBorder: "border-primary/40", badgeBg: "bg-primary/15", badgeText: "text-primary" },
    { id: "faltas", label: "Faltas", Icon: AlertTriangle, badge: emFalta.length, activeColor: "text-warning", activeBg: "bg-warning/10", activeBorder: "border-warning/40", badgeBg: "bg-warning/20", badgeText: "text-warning" },
    { id: "compras", label: "Compras", Icon: ShoppingCart, badge: pedidosAbertos, activeColor: "text-success", activeBg: "bg-success/10", activeBorder: "border-success/40", badgeBg: "bg-success/15", badgeText: "text-success" },
    { id: "fornecedores", label: "Fornecedores", Icon: Truck, activeColor: "text-primary", activeBg: "bg-primary/10", activeBorder: "border-primary/40", badgeBg: "bg-primary/15", badgeText: "text-primary" },
    { id: "codigos", label: "Códigos CNC", Icon: Code2, activeColor: "text-violet-600 dark:text-violet-400", activeBg: "bg-violet-500/10", activeBorder: "border-violet-500/40", badgeBg: "bg-violet-500/15", badgeText: "text-violet-600 dark:text-violet-400" },
  ], [emFalta.length, pedidosAbertos]);

  const irFerramentas = (v: "todas" | "ativo" | "falta") => { setFiltroFerr(prev => ({ v, k: prev.k + 1 })); setTab("ferramentas"); };

  return (
    <div className="flex flex-col h-full bg-transparent">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="px-3 sm:px-4 h-12 sm:h-14 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Workflow className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0">
              <h1 className="text-sm font-semibold leading-tight">Processos</h1>
              <p className="hidden sm:block text-[10px] text-muted-foreground leading-tight">Ferramentas, compras, fornecedores e programas CNC</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTab("faltas")}
            className={cn(
              "rounded-full px-2.5 h-8 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 transition-colors",
              emFalta.length ? "bg-destructive/10 text-destructive hover:bg-destructive/15" : "bg-success/10 text-success hover:bg-success/15"
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {emFalta.length ? `${emFalta.length} em falta` : "Ferramentas OK"}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="px-3 sm:px-4 py-4 space-y-4">
          <PageNav tabs={tabs} activeTab={tab} onTabChange={setTab} ariaLabel="Seções de Processos" />

          {tab === "ferramentas" && (
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-3">
              <Kpi title="Ferramentas" value={ferramentas.length} icon={Wrench} tone="primary" onClick={() => irFerramentas("todas")} />
              <Kpi title="Em uso" value={totalAtivas} icon={Boxes} tone="success" onClick={() => irFerramentas("ativo")} />
              <Kpi title="Perto do limite / trocar" value={emFalta.length} icon={AlertTriangle} tone={emFalta.length ? "destructive" : "muted"} onClick={() => setTab("faltas")} />
              <Kpi title="Compras em aberto" value={pedidosAbertos} icon={ClipboardList} tone="warning" onClick={() => setTab("compras")} />
            </div>
          )}

          {tab === "ferramentas" && (
            <FerramentasPanel key={filtroFerr.k} filtroInicial={filtroFerr.v} ferramentas={ferramentas} loading={loadingFerramentas} onChange={fetchFerramentas} />
          )}
          {tab === "faltas" && (
            <FaltasPanel ferramentas={emFalta} onChange={() => { fetchFerramentas(); fetchPedidosAbertos(); }} onIrCompras={() => setTab("compras")} />
          )}
          {tab === "compras" && <PedidosCompraPanel contexto="ferramentas" />}
          {tab === "fornecedores" && <FornecedoresPanel />}
          {tab === "codigos" && <CodigosPanel />}
        </div>
      </main>
    </div>
  );
}

const TONES = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  destructive: "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-warning",
  muted: "bg-muted text-muted-foreground",
} as const;

function Kpi({ title, value, icon: Icon, tone, onClick }: {
  title: string; value: number; icon: React.ElementType; tone: keyof typeof TONES; onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border bg-card p-3 sm:p-4 flex items-center justify-between gap-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="min-w-0">
        <p className="text-[11px] sm:text-xs text-muted-foreground leading-tight">{title}</p>
        <p className="text-xl sm:text-2xl font-semibold tabular-nums mt-0.5">{value}</p>
      </div>
      <div className={cn("h-9 w-9 sm:h-11 sm:w-11 rounded-xl flex items-center justify-center shrink-0", TONES[tone])}>
        <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
      </div>
    </button>
  );
}
