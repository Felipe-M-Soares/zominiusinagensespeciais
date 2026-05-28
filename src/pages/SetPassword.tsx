import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Lock, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { validatePassword, passwordStrength } from "@/lib/passwordUtils";
import { logger } from "@/lib/logger";

export default function SetPassword() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [showPwd, setShowPwd]     = useState(false);
  const [showConf, setShowConf]   = useState(false);
  const [loading, setLoading]     = useState(false);
  const [mustChange, setMustChange] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from("profiles").select("must_change_password").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => { if (data?.must_change_password === false) navigate("/", { replace: true }); else setMustChange(true); });
  }, [user?.id, navigate]);

  const displayName = (user?.user_metadata?.display_name as string) ?? "Usuário";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8)             { toast.error("Senha deve ter no mínimo 8 caracteres."); return; }
    if (password.length > 72)            { toast.error("Senha deve ter no máximo 72 caracteres."); return; }
    if (!/[A-Z]/.test(password))         { toast.error("A senha deve conter ao menos 1 letra maiúscula."); return; }
    if (!/[a-z]/.test(password))         { toast.error("A senha deve conter ao menos 1 letra minúscula."); return; }
    if (!/[0-9]/.test(password))         { toast.error("A senha deve conter ao menos 1 número."); return; }
    if (!/[^A-Za-z0-9]/.test(password)) { toast.error("A senha deve conter ao menos 1 caractere especial."); return; }
    if (password !== confirm)            { toast.error("As senhas não coincidem."); return; }
    setLoading(true);
    try {
      const { error: pwErr } = await supabase.auth.updateUser({ password });
      if (pwErr) { toast.error("Erro ao definir senha: " + pwErr.message); return; }
      const { error: pErr } = await supabase.from("profiles").update({ must_change_password: false }).eq("user_id", user!.id);
      if (pErr) logger.error("Profile update error:", pErr.message);
      toast.success("Senha definida com sucesso! Bem-vindo.");
      navigate("/");
    } catch (err) { logger.error("SetPassword error:", err); toast.error("Erro inesperado. Tente novamente."); }
    finally { setLoading(false); }
  }

  if (mustChange === null) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "hsl(var(--background))" }}>
      <div className="relative w-9 h-9">
        <div className="absolute inset-0 rounded-full border-2" style={{ borderColor: "hsl(var(--border))" }}/>
        <div className="absolute inset-0 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: "hsl(var(--primary))" }}/>
      </div>
    </div>
  );

  const canSubmit = !loading && !validatePassword(password) && password === confirm && password.length > 0;
  const strength  = password.length > 0 ? passwordStrength(password) : null;
  const pwError   = password.length > 0 ? validatePassword(password) : null;
  const sColors   = ["","hsl(4 80% 52%)","hsl(4 80% 52%)","hsl(38 92% 46%)","hsl(38 92% 46%)","hsl(152 52% 40%)"];

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8" style={{ background: "hsl(var(--background))" }}>
      <div className="w-full max-w-[370px] space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo className="h-9 object-contain"/>
          <div>
            <h1 className="text-[19px] font-bold" style={{ fontFamily: "'Syne', sans-serif", letterSpacing: "-0.02em" }}>Olá, {displayName}!</h1>
            <p className="text-[13px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>Defina sua senha pessoal para continuar</p>
          </div>
        </div>
        <div className="rounded-xl border overflow-hidden" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))", boxShadow: "0 8px 32px hsl(220 25% 10% / 0.07)" }}>
          <div className="h-[2px]" style={{ background: "linear-gradient(90deg, hsl(var(--primary)), transparent)" }}/>
          <div className="p-6 space-y-5">
            <div className="flex items-start gap-3 rounded-lg p-3.5" style={{ background: "hsl(var(--primary) / 0.06)", border: "1px solid hsl(var(--primary) / 0.16)" }}>
              <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "hsl(var(--primary))" }}/>
              <p className="text-[11.5px] leading-relaxed" style={{ color: "hsl(var(--muted-foreground))" }}>
                Esta é sua senha pessoal de acesso. Guarde-a com segurança.{" "}
                <strong style={{ color: "hsl(var(--foreground))" }}>Para redefinir, contate o administrador.</strong>
              </p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              {[
                { label:"Nova senha", value:password, setValue:setPassword, show:showPwd, setShow:setShowPwd, ph:"Mínimo 8 caracteres" },
                { label:"Confirmar senha", value:confirm, setValue:setConfirm, show:showConf, setShow:setShowConf, ph:"Repita a senha" },
              ].map(({ label, value, setValue, show, setShow, ph }, idx) => (
                <div key={idx} className="space-y-1.5">
                  <label className="text-[10.5px] font-bold uppercase tracking-[0.10em]" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "hsl(var(--muted-foreground) / 0.45)" }}/>
                    <Input type={show ? "text" : "password"} placeholder={ph} value={value} onChange={e => setValue(e.target.value)} required autoFocus={idx === 0}
                      className="pl-9 pr-10 h-11 rounded-lg border-2 transition-all focus-visible:ring-0"
                      style={{ borderColor: value ? (idx === 1 && value !== password ? "hsl(var(--destructive))" : "hsl(var(--primary))") : "hsl(var(--border))", boxShadow: (value && !(idx===1 && value!==password)) ? "0 0 0 3px hsl(var(--primary) / 0.09)" : "none" }}/>
                    <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-55" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {show ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}
                    </button>
                  </div>
                </div>
              ))}
              {strength && (
                <div className="space-y-1.5">
                  <div className="flex gap-1">
                    {[1,2,3,4,5].map(i => <div key={i} className="h-1 flex-1 rounded-full transition-all" style={{ background: i <= strength.score ? (sColors[strength.score] || "hsl(var(--muted))") : "hsl(var(--muted))" }}/>)}
                  </div>
                  <p className="text-[11px] font-medium" style={{ color: pwError ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))" }}>{pwError ?? strength.label}</p>
                </div>
              )}
              <button type="submit" disabled={!canSubmit} className="w-full h-11 rounded-lg font-bold text-[13.5px] transition-all"
                style={{ fontFamily: "'Syne', sans-serif", background: canSubmit ? "hsl(var(--primary))" : "hsl(var(--muted))", color: canSubmit ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))", boxShadow: canSubmit ? "0 4px 16px hsl(var(--primary) / 0.22)" : "none", cursor: canSubmit ? "pointer" : "not-allowed" }}>
                {loading ? "Salvando..." : "Definir senha e entrar"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
