import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, CheckCircle, User, Lock, Eye, EyeOff, ShieldX } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";

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
      logger.error("Login error:", err);
      toast.error("Erro inesperado. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 relative overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #e0f7ff 0%, #f0f9ff 40%, #e8f4f8 70%, #d6eef8 100%)"
      }}
    >
      {/* Fundo decorativo — círculos e linhas geométricas */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {/* Círculos grandes desfocados */}
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, hsl(197,100%,47%) 0%, transparent 70%)" }} />
        <div className="absolute -bottom-40 -right-20 w-[600px] h-[600px] rounded-full opacity-15"
          style={{ background: "radial-gradient(circle, hsl(197,100%,47%) 0%, transparent 70%)" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full opacity-[0.07]"
          style={{ background: "radial-gradient(circle, hsl(197,100%,47%) 0%, transparent 65%)" }} />

        {/* Grid pontilhado */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.12]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="dots" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1.5" fill="hsl(197,100%,40%)" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots)" />
        </svg>

        {/* Linhas diagonais decorativas */}
        <svg className="absolute top-0 right-0 w-96 h-96 opacity-[0.08]" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
          {[0,40,80,120,160,200,240,280,320,360].map(i => (
            <line key={i} x1={i} y1="0" x2="400" y2={400-i} stroke="hsl(197,100%,40%)" strokeWidth="1.5"/>
          ))}
        </svg>
        <svg className="absolute bottom-0 left-0 w-80 h-80 opacity-[0.07]" viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg">
          {[0,40,80,120,160,200,240,280].map(i => (
            <line key={i} x1="0" y1={i} x2={320-i} y2="320" stroke="hsl(197,100%,40%)" strokeWidth="1.5"/>
          ))}
        </svg>

        {/* Anéis concêntricos */}
        <svg className="absolute top-12 right-16 opacity-10 w-40 h-40" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
          {[20,36,52,68].map(r => (
            <circle key={r} cx="80" cy="80" r={r} fill="none" stroke="hsl(197,100%,40%)" strokeWidth="1.2"/>
          ))}
        </svg>
      </div>

      <div className="w-full max-w-sm relative z-10 animate-in fade-in slide-in-from-bottom-6 duration-500">

        {/* Cabeçalho acima do card */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 shadow-lg"
            style={{ background: "linear-gradient(135deg, hsl(197,100%,47%), hsl(197,100%,38%))" }}>
            <Lock className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "hsl(197,100%,25%)" }}>
            Bem-vindo
          </h1>
          <p className="text-sm mt-1" style={{ color: "hsl(197,40%,45%)" }}>
            Acesse com suas credenciais
          </p>
        </div>

        {/* Banner de bloqueio */}
        {wasBlocked && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-2xl px-4 py-3 flex items-start gap-3">
            <ShieldX className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-700">Acesso Bloqueado</p>
              <p className="text-xs text-red-600 mt-0.5">
                Seu acesso foi bloqueado pelo administrador. Entre em contato para regularizar sua situação.
              </p>
            </div>
          </div>
        )}

        {/* Card glassmorphism */}
        <div className="rounded-3xl p-7 space-y-5 shadow-2xl border border-white/60"
          style={{
            background: "rgba(255,255,255,0.72)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Login */}
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "hsl(197,40%,40%)" }}>
                Login
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "hsl(197,100%,47%)" }} />
                <Input
                  type="text"
                  placeholder="Seu login"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  required
                  autoComplete="username"
                  autoFocus
                  className="pl-10 h-12 rounded-xl border-0 text-[13px] font-medium transition-all ring-1 focus-visible:ring-2"
                  style={{
                    background: "rgba(240,249,255,0.8)",
                    boxShadow: "inset 0 1px 3px rgba(0,120,160,0.08)",
                  } as React.CSSProperties}
                />
              </div>
            </div>

            {/* Senha */}
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "hsl(197,40%,40%)" }}>
                Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "hsl(197,100%,47%)" }} />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="pl-10 pr-11 h-12 rounded-xl border-0 text-[13px] font-medium transition-all ring-1 focus-visible:ring-2"
                  style={{
                    background: "rgba(240,249,255,0.8)",
                    boxShadow: "inset 0 1px 3px rgba(0,120,160,0.08)",
                  } as React.CSSProperties}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: "hsl(197,40%,55%)" }}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-12 rounded-xl font-semibold text-sm tracking-wide shadow-lg transition-all duration-200 mt-1 border-0"
              disabled={loading || !login.trim() || !password.trim()}
              style={{
                background: loading || !login.trim() || !password.trim()
                  ? "hsl(197,60%,75%)"
                  : "linear-gradient(135deg, hsl(197,100%,47%), hsl(197,100%,38%))",
                color: "white",
                boxShadow: "0 4px 20px rgba(0,180,220,0.35)",
              } as React.CSSProperties}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Entrando...
                </span>
              ) : "Entrar"}
            </Button>
          </form>
        </div>

        {/* Instalar PWA */}
        {(canInstall || isInstalled) && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full gap-2 text-xs mt-4"
            style={{ color: "hsl(197,50%,45%)" }}
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
