import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/Logo";
import { toast } from "sonner";
import { Download, CheckCircle, User, Lock, Eye, EyeOff, ShieldX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export default function Login() {
  const [login, setLogin]           = useState("");
  const [password, setPassword]     = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]       = useState(false);
  const { signIn } = useAuth();
  const { canInstall, isInstalled, install } = usePWAInstall();
  const navigate = useNavigate();
  const location = useLocation();

  const wasBlocked = (location.state as { blocked?: boolean } | null)?.blocked === true;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!login.trim() || !password.trim()) return;
    setLoading(true);
    try {
      const { error } = await signIn(login.trim(), password);
      if (error) {
        toast.error(error);
        return;
      }

      // SECURITY FIX: usa getSession() em vez de uma segunda query a profiles,
      // evitando race condition TOCTOU onde o perfil pode não estar disponível
      // via RLS logo após o login. O campo must_change_password é lido via
      // supabase diretamente pois getSession já contém o token atualizado.
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("must_change_password")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (profile?.must_change_password === true) {
          navigate("/set-password");
          return;
        }
      }
      navigate("/");
    } catch (err) {
      console.error("Login error:", err);
      toast.error("Erro inesperado. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/30 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo className="h-14 object-contain" />
          <div>
            <h1 className="text-xl font-semibold text-foreground tracking-tight">Login e Senha</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Acesse com seu login e senha cadastrados
            </p>
          </div>
        </div>

        {/* Banner de bloqueio */}
        {wasBlocked && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 flex items-start gap-3">
            <ShieldX className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-700 dark:text-red-300">Acesso Bloqueado</p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                Seu acesso foi bloqueado pelo administrador. Entre em contato para regularizar sua situação.
              </p>
            </div>
          </div>
        )}

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-xl shadow-primary/5 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Login */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Login</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                <Input
                  type="text"
                  placeholder="Seu login"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  required
                  autoComplete="username"
                  autoFocus
                  className="pl-10 h-11 rounded-xl bg-background/50 border-border focus:bg-background transition-colors"
                />
              </div>
            </div>

            {/* Senha */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Senha</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="pl-10 pr-10 h-11 rounded-xl bg-background/50 border-border focus:bg-background transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-11 rounded-xl font-medium text-sm shadow-md hover:shadow-lg transition-all duration-200"
              disabled={loading || !login.trim() || !password.trim()}
            >
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </div>

        {/* Instalar PWA */}
        {(canInstall || isInstalled) && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full gap-2 text-muted-foreground text-xs"
            disabled={isInstalled}
            onClick={() =>
              install()
                .then((ok) => ok && toast.success("App instalado!"))
                .catch(() => toast.error("Não foi possível instalar o app."))
            }
          >
            {isInstalled ? (
              <><CheckCircle className="h-3.5 w-3.5" /> App Instalado</>
            ) : (
              <><Download className="h-3.5 w-3.5" /> Instalar App</>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
