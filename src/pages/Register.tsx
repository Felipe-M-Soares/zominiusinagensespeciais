import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { toast } from "sonner";

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const { signUp } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim() || !displayName.trim()) return;
    if (password !== confirmPassword) {
      toast.error("As senhas não coincidem");
      return;
    }
    setLoading(true);
    try {
      const { error } = await signUp(email, password, displayName);
      if (error) {
        toast.error(error);
      } else {
        // FIX: tela de sucesso dedicada — toast sumia antes de ser lido porque
        // o componente desmontava quando signUp criava sessão automaticamente.
        setSuccess(true);
      }
    } catch (err: unknown) {
      console.error("Register error:", err);
      toast.error("Erro inesperado. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  // Tela de sucesso — exibida após cadastro bem-sucedido
  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-4">
            <Logo className="h-14 object-contain mx-auto" />
            <CardTitle className="font-display text-xl">Conta Criada!</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <div className="h-14 w-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
              <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-foreground">Cadastro realizado com sucesso!</p>
              <p className="text-sm text-muted-foreground mt-2">
                Sua conta está pronta. Faça login para acessar o sistema.
              </p>
            </div>
            <Link to="/login">
              <Button className="w-full">Fazer login</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Formulário de cadastro
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <Logo className="h-14 object-contain mx-auto" />
          <CardTitle className="font-display text-xl">Criar Conta</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              placeholder="Nome completo"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              maxLength={100}
            />
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <Input
              type="password"
              placeholder="Senha (mínimo 8 caracteres)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
            />
            <Input
              type="password"
              placeholder="Confirmar senha"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
            />
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Criando..." : "Criar Conta"}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground mt-4">
            Já tem conta?{" "}
            <Link to="/login" className="text-primary hover:underline">
              Entrar
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
