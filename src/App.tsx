import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { LoadingScreen } from "@/components/LoadingScreen";
import { AppShell } from "@/components/AppShell";
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

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, approved, blocked } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (blocked) return <Navigate to="/pending-approval" replace />;
  if (approved === null) return <LoadingScreen />;
  if (approved === false) return <Navigate to="/pending-approval" replace />;
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

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdmin, approved, blocked } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (blocked) return <Navigate to="/pending-approval" replace />;
  if (approved === null) return <LoadingScreen />;
  if (!isAdmin || approved === false) return <Navigate to="/" replace />;
  return <AppShell>{children}</AppShell>;
}

function VendedoraRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, role, approved, blocked } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (blocked) return <Navigate to="/pending-approval" replace />;
  if (approved === null) return <LoadingScreen />;
  if (approved === false) return <Navigate to="/pending-approval" replace />;
  if (role !== "vendedora" && role !== "admin") return <Navigate to="/" replace />;
  return <AppShell>{children}</AppShell>;
}

function FinanceiroRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, role, isAdmin, approved, blocked } = useAuth();
  if (loading || approved === null) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (blocked) return <Navigate to="/pending-approval" replace />;
  if (approved === false) return <Navigate to="/pending-approval" replace />;
  if (!isAdmin && role !== "financeiro") return <Navigate to="/" replace />;
  return <AppShell>{children}</AppShell>;
}

function IndexRoute() {
  const { role, loading, approved } = useAuth();
  if (loading || approved === null) return <LoadingScreen />;
  if (role === "vendedora") return <Navigate to="/comercial" replace />;
  if (role === "financeiro") return <Navigate to="/financeiro" replace />;
  return <Index />;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, loading, approved } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user && approved === false) return <Navigate to="/pending-approval" replace />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<LoadingScreen />}>
            <Routes>
              <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
              <Route path="/set-password" element={<ProtectedRoute><SetPassword /></ProtectedRoute>} />
              <Route path="/pending-approval" element={<PendingApprovalRoute />} />
              <Route path="/" element={<ProtectedRoute><IndexRoute /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
              <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
              <Route path="/manuals" element={<ProtectedRoute><Manuals /></ProtectedRoute>} />
              <Route path="/estoque" element={<ProtectedRoute><Estoque /></ProtectedRoute>} />
              <Route path="/comercial" element={<VendedoraRoute><Comercial /></VendedoraRoute>} />
              <Route path="/financeiro" element={<FinanceiroRoute><Financeiro /></FinanceiroRoute>} />
              <Route path="/producao" element={<ProtectedRoute><Producao /></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
