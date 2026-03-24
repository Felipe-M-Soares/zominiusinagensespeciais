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
    const { signUp } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.trim() || !password.trim() || !displayName.trim()) return;
      // BUG-010 FIX: Validate that passwords match before submitting
      if (password !== confirmPassword) {
        toast.error("As senhas não coincidem");
        return;
      }
      setLoading(true);
      const { error } = await signUp(email, password, displayName);
      setLoading(false);
      if (error) {
        toast.error(error);
      } else {
        toast.success("Conta criada! Verifique seu email para confirmar e aguarde a aprovação do administrador.");
      }
    };

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
              />
              {/* BUG-010 FIX: Confirm password field prevents undetected typos */}
              <Input
                type="password"
                placeholder="Confirmar senha"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                minLength={8}
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
  