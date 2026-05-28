import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, ShieldX, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import logoZomini from "@/assets/logo_zomini.png";
import logoZominiDark from "@/assets/logo_zomini_dark.png";

export default function Login() {
  const [login, setLogin]             = useState("");
  const [password, setPassword]       = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]         = useState(false);
  const { signIn } = useAuth();
  const navigate   = useNavigate();
  const location   = useLocation();
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
        const { data: profile } = await supabase.from("profiles").select("must_change_password").eq("user_id", session.user.id).maybeSingle();
        if (profile?.must_change_password === true) { navigate("/set-password"); return; }
      }
      navigate("/");
    } catch (err) { logger.error("Login error:", err); toast.error("Erro inesperado. Tente novamente."); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex overflow-hidden" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* ── Left brand panel ── */}
      <div className="hidden lg:flex flex-col justify-between w-[48%] relative overflow-hidden p-12" style={{ background: "hsl(222 32% 9%)" }}>
        {/* Grid */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.036 }}>
          <defs><pattern id="g" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0L0 0 0 30" fill="none" stroke="hsl(38 92% 52%)" strokeWidth="0.5"/></pattern></defs>
          <rect width="100%" height="100%" fill="url(#g)"/>
        </svg>
        {/* Glows */}
        <div className="absolute top-[-18%] left-[-12%] w-[560px] h-[560px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, hsl(38 92% 46% / 0.14) 0%, transparent 65%)" }}/>
        <div className="absolute bottom-[-18%] right-[-12%] w-[380px] h-[380px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, hsl(197 82% 46% / 0.08) 0%, transparent 65%)" }}/>
        <div className="absolute left-0 top-0 bottom-0 w-[2px]" style={{ background: "linear-gradient(to bottom, transparent, hsl(38 92% 46%), transparent)" }}/>
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: "linear-gradient(90deg, hsl(38 92% 46%), transparent)" }}/>
        {/* Logo */}
        <div className="relative z-10"><img src={logoZominiDark} alt="Zomini" className="h-9 w-auto object-contain opacity-90"/></div>
        {/* Content */}
        <div className="relative z-10 space-y-8">
          <div className="w-13 h-13 rounded-xl flex items-center justify-center" style={{ width:52, height:52, background:"hsl(38 92% 46% / 0.10)", border:"1px solid hsl(38 92% 46% / 0.22)", boxShadow:"0 0 28px hsl(38 92% 46% / 0.10)" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="2.8" fill="hsl(38 92% 54%)"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="hsl(38 92% 46%)" strokeWidth="1.2" strokeDasharray="2 2.5"/><circle cx="12" cy="12" r="10.5" fill="none" stroke="hsl(38 92% 46% / 0.3)" strokeWidth="0.7"/><line x1="1" y1="12" x2="23" y2="12" stroke="hsl(38 92% 46% / 0.22)" strokeWidth="0.7"/><line x1="12" y1="1" x2="12" y2="23" stroke="hsl(38 92% 46% / 0.22)" strokeWidth="0.7"/></svg>
          </div>
          <div>
            <h2 className="text-[2.35rem] font-bold leading-[1.15]" style={{ fontFamily:"'Syne',sans-serif", color:"#eef2ff", letterSpacing:"-0.03em" }}>Sistema de<br/><span style={{ color:"hsl(38 92% 58%)" }}>Gestão Integrada</span></h2>
            <p className="mt-4 text-[14.5px] leading-relaxed" style={{ color:"hsl(220 18% 62%)" }}>Controle de estoque, produção e comercial com precisão industrial.</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[{ label:"Módulos", value:"5" }, { label:"Integrado", value:"100%" }, { label:"Tempo Real", value:"∞" }].map(m => (
              <div key={m.label} className="rounded-lg p-3.5" style={{ background:"hsl(38 92% 46% / 0.05)", border:"1px solid hsl(38 92% 46% / 0.10)" }}>
                <div className="text-[1.5rem] font-bold" style={{ fontFamily:"'Syne',sans-serif", color:"hsl(38 92% 58%)" }}>{m.value}</div>
                <div className="text-[10px] tracking-widest uppercase mt-0.5" style={{ color:"hsl(220 15% 48%)" }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10"><p className="text-[11px]" style={{ color:"hsl(220 15% 32%)" }}>© {new Date().getFullYear()} Zomini Usinagens Especiais</p></div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12" style={{ background:"hsl(220 18% 97%)" }}>
        <div className="lg:hidden mb-10"><img src={logoZomini} alt="Zomini" className="h-9 w-auto object-contain"/></div>
        <div className="w-full max-w-[360px] animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="mb-8">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] mb-2" style={{ fontFamily:"'Syne',sans-serif", color:"hsl(38 92% 40%)" }}>Bem-vindo de volta</p>
            <h1 className="text-[1.9rem] font-bold" style={{ fontFamily:"'Syne',sans-serif", color:"hsl(222 30% 10%)", letterSpacing:"-0.03em" }}>Acesse sua conta</h1>
            <p className="mt-1.5 text-[13.5px]" style={{ color:"hsl(220 12% 48%)" }}>Digite suas credenciais para continuar</p>
          </div>

          {wasBlocked && (
            <div className="mb-6 px-4 py-3 rounded-xl flex items-start gap-3" style={{ background:"hsl(4 80% 97%)", border:"1px solid hsl(4 80% 88%)" }}>
              <ShieldX className="h-4 w-4 mt-0.5 shrink-0" style={{ color:"hsl(4 80% 50%)" }}/>
              <div><p className="text-[12.5px] font-semibold" style={{ color:"hsl(4 80% 36%)" }}>Acesso Bloqueado</p><p className="text-[11.5px] mt-0.5" style={{ color:"hsl(4 60% 48%)" }}>Entre em contato com o administrador.</p></div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-bold uppercase tracking-[0.12em]" style={{ color:"hsl(222 25% 28%)" }}>Login</label>
              <Input type="text" placeholder="Seu login" value={login} onChange={e => setLogin(e.target.value)} required autoComplete="username" autoFocus
                className="h-11 rounded-lg text-[13.5px] font-medium border-2 transition-all focus-visible:ring-0 placeholder:opacity-40"
                style={{ background:"hsl(0 0% 100%)", borderColor:login ? "hsl(38 92% 46%)" : "hsl(220 14% 84%)", color:"hsl(222 30% 10%)", boxShadow:login ? "0 0 0 3px hsl(38 92% 46% / 0.10)" : "none" } as React.CSSProperties}/>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-bold uppercase tracking-[0.12em]" style={{ color:"hsl(222 25% 28%)" }}>Senha</label>
              <div className="relative">
                <Input type={showPassword ? "text" : "password"} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password"
                  className="h-11 pr-12 rounded-lg text-[13.5px] font-medium border-2 transition-all focus-visible:ring-0 placeholder:opacity-40 [&::-ms-reveal]:hidden"
                  style={{ background:"hsl(0 0% 100%)", borderColor:password ? "hsl(38 92% 46%)" : "hsl(220 14% 84%)", color:"hsl(222 30% 10%)", boxShadow:password ? "0 0 0 3px hsl(38 92% 46% / 0.10)" : "none" } as React.CSSProperties}/>
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-55" style={{ color:"hsl(220 12% 50%)" }} tabIndex={-1}>
                  {showPassword ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}
                </button>
              </div>
            </div>
            <button type="submit" disabled={!canSubmit}
              className="relative w-full h-11 rounded-lg font-bold text-[13.5px] tracking-wide transition-all duration-200 overflow-hidden group mt-2"
              style={{ fontFamily:"'Syne',sans-serif", background:canSubmit ? "hsl(38 92% 46%)" : "hsl(38 50% 82%)", color:canSubmit ? "hsl(222 30% 8%)" : "hsl(220 12% 58%)", boxShadow:canSubmit ? "0 4px 20px hsl(38 92% 46% / 0.28)" : "none", cursor:canSubmit ? "pointer" : "not-allowed" } as React.CSSProperties}>
              <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200" style={{ background:"hsl(38 92% 52%)" }}/>
              <span className="relative flex items-center justify-center gap-2">
                {loading ? <><div className="h-4 w-4 border-2 border-current/40 border-t-current rounded-full animate-spin"/>Entrando...</> : <>Entrar<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 duration-200"/></>}
              </span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
