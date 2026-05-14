import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { LoadingScreen } from "@/components/LoadingScreen";
import { lazy, Suspense } from "react";

// Páginas always-needed: carregadas de imediato (sem lazy)
import Login from "./pages/Login";
import SetPassword from "./pages/SetPassword";
import PendingApproval from "./pages/PendingApproval";
import NotFound from "./pages/NotFound";

// Code splitting: páginas autenticadas carregadas sob demanda
// Reduz o bundle inicial; o fallback é o mesmo LoadingScreen já usado no auth
const Index      = lazy(() => import("./pages/Index"));
const Admin      = lazy(() => import("./pages/Admin"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const Manuals    = lazy(() => import("./pages/Manuals"));
const Estoque    = lazy(() => import("./pages/Estoque"));
const Comercial  = lazy(() => import("./pages/Comercial"));
const Financeiro = lazy(() => import("./pages/Financeiro"));
const MRP        = lazy(() => import("./pages/MRP"));

// FIX: QueryClient sem config usa retry=3 por padrão — em erros de rede isso causa
// 3 tentativas com backoff exponencial antes de mostrar erro ao usuário (~30s de espera).
// Para este app (dados raramente mudam entre sessões), staleTime de 5min evita
// refetches automáticos desnecessários ao refocusar a janela.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutos
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, approved, blocked } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  // Usuário bloqueado: desloga e mostra mensagem
  if (blocked) return <Navigate to="/pending-approval" replace />;
  // null = aprovação ainda carregando (race condition pós-login), aguarda sem redirecionar
  if (approved === null) return <LoadingScreen />;
  // Só redireciona se explicitamente false
  if (approved === false) return <Navigate to="/pending-approval" replace />;
  return <>{children}</>;
}

// FIX: Rota /pending-approval precisa de proteção — usuário sem login não deve acessá-la.
// Também evita que usuário já aprovado fique preso nessa página.
function PendingApprovalRoute() {
  const { user, loading, approved, blocked } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  // null = perfil ainda carregando, aguarda sem redirecionar
  if (approved === null) return <LoadingScreen />;
  if (approved === true && !blocked) return <Navigate to="/" replace />;
  return <PendingApproval />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdmin, approved, blocked } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (blocked) return <Navigate to="/pending-approval" replace />;
  // null = aprovação ainda carregando, aguarda
  if (approved === null) return <LoadingScreen />;
  if (!isAdmin || approved === false) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Rota para vendedoras: acesso permitido para role === "vendedora" | "admin"
function VendedoraRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, role, approved, blocked } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (blocked) return <Navigate to="/pending-approval" replace />;
  if (approved === null) return <LoadingScreen />;
  if (approved === false) return <Navigate to="/pending-approval" replace />;
  if (role !== "vendedora" && role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

// SEG-03 FIX: Rota exclusiva para financeiro — garante verificação de role no nível da rota,
// não apenas dentro do componente (que era contornável acessando a URL diretamente).
function FinanceiroRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, role, isAdmin, approved, blocked } = useAuth();
  if (loading || approved === null) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (blocked) return <Navigate to="/pending-approval" replace />;
  if (approved === false) return <Navigate to="/pending-approval" replace />;
  if (!isAdmin && role !== "financeiro") return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Index redireciona vendedoras direto para /comercial, financeiro para /financeiro
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
  // Só redireciona para pending-approval se approved for explicitamente false
  // null = perfil ainda carregando, não deve bloquear
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
            <Route path="/mrp" element={<ProtectedRoute><MRP /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
