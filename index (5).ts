import { useState, lazy, Suspense } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ShoppingCart, Building2, PackageSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageNav, type PageNavTab } from "@/components/PageNav";
import { LoadingScreen } from "@/components/LoadingScreen";

const FornecedoresPanel = lazy(() => import("@/components/compras/FornecedoresPanel").then(m => ({ default: m.FornecedoresPanel })));
const PedidosCompraPanel = lazy(() => import("@/components/compras/PedidosCompraPanel").then(m => ({ default: m.PedidosCompraPanel })));

type ComprasView = "fornecedores" | "pedidos";

const TABS: PageNavTab<ComprasView>[] = [
  { id: "fornecedores", label: "Fornecedores", Icon: Building2,     activeColor: "text-blue-500",   activeBg: "bg-blue-500/10",   activeBorder: "border-blue-500/40" },
  { id: "pedidos",      label: "Pedidos",       Icon: PackageSearch, activeColor: "text-violet-500", activeBg: "bg-violet-500/10", activeBorder: "border-violet-500/40" },
];

export function Compras() {
  const { isAdmin, role } = useAuth();
  const canAccess = isAdmin || role === "estoque" || role === "financeiro";
  const [view, setView] = useState<ComprasView>("fornecedores");

  if (!canAccess) return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
      <ShoppingCart className="h-10 w-10 opacity-20" />
      <p className="text-sm">Acesso restrito</p>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 h-12 sm:h-14 flex items-center gap-2 sm:gap-3">
          <ShoppingCart className="h-4 w-4 text-blue-500" />
          <h1 className="text-sm font-semibold">Compras</h1>
        </div>
      </header>

      <div className="max-w-7xl mx-auto w-full px-3 sm:px-4 pt-2">
        <PageNav tabs={TABS} activeTab={view} onTabChange={setView} />
      </div>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4">
          <Suspense fallback={<LoadingScreen />}>
            {view === "fornecedores" && <FornecedoresPanel />}
            {view === "pedidos"      && <PedidosCompraPanel />}
          </Suspense>
        </div>
      </main>
    </div>
  );
}
