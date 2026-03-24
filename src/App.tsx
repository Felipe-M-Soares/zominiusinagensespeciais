import { Toaster } from "@/components/ui/toaster";
  import { Toaster as Sonner } from "@/components/ui/sonner";
  import { TooltipProvider } from "@/components/ui/tooltip";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
  import { AuthProvider, useAuth } from "@/hooks/useAuth";
  import Index from "./pages/Index";
  import Login from "./pages/Login";
  import Register from "./pages/Register";
  import ForgotPassword from "./pages/ForgotPassword";
  import ResetPassword from "./pages/ResetPassword";
  import Admin from "./pages/Admin";
  import SettingsPage from "./pages/Settings";
  import Contacts from "./pages/Contacts";
  import Manuals from "./pages/Manuals";
  import PendingApproval from "./pages/PendingApproval";
  import NotFound from "./pages/NotFound";

  const queryClient = new QueryClient();

  function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { user, loading, approved } = useAuth();
    if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
    if (!user) return <Navigate to="/login" replace />;
    // SEC-001 FIX: Unapproved users must not access any protected content
    if (approved === false) return <Navigate to="/pending-approval" replace />;
    return <>{children}</>;
  }

  function AdminRoute({ children }: { children: React.ReactNode }) {
    const { user, loading, isAdmin, approved } = useAuth();
    if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
    if (!user) return <Navigate to="/login" replace />;
    if (!isAdmin || !approved) return <Navigate to="/" replace />;
    return <>{children}</>;
  }

  function PublicOnly({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth();
    if (loading) return null;
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
              <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
              <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/pending-approval" element={<PendingApproval />} />
              <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
              <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
              <Route path="/contacts" element={<ProtectedRoute><Contacts /></ProtectedRoute>} />
              <Route path="/manuals" element={<ProtectedRoute><Manuals /></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );

  export default App;
  