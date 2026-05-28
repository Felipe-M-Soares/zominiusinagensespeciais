import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, ShieldX, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import logoZomini from "@/assets/logo_zomini.png";

export default function Login() {
  const [login, setLogin]               = useState("");
  const [password, setPassword]         = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]           = useState(false);
  const { signIn } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();

  const wasBlocked = (location.state as { blocked?: boolean } | null)?.blocked === true;
  const canSubmit  = login.trim() && password.trim() && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    try {
      const { error } = await signIn(login.trim(), password);
      if (error) { toast.error(error); return; }

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("must_change_password")
          .eq("user_id", session.user.id)
          .maybeSingle();
        if (profile?.must_change_password === true) { navigate("/set-password"); return; }
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
    <div className="min-h-screen flex overflow-hidden" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>

      {/* ── Painel esquerdo — identidade visual ─────────────────────────────── */}
      <div
        className="hidden lg:flex flex-col justify-between w-[52%] relative overflow-hidden p-12"
        style={{
          background: "linear-gradient(160deg, #0a1628 0%, #0d1f3c 40%, #0b2240 70%, #061525 100%)",
        }}
      >
        {/* Textura de grade fina */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.06]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="hsl(197,100%,60%)" strokeWidth="0.8"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Círculo de luz primário */}
        <div
          className="absolute top-[-10%] left-[-15%] w-[700px] h-[700px] rounded-full pointer-events-none"
          style={{
            background: "radial-gradient(circle, hsla(197,100%,47%,0.18) 0%, transparent 65%)",
          }}
        />
        {/* Segundo ponto de luz */}
        <div
          className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full pointer-events-none"
          style={{
            background: "radial-gradient(circle, hsla(197,100%,47%,0.10) 0%, transparent 65%)",
          }}
        />

        {/* Linha decorativa vertical */}
        <div
          className="absolute left-0 top-0 bottom-0 w-[3px]"
          style={{ background: "linear-gradient(to bottom, transparent, hsl(197,100%,47%), transparent)" }}
        />

        {/* Logo no topo */}
        <div className="relative z-10">
          <img
            src={logoZomini}
            alt="Zomini Usinagens Especiais"
            className="h-10 w-auto object-contain brightness-0 invert opacity-90"
          />
        </div>

        {/* Conteúdo central */}
        <div className="relative z-10 space-y-6">
          {/* Ícone decorativo */}
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, hsla(197,100%,47%,0.25) 0%, hsla(197,100%,47%,0.08) 100%)",
              border: "1px solid hsla(197,100%,47%,0.3)",
              boxShadow: "0 0 40px hsla(197,100%,47%,0.15)",
            }}
          >
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="14" cy="14" r="4" fill="hsl(197,100%,47%)" />
              <circle cx="14" cy="14" r="8" fill="none" stroke="hsl(197,100%,47%)" strokeWidth="1.5" strokeDasharray="3 3" />
              <circle cx="14" cy="14" r="12" fill="none" stroke="hsla(197,100%,47%,0.4)" strokeWidth="1" />
              <line x1="2" y1="14" x2="26" y2="14" stroke="hsla(197,100%,47%,0.3)" strokeWidth="0.8" />
              <line x1="14" y1="2" x2="14" y2="26" stroke="hsla(197,100%,47%,0.3)" strokeWidth="0.8" />
            </svg>
          </div>

          <div>
            <h2 className="text-4xl font-bold leading-tight" style={{ color: "#f0f8ff", letterSpacing: "-0.02em" }}>
              Sistema de<br />
              <span style={{ color: "hsl(197,100%,60%)" }}>Gestão Integrada</span>
            </h2>
            <p className="mt-4 text-base leading-relaxed" style={{ color: "hsla(197,20%,75%,0.8)" }}>
              Controle completo de estoque, produção e comercial — tudo em um único lugar.
            </p>
          </div>

          {/* Métricas decorativas */}
          <div className="grid grid-cols-3 gap-4 pt-4">
            {[
              { label: "Módulos", value: "5" },
              { label: "Integrado", value: "100%" },
              { label: "Tempo Real", value: "∞" },
            ].map((m) => (
              <div
                key={m.label}
                className="rounded-xl p-4 space-y-1"
                style={{
                  background: "hsla(197,100%,47%,0.06)",
                  border: "1px solid hsla(197,100%,47%,0.15)",
                }}
              >
                <div className="text-2xl font-bold" style={{ color: "hsl(197,100%,60%)" }}>{m.value}</div>
                <div className="text-xs" style={{ color: "hsla(197,20%,70%,0.7)" }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Rodapé */}
        <div className="relative z-10">
          <p className="text-xs" style={{ color: "hsla(197,20%,60%,0.5)" }}>
            © {new Date().getFullYear()} Zomini Usinagens Especiais
          </p>
        </div>
      </div>

      {/* ── Painel direito — formulário ──────────────────────────────────────── */}
      <div
        className="flex-1 flex flex-col items-center justify-center px-6 py-10 relative"
        style={{ background: "hsl(0,0%,96%)" }}
      >
        {/* Logo mobile */}
        <div className="lg:hidden mb-10">
          <img
            src={logoZomini}
            alt="Zomini Usinagens Especiais"
            className="h-9 w-auto object-contain"
          />
        </div>

        <div className="w-full max-w-[380px] animate-in fade-in slide-in-from-bottom-4 duration-500">

          {/* Cabeçalho */}
          <div className="mb-8">
            <p
              className="text-xs font-semibold uppercase tracking-[0.15em] mb-2"
              style={{ color: "hsl(197,100%,40%)" }}
            >
              Bem-vindo de volta
            </p>
            <h1
              className="text-3xl font-bold"
              style={{ color: "hsl(0,0%,9%)", letterSpacing: "-0.02em" }}
            >
              Acesse sua conta
            </h1>
            <p className="mt-2 text-sm" style={{ color: "hsl(0,0%,45%)" }}>
              Digite suas credenciais para continuar
            </p>
          </div>

          {/* Banner de bloqueio */}
          {wasBlocked && (
            <div
              className="mb-6 px-4 py-3 rounded-2xl flex items-start gap-3"
              style={{
                background: "hsl(0,60%,97%)",
                border: "1px solid hsl(0,72%,88%)",
              }}
            >
              <ShieldX className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "hsl(0,72%,50%)" }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: "hsl(0,72%,38%)" }}>Acesso Bloqueado</p>
                <p className="text-xs mt-0.5" style={{ color: "hsl(0,50%,50%)" }}>
                  Seu acesso foi bloqueado. Entre em contato com o administrador.
                </p>
              </div>
            </div>
          )}

          {/* Formulário */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Campo Login */}
            <div className="space-y-1.5">
              <label
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: "hsl(0,0%,30%)" }}
              >
                Login
              </label>
              <Input
                type="text"
                placeholder="Seu login"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                required
                autoComplete="username"
                autoFocus
                className="h-12 rounded-xl text-sm font-medium transition-all border-2 focus-visible:ring-0 focus-visible:border-[hsl(197,100%,47%)] placeholder:text-[hsl(0,0%,65%)]"
                style={{
                  background: "hsl(0,0%,99%)",
                  borderColor: login ? "hsl(197,100%,47%)" : "hsl(0,0%,88%)",
                  color: "hsl(0,0%,9%)",
                } as React.CSSProperties}
              />
            </div>

            {/* Campo Senha */}
            <div className="space-y-1.5">
              <label
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: "hsl(0,0%,30%)" }}
              >
                Senha
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="h-12 pr-12 rounded-xl text-sm font-medium transition-all border-2 focus-visible:ring-0 focus-visible:border-[hsl(197,100%,47%)] placeholder:text-[hsl(0,0%,65%)] [&::-ms-reveal]:hidden"
                  style={{
                    background: "hsl(0,0%,99%)",
                    borderColor: password ? "hsl(197,100%,47%)" : "hsl(0,0%,88%)",
                    color: "hsl(0,0%,9%)",
                  } as React.CSSProperties}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 transition-colors hover:opacity-70"
                  style={{ color: "hsl(0,0%,50%)" }}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Botão Entrar */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="relative w-full h-12 rounded-xl font-semibold text-sm tracking-wide transition-all duration-200 overflow-hidden group mt-2"
              style={{
                background: canSubmit
                  ? "linear-gradient(135deg, hsl(197,100%,42%) 0%, hsl(197,100%,35%) 100%)"
                  : "hsl(197,30%,80%)",
                color: "white",
                boxShadow: canSubmit ? "0 4px 24px hsla(197,100%,47%,0.35)" : "none",
                cursor: canSubmit ? "pointer" : "not-allowed",
              } as React.CSSProperties}
            >
              {/* Brilho hover */}
              <span
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ background: "linear-gradient(135deg, hsl(197,100%,50%) 0%, hsl(197,100%,40%) 100%)" }}
              />
              <span className="relative flex items-center justify-center gap-2">
                {loading ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Entrando...
                  </>
                ) : (
                  <>
                    Entrar
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 duration-200" />
                  </>
                )}
              </span>
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}
