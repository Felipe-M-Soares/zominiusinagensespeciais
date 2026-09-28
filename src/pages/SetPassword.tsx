import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Lock, Eye, EyeOff, ShieldCheck, Loader2, Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { validatePassword, passwordStrength } from "@/lib/passwordUtils";
import { logger } from "@/lib/logger";

export default function SetPassword() {
  const { user, clearMustChangePassword, signOut } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword]     = useState("");
  const [confirm, setConfirm]       = useState("");
  const [showPwd, setShowPwd]       = useState(false);
  const [showConf, setShowConf]     = useState(false);
  const [loading, setLoading]       = useState(false);
  // FIX: Verifica se o usuário realmente precisa trocar a senha.
  // Sem essa verificação, qualquer usuário autenticado podia acessar /set-password
  // diretamente pela URL e trocar a senha à vontade, ignorando o fluxo normal.
  const [mustChange, setMustChange] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("profiles")
      .select("must_change_password")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.must_change_password === false) {
          // Não precisa trocar senha — redireciona para home
          navigate("/", { replace: true });
        } else {
          setMustChange(true);
        }
      });
  }, [user?.id, navigate]);

  const displayName =
    (user?.user_metadata?.display_name as string) ?? "Usuário";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Senha deve ter no mínimo 8 caracteres.");
      return;
    }
    if (password.length > 72) {
      toast.error("Senha deve ter no máximo 72 caracteres.");
      return;
    }
    // SECURITY: valida complexidade — igual ao AdminUsers.validatePassword(),
    // evita que usuário defina senha fraca como "12345678" no primeiro login.
    if (!/[A-Z]/.test(password)) {
      toast.error("A senha deve conter ao menos 1 letra maiúscula.");
      return;
    }
    if (!/[a-z]/.test(password)) {
      toast.error("A senha deve conter ao menos 1 letra minúscula.");
      return;
    }
    if (!/[0-9]/.test(password)) {
      toast.error("A senha deve conter ao menos 1 número.");
      return;
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
      toast.error("A senha deve conter ao menos 1 caractere especial (!@#$%...).");
      return;
    }
    if (password !== confirm) {
      toast.error("As senhas não coincidem.");
      return;
    }

    setLoading(true);
    try {
      // RPC SECURITY DEFINER: atualiza auth.users diretamente + marca must_change_password=false.
      // supabase.auth.updateUser({ password }) retorna 400 quando a sessão foi criada
      // via INSERT direto (admin_create_user), pois o Supabase Auth exige reauthentication.
      const { data: result, error: rpcErr } = await supabase.rpc("set_own_password", {
        p_password: password,
      });

      if (rpcErr) {
        toast.error("Erro ao definir senha: " + rpcErr.message);
        return;
      }

      const res = result as { ok: boolean; error?: string } | null;
      if (!res?.ok) {
        toast.error(res?.error ?? "Erro ao definir senha. Tente novamente.");
        return;
      }

      // Zera o estado local imediatamente — evita que ProtectedLayout
      // redirecione de volta para /set-password antes do Realtime atualizar
      clearMustChangePassword();
      toast.success("Senha definida com sucesso! Bem-vindo.");
      navigate("/", { replace: true });
    } catch (err) {
      logger.error("SetPassword error:", err);
      toast.error("Erro inesperado. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  // Aguarda verificação do must_change_password antes de renderizar
  if (mustChange === null) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  const regras = [
    { ok: password.length >= 8 && password.length <= 72, label: "8 caracteres ou mais" },
    { ok: /[A-Z]/.test(password), label: "Uma letra maiúscula" },
    { ok: /[a-z]/.test(password), label: "Uma letra minúscula" },
    { ok: /[0-9]/.test(password), label: "Um número" },
    { ok: /[^A-Za-z0-9]/.test(password), label: "Um símbolo (!@#$%…)" },
  ];
  const confereConfirmacao = confirm.length > 0 && password === confirm;
  const strength = password ? passwordStrength(password) : null;

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-4 py-8 bg-background">
      <div className="w-full max-w-[400px] animate-in fade-in slide-in-from-bottom-4 duration-500">
        <Logo className="h-9 w-auto object-contain mb-8" />

        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary mb-2">Primeiro acesso</p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">Olá, {displayName}!</h1>
          <p className="mt-2 text-sm text-muted-foreground">Crie a sua senha pessoal para continuar. Só você vai saber essa senha.</p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="nova-senha" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nova senha</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70 pointer-events-none" />
              <Input
                id="nova-senha"
                type={showPwd ? "text" : "password"}
                placeholder="Crie uma senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                autoComplete="new-password"
                maxLength={72}
                className="pl-10 pr-12 h-12 rounded-xl text-[15px] bg-card"
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                aria-label={showPwd ? "Ocultar senha" : "Mostrar senha"}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {strength && strength.score > 0 && (
              <div className="flex gap-1 pt-1" aria-hidden>
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className={cn("h-1 flex-1 rounded-full transition-colors", i <= strength.score ? strength.color : "bg-muted")} />
                ))}
              </div>
            )}
            <ul className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-x-3 gap-y-1 pt-1.5" aria-label="Requisitos da senha">
              {regras.map(r => (
                <li key={r.label} className={cn("flex items-center gap-1.5 text-xs", r.ok ? "text-success" : "text-muted-foreground")}>
                  {r.ok ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Circle className="h-3 w-3 shrink-0 opacity-50" />}
                  {r.label}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirmar-senha" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Repita a senha</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70 pointer-events-none" />
              <Input
                id="confirmar-senha"
                type={showConf ? "text" : "password"}
                placeholder="Digite de novo"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                maxLength={72}
                aria-invalid={confirm.length > 0 && !confereConfirmacao}
                className="pl-10 pr-12 h-12 rounded-xl text-[15px] bg-card"
              />
              <button
                type="button"
                onClick={() => setShowConf(!showConf)}
                aria-label={showConf ? "Ocultar senha" : "Mostrar senha"}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {showConf ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {confirm.length > 0 && (
              <p className={cn("text-xs font-medium", confereConfirmacao ? "text-success" : "text-destructive")}>
                {confereConfirmacao ? "As senhas conferem." : "As senhas ainda não são iguais."}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full h-12 rounded-xl font-semibold text-sm gap-2 mt-2"
            disabled={loading || !!validatePassword(password) || password !== confirm}
          >
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Salvando…</> : <><ShieldCheck className="h-4 w-4" />Definir senha e entrar</>}
          </Button>
        </form>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Esqueceu depois? Peça ao administrador para redefinir.
        </p>
        <div className="mt-3 text-center">
          <button type="button" onClick={() => signOut()} className="text-xs text-muted-foreground underline-offset-4 hover:underline hover:text-foreground">
            Sair e entrar com outra conta
          </button>
        </div>
      </div>
    </div>
  );
}
