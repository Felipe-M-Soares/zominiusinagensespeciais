import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Eye, EyeOff, ShieldX, ArrowRight, AlertCircle, Boxes, Factory, ShieldCheck,
  ShoppingBag, Receipt, WifiOff,
} from "lucide-react";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import logoZomini from "@/assets/logo_zomini.webp";

const MODULOS = [
  { icon: Boxes,       label: "Estoque e expedição" },
  { icon: Factory,     label: "Produção e OEE" },
  { icon: ShieldCheck, label: "Qualidade e ANVISA" },
  { icon: ShoppingBag, label: "Comercial e pedidos" },
  { icon: Receipt,     label: "Financeiro e NF-e" },
];

export default function Login() {
  const [login, setLogin]               = useState("");
  const [password, setPassword]         = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [capsLock, setCapsLock]         = useState(false);
  const { signIn } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();

  const wasBlocked = (location.state as { blocked?: boolean } | null)?.blocked === true;
  const offline    = typeof navigator !== "undefined" && !navigator.onLine;
  const canSubmit  = !!login.trim() && !!password && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const { error } = await signIn(login.trim(), password);
      // Erro exibido junto ao formulário (antes só em toast — no celular o
      // toast era um ícone sem texto e a pessoa não via o motivo).
      if (error) { setError(error); return; }
      // "/" redireciona para a tela inicial do perfil (ver IndexRoute) e o
      // ProtectedLayout cuida da troca de senha obrigatória.
      navigate("/");
    } catch (err) {
      logger.error("Login error:", err);
      setError("Erro inesperado. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  const detectCaps = (e: React.KeyboardEvent<HTMLInputElement>) =>
    setCapsLock(e.getModifierState?.("CapsLock") ?? false);

  return (
    <div className="min-h-[100dvh] flex bg-background">
      {/* ── Painel de identidade (desktop) ─────────────────────────────── */}
      <aside
        className="hidden lg:flex flex-col justify-between w-[46%] max-w-[640px] relative overflow-hidden p-12 text-white"
        style={{ background: "linear-gradient(155deg, #0c1220 0%, #111a2e 55%, #0b1324 100%)" }}
      >
        <div
          aria-hidden
          className="absolute -top-40 -left-40 w-[560px] h-[560px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, hsl(var(--brand) / 0.22) 0%, transparent 65%)" }}
        />
        <div
          aria-hidden
          className="absolute -bottom-48 -right-32 w-[520px] h-[520px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, hsl(199 89% 50% / 0.16) 0%, transparent 65%)" }}
        />
        <svg aria-hidden className="absolute inset-0 w-full h-full opacity-[0.05]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="login-grid" width="44" height="44" patternUnits="userSpaceOnUse">
              <path d="M 44 0 L 0 0 0 44" fill="none" stroke="white" strokeWidth="0.7" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#login-grid)" />
        </svg>

        <img src={logoZomini} alt="Zomini Usinagens Especiais" className="relative h-10 w-auto self-start" />

        <div className="relative space-y-8">
          <div className="space-y-4">
            <h2 className="font-display text-[2.6rem] font-bold leading-[1.1] tracking-tight">
              Gestão integrada
              <br />
              <span className="text-brand">da usinagem à nota fiscal.</span>
            </h2>
            <p className="text-base leading-relaxed text-white/65 max-w-md">
              Um só lugar para acompanhar peças, produção, qualidade, pedidos e financeiro.
            </p>
          </div>
          <ul className="grid grid-cols-1 xl:grid-cols-2 gap-2.5 max-w-lg">
            {MODULOS.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white/80"
              >
                <Icon className="h-4 w-4 text-brand shrink-0" />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/40">
          © {new Date().getFullYear()} Zomini Usinagens Especiais
        </p>
      </aside>

      {/* ── Formulário ─────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-[380px] animate-in fade-in slide-in-from-bottom-4 duration-500">
          <img src={logoZomini} alt="Zomini Usinagens Especiais" className="lg:hidden h-9 w-auto mb-10" />

          <header className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary mb-2">
              Bem-vindo de volta
            </p>
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
              Acesse sua conta
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Use o login e a senha fornecidos pelo administrador.
            </p>
          </header>

          {wasBlocked && (
            <div role="alert" className="mb-5 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
              <ShieldX className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-semibold text-destructive">Acesso bloqueado</p>
                <p className="text-xs mt-0.5 text-muted-foreground">
                  Seu acesso foi bloqueado. Entre em contato com o administrador.
                </p>
              </div>
            </div>
          )}

          {offline && (
            <div role="status" className="mb-5 flex items-center gap-2.5 rounded-xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-xs text-foreground">
              <WifiOff className="h-4 w-4 shrink-0 text-warning" />
              Você está sem internet. O login precisa de conexão.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="login" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Login
              </Label>
              <Input
                id="login"
                name="username"
                type="text"
                placeholder="seu.login"
                value={login}
                onChange={(e) => { setLogin(e.target.value); if (error) setError(null); }}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                aria-invalid={!!error}
                className="h-12 rounded-xl text-[15px] bg-card"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Senha
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
                  onKeyUp={detectCaps}
                  onKeyDown={detectCaps}
                  autoComplete="current-password"
                  aria-invalid={!!error}
                  aria-describedby={capsLock ? "caps-hint" : undefined}
                  className="h-12 pr-12 rounded-xl text-[15px] bg-card"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  aria-pressed={showPassword}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {capsLock && (
                <p id="caps-hint" className="text-xs text-warning font-medium">Caps Lock está ativado.</p>
              )}
            </div>

            {error && (
              <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                "w-full h-12 rounded-xl font-semibold text-sm tracking-wide transition-all duration-200 mt-2",
                "inline-flex items-center justify-center gap-2 group",
                "bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:brightness-110 active:scale-[0.99]",
                "disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed disabled:active:scale-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
                  Entrando...
                </>
              ) : (
                <>
                  Entrar
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Esqueceu a senha? Peça ao administrador para redefini-la.
          </p>
        </div>
      </main>
    </div>
  );
}
