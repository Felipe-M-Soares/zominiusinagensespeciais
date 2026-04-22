import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Lock, Eye, EyeOff, ShieldCheck } from "lucide-react";

export default function SetPassword() {
  const { user } = useAuth();
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
      // 1. Atualiza a senha no Supabase Auth
      const { error: pwErr } = await supabase.auth.updateUser({ password });
      if (pwErr) {
        toast.error("Erro ao definir senha: " + pwErr.message);
        return;
      }

      // 2. Marca must_change_password = false no profile
      const { error: profileErr } = await supabase
        .from("profiles")
        .update({ must_change_password: false })
        .eq("user_id", user!.id);

      if (profileErr) {
        console.error("Profile update error:", profileErr.message);
        // Não bloqueia — a senha já foi atualizada
      }

      toast.success("Senha definida com sucesso! Bem-vindo.");
      navigate("/");
    } catch (err) {
      console.error("SetPassword error:", err);
      toast.error("Erro inesperado. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  // Aguarda verificação do must_change_password antes de renderizar
  if (mustChange === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/30 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo className="h-14 object-contain" />
          <div>
            <h1 className="text-xl font-semibold text-foreground tracking-tight">
              Olá, {displayName}!
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Defina sua senha pessoal para continuar
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-xl shadow-primary/5 space-y-5">
          <div className="flex items-start gap-3 rounded-xl bg-primary/5 border border-primary/20 px-4 py-3">
            <ShieldCheck className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Este é seu primeiro acesso. Crie uma senha pessoal.
              <strong className="text-foreground block mt-0.5">
                Você não poderá alterá-la depois — somente o administrador poderá redefinir.
              </strong>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Nova senha */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Nova senha</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                <Input
                  type={showPwd ? "text" : "password"}
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                  className="pl-10 pr-10 h-11 rounded-xl bg-background/50 border-border"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Confirmar senha */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Confirmar senha</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                <Input
                  type={showConf ? "text" : "password"}
                  placeholder="Repita a senha"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className="pl-10 pr-10 h-11 rounded-xl bg-background/50 border-border"
                />
                <button
                  type="button"
                  onClick={() => setShowConf(!showConf)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
                >
                  {showConf ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Indicador de força */}
            {password.length > 0 && (
              <div className="space-y-1">
                <div className="flex gap-1">
                  {[...Array(4)].map((_, i) => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        password.length >= [8, 10, 12, 14][i]
                          ? i < 2 ? "bg-warning" : "bg-success"
                          : "bg-muted"
                      }`}
                    />
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {password.length < 8 ? "Muito curta" :
                   password.length < 10 ? "Razoável" :
                   password.length < 12 ? "Boa" : "Forte"}
                </p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 rounded-xl font-medium text-sm"
              disabled={loading || password.length < 8 || password !== confirm}
            >
              {loading ? "Salvando..." : "Definir senha e entrar"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
