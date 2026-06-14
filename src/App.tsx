import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { LoadingScreen } from "@/components/LoadingScreen";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { lazy, Suspense } from "react";
import type { AppRole } from "@/types/roles";

import Login from "./pages/Login";
import SetPassword from "./pages/SetPassword";
import PendingApproval from "./pages/PendingApproval";
import NotFound from "./pages/NotFound";

const Index       = lazy(() => import("./pages/Index"));
const Admin       = lazy(() => import("./pages/Admin"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const Manuals     = lazy(() => import("./pages/Manuals"));
const Estoque     = lazy(() => import("./pages/Estoque"));
const Comercial   = lazy(() => import("./pages/Comercial"));
const Financeiro  = lazy(() => import("./pages/Financeiro"));
const Producao    = lazy(() => import("./pages/Producao"));
const Qualidade   = lazy(() => import("./pages/Qualidade"));
const Compras     = lazy(() => import("./pages/Compras").then(m => ({ default: m.Compras })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

// ── Rota pública: redireciona para / se já logado ─────────────────────────────
function PublicGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, approved } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <>{children}</>;
  if (approved === false) return <Navigate to="/pending-approval" replace />;
  return <Navigate to="/" replace />;
}

// ── Layout protegido: AppShell montado UMA vez para todas as rotas internas ───
function ProtectedLayout() {
  const { user, loading, approved, blocked } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (blocked || approved === false) return <Navigate to="/pending-approval" replace />;
  return (
    <AppShell>
      <Suspense fallback={<LoadingScreen />}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}

// ── Guard de role dentro das rotas protegidas ─────────────────────────────────
function RoleGuard({ children, roles, adminOnly }: {
  children: React.ReactNode;
  roles?: AppRole[];
  adminOnly?: boolean;
}) {
  const { isAdmin, role } = useAuth();
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  if (roles && !isAdmin && !roles.includes(role as AppRole)) return <Navigate to="/" replace />;
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
  const { loading, approved } = useAuth();
  if (loading || approved === null) return <LoadingScreen />;
  return <Index />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter future={{ v7_relativeSplatPath: true }}>
        <AuthProvider>
          <Routes>
            {/* Públicas */}
            <Route path="/login" element={<PublicGuard><Login /></PublicGuard>} />
            <Route path="/pending-approval" element={<PendingApprovalRoute />} />

            {/* Protegidas — AppShell renderizado uma única vez via Outlet */}
            <Route element={<ProtectedLayout />}>
              <Route path="/"           element={<ErrorBoundary><IndexRoute /></ErrorBoundary>} />
              <Route path="/set-password" element={<ErrorBoundary><SetPassword /></ErrorBoundary>} />
              <Route path="/settings"   element={<ErrorBoundary><SettingsPage /></ErrorBoundary>} />
              <Route path="/manuals"    element={<ErrorBoundary><Manuals /></ErrorBoundary>} />
              <Route path="/estoque"    element={<ErrorBoundary><RoleGuard roles={["estoque","qualidade","admin"]}><Estoque /></RoleGuard></ErrorBoundary>} />
              <Route path="/producao"   element={<ErrorBoundary><RoleGuard roles={["producao","admin"]}><Producao /></RoleGuard></ErrorBoundary>} />
              <Route path="/qualidade"  element={<ErrorBoundary><RoleGuard roles={["qualidade","admin"]}><Qualidade /></RoleGuard></ErrorBoundary>} />
              <Route path="/comercial"  element={<ErrorBoundary><RoleGuard roles={["comercial","admin"]}><Comercial /></RoleGuard></ErrorBoundary>} />
              <Route path="/financeiro" element={<ErrorBoundary><RoleGuard roles={["financeiro","admin"]}><Financeiro /></RoleGuard></ErrorBoundary>} />
              <Route path="/compras"    element={<ErrorBoundary><RoleGuard roles={["estoque","financeiro","admin"]}><Compras /></RoleGuard></ErrorBoundary>} />
              <Route path="/admin"      element={<ErrorBoundary><RoleGuard adminOnly><Admin /></RoleGuard></ErrorBoundary>} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
