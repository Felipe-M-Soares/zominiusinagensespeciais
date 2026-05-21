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

// ── Guard unificado ──────────────────────────────────────────────────────────
type Role = "admin" | "vendedora" | "financeiro" | "producao" | "estoque";

// Guard para rotas públicas (login) — redireciona para / se já logado
function PublicGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, approved } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <>{children}</>;
  if (approved === false) return <Navigate to="/pending-approval" replace />;
  return <Navigate to="/" replace />;
}

// Guard de acesso — verifica auth/role sem montar AppShell (AppShell fica fora)
function AccessGuard({ children, roles, adminOnly }: {
  children: React.ReactNode;
  roles?: Role[];
  adminOnly?: boolean;
}) {
  const { user, loading, approved, blocked, isAdmin, role } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (blocked) return <Navigate to="/pending-approval" replace />;
  if (approved === false) return <Navigate to="/pending-approval" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  if (roles && !isAdmin && !roles.includes(role as Role)) return <Navigate to="/" replace />;
  return <>{children}</>;
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

// Shell protegido — AppShell montado UMA vez, não remontado a cada troca de rota
function ProtectedShell() {
  const { user, loading, approved, blocked } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (blocked) return <Navigate to="/pending-approval" replace />;
  if (approved === false) return <Navigate to="/pending-approval" replace />;
  return (
    <AppShell>
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="/" element={<ErrorBoundary><IndexRoute /></ErrorBoundary>} />
          <Route path="/settings"  element={<ErrorBoundary><AccessGuard><SettingsPage /></AccessGuard></ErrorBoundary>} />
          <Route path="/manuals"   element={<ErrorBoundary><AccessGuard><Manuals /></AccessGuard></ErrorBoundary>} />
          <Route path="/estoque"   element={<ErrorBoundary><AccessGuard><Estoque /></AccessGuard></ErrorBoundary>} />
          <Route path="/producao"  element={<ErrorBoundary><AccessGuard><Producao /></AccessGuard></ErrorBoundary>} />
          <Route path="/set-password" element={<ErrorBoundary><AccessGuard><SetPassword /></AccessGuard></ErrorBoundary>} />
          <Route path="/comercial"  element={<ErrorBoundary><AccessGuard roles={["vendedora", "admin"]}><Comercial /></AccessGuard></ErrorBoundary>} />
          <Route path="/financeiro" element={<ErrorBoundary><AccessGuard roles={["financeiro", "admin"]}><Financeiro /></AccessGuard></ErrorBoundary>} />
          <Route path="/admin"      element={<ErrorBoundary><AccessGuard adminOnly><Admin /></AccessGuard></ErrorBoundary>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <AuthProvider>
          <Routes>
            {/* Rotas públicas */}
            <Route path="/login" element={<PublicGuard><Login /></PublicGuard>} />
            <Route path="/pending-approval" element={<PendingApprovalRoute />} />
            {/* Todas as rotas protegidas dentro de um único AppShell */}
            <Route path="/*" element={<ProtectedShell />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
