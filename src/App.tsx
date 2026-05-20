import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { LoadingScreen } from "@/components/LoadingScreen";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { lazy, Suspense } from "react";

import Login from "./pages/Login";
import SetPassword from "./pages/SetPassword";
import PendingApproval from "./pages/PendingApproval";
import NotFound from "./pages/NotFound";

const Index      = lazy(() => import("./pages/Index"));
const Admin      = lazy(() => import("./pages/Admin"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const Manuals    = lazy(() => import("./pages/Manuals"));
const Estoque    = lazy(() => import("./pages/Estoque"));
const Comercial  = lazy(() => import("./pages/Comercial"));
const Financeiro = lazy(() => import("./pages/Financeiro"));
const Producao   = lazy(() => import("./pages/Producao"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0 },
  },
});

// ── Guard unificado — substitui os 5 componentes de rota duplicados ──────────
type Role = "admin" | "vendedora" | "financeiro" | "producao" | "estoque";

interface RouteGuardProps {
  children: React.ReactNode;
  /** Roles permitidos; undefined = qualquer usuário aprovado */
  roles?: Role[];
  /** Se true, exige isAdmin independente do role */
  adminOnly?: boolean;
  /** Se false, rota é pública (redireciona para / quando autenticado) */
  publicOnly?: boolean;
}

function RouteGuard({ children, roles, adminOnly, publicOnly }: RouteGuardProps) {
  const { user, loading, approved, blocked, isAdmin, role } = useAuth();

  if (loading || (!publicOnly && approved === null)) return <LoadingScreen />;

  if (publicOnly) {
    if (!user) return <>{children}</>;
    if (approved === false) return <Navigate to="/pending-approval" replace />;
    return <Navigate to="/" replace />;
  }

  if (!user) return <Navigate to="/login" replace />;
  if (blocked) return <Navigate to="/pending-approval" replace />;
  if (approved === false) return <Navigate to="/pending-approval" replace />;

  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  if (roles && !isAdmin && !roles.includes(role as Role)) return <Navigate to="/" replace />;

  return <AppShell>{children}</AppShell>;
}

function PendingApprovalRoute() {
  const { user, loading, approved, blocked } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (approved === null) return <LoadingScreen />;
  if (approved === true && !blocked) return <Navigate to="/" replace />;
  return <PendingApproval />;
}

function IndexRoute() {
  const { role, loading, approved } = useAuth();
  if (loading || approved === null) return <LoadingScreen />;
  if (role === "vendedora") return <Navigate to="/comercial" replace />;
  if (role === "financeiro") return <Navigate to="/financeiro" replace />;
  return <Index />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<LoadingScreen />}>
            <Routes>
              {/* Públicas */}
              <Route path="/login" element={<RouteGuard publicOnly><Login /></RouteGuard>} />

              {/* Aprovação pendente */}
              <Route path="/pending-approval" element={<PendingApprovalRoute />} />

              {/* Protegidas — qualquer usuário aprovado */}
              <Route path="/set-password" element={<ErrorBoundary><RouteGuard><SetPassword /></RouteGuard></ErrorBoundary>} />
              <Route path="/"          element={<ErrorBoundary><RouteGuard><IndexRoute /></RouteGuard></ErrorBoundary>} />
              <Route path="/settings"  element={<ErrorBoundary><RouteGuard><SettingsPage /></RouteGuard></ErrorBoundary>} />
              <Route path="/manuals"   element={<ErrorBoundary><RouteGuard><Manuals /></RouteGuard></ErrorBoundary>} />
              <Route path="/estoque"   element={<ErrorBoundary><RouteGuard><Estoque /></RouteGuard></ErrorBoundary>} />
              <Route path="/producao"  element={<ErrorBoundary><RouteGuard><Producao /></RouteGuard></ErrorBoundary>} />

              {/* Protegidas — roles específicos */}
              <Route path="/comercial"  element={<ErrorBoundary><RouteGuard roles={["vendedora", "admin"]}><Comercial /></RouteGuard></ErrorBoundary>} />
              <Route path="/financeiro" element={<ErrorBoundary><RouteGuard roles={["financeiro", "admin"]}><Financeiro /></RouteGuard></ErrorBoundary>} />

              {/* Admin */}
              <Route path="/admin" element={<ErrorBoundary><RouteGuard adminOnly><Admin /></RouteGuard></ErrorBoundary>} />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
