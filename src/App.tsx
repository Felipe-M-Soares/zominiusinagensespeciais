import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Admin from "./pages/Admin";
import SettingsPage from "./pages/Settings";
import Contacts from "./pages/Contacts";
import Manuals from "./pages/Manuals";
import Estoque from "./pages/Estoque";
import SetPassword from "./pages/SetPassword";
import PendingApproval from "./pages/PendingApproval";
import NotFound from "./pages/NotFound";

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
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  // Usuário bloqueado: desloga e mostra mensagem
  if (blocked) return <Navigate to="/pending-approval" replace />;
  // null = aprovação ainda carregando (race condition pós-login), aguarda sem redirecionar
  if (approved === null) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  // Só redireciona se explicitamente false
  if (approved === false) return <Navigate to="/pending-approval" replace />;
  return <>{children}</>;
}

// FIX: Rota /pending-approval precisa de proteção — usuário sem login não deve acessá-la.
// Também evita que usuário já aprovado fique preso nessa página.
function PendingApprovalRoute() {
  const { user, loading, approved, blocked } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  // null = perfil ainda carregando, aguarda sem redirecionar
  if (approved === null) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  if (approved === true && !blocked) return <Navigate to="/" replace />;
  return <PendingApproval />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdmin, approved, blocked } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (blocked) return <Navigate to="/pending-approval" replace />;
  // null = aprovação ainda carregando, aguarda
  if (approved === null) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  if (!isAdmin || approved === false) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, loading, approved } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  // Só redireciona para pending-approval se approved for explicitamente false
  // null = perfil ainda carregando, não deve bloquear
  if (user && approved === false) return <Navigate to="/pending-approval" replace />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
            <Route path="/set-password" element={<SetPassword />} />
            <Route path="/pending-approval" element={<PendingApprovalRoute />} />
            <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
            <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
            <Route path="/contacts" element={<ProtectedRoute><Contacts /></ProtectedRoute>} />
            <Route path="/manuals" element={<ProtectedRoute><Manuals /></ProtectedRoute>} />
            <Route path="/estoque" element={<ProtectedRoute><Estoque /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
