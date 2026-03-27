import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [searchParams] = useSearchParams();
  // FIX: exibe alerta quando o link de recovery expirou (vindo do ResetPassword timeout)
  const linkExpired = searchParams.get("expired") === "1";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    // FIX: setLoading(false) estava fora de try/finally — exceção travaria o botão.
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        // Não revelar se o email existe ou não (prevenção de enumeração de usuários).
        // Mostramos sucesso independente — comportamento correto de segurança.
        console.error("resetPasswordForEmail error:", error.message);
      }
      // Sempre mostra tela de sucesso para não vazar se o email está cadastrado
      setSent(true);
    } catch (err: any) {
      console.error("ForgotPassword error:", err);
      toast.error("Erro inesperado. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <Logo className="h-14 object-contain mx-auto" />
          <CardTitle className="font-display text-xl">Recuperar Senha</CardTitle>
        </CardHeader>
        <CardContent>
          {linkExpired && !sent && (
            <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
              Seu link de recuperação expirou ou é inválido. Solicite um novo abaixo.
            </div>
          )}
          {sent ? (
            <div className="text-center space-y-4">
              <p className="text-sm text-muted-foreground">
                Se <strong>{email}</strong> estiver cadastrado, você receberá um link de recuperação em breve. Verifique também a pasta de spam.
              </p>
              <Link to="/login">
                <Button variant="outline" className="w-full gap-2">
                  <ArrowLeft className="h-4 w-4" /> Voltar ao login
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                Informe seu email e enviaremos um link para redefinir sua senha.
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Enviando..." : "Enviar link de recuperação"}
                </Button>
              </form>
              <p className="text-center text-sm text-muted-foreground mt-4">
                <Link to="/login" className="text-primary hover:underline">
                  Voltar ao login
                </Link>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
