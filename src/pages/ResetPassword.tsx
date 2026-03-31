import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { toast } from "sonner";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // FIX: Não usar getSession() para habilitar o formulário de reset.
    // getSession() retorna qualquer sessão existente (do localStorage), então um usuário
    // já logado que abrisse /reset-password veria o formulário imediatamente, sem ter
    // clicado num link de recovery — podendo alterar a própria senha sem autenticação extra.
    // A única fonte confiável de uma sessão de recovery é o evento PASSWORD_RECOVERY
    // do onAuthStateChange, que é disparado pelo Supabase ao processar o token da URL.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });

    // Timeout de segurança: se após 15s o evento PASSWORD_RECOVERY não chegou,
    // o link expirou ou é inválido. Usamos estado separado para acionar o redirect
    // em vez de chamar navigate() ou window.location dentro de um setState updater.
    const timeout = setTimeout(() => {
      setTimedOut(true);
    }, 15_000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  // FIX: Redireciona para forgot-password quando o link expirou.
  // Feito via useEffect (não dentro de setState/timeout) para ser compatível com React.
  useEffect(() => {
    if (timedOut && !ready) {
      navigate("/forgot-password?expired=1", { replace: true });
    }
  }, [timedOut, ready, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("As senhas não coincidem");
      return;
    }
    if (password.length < 8) {
      toast.error("A senha deve ter no mínimo 8 caracteres");
      return;
    }
    // FIX: setLoading(false) estava fora de try/finally — se updateUser lançasse exceção,
    // o botão ficava travado em "Salvando..." para sempre.
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Senha redefinida! Faça login novamente para continuar.");
        // SEC: Após alterar a senha, invalidamos a sessão atual e forçamos novo login.
        // Isso previne session fixation: se o link de recovery foi interceptado,
        // o atacante não consegue manter a sessão após a vítima redefinir a senha.
        await supabase.auth.signOut();
        navigate("/login");
      }
    } catch (err: any) {
      toast.error("Erro inesperado. Tente novamente.");
      console.error("ResetPassword error:", err);
    } finally {
      setLoading(false);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-10 text-center">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">Verificando link de recuperação...</p>
            <p className="text-xs text-muted-foreground mt-2">
              Se esta tela persistir, o link pode ter expirado.{" "}
              <Link to="/forgot-password" className="text-primary hover:underline">
                Solicitar novo link
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <Logo className="h-14 object-contain mx-auto" />
          <CardTitle className="font-display text-xl">Nova Senha</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="password"
              placeholder="Nova senha (mínimo 8 caracteres)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <Input
              type="password"
              placeholder="Confirmar nova senha"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Salvando..." : "Redefinir Senha"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
