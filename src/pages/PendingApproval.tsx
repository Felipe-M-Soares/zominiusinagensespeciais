import { useEffect, useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { Clock, LogOut, ShieldOff, Loader2, RefreshCw } from "lucide-react";
import { logger } from "@/lib/logger";

export default function PendingApproval() {
  const { signOut, user, refreshApproval, approved, blocked } = useAuth();
  const navigate = useNavigate();
  const navigatedRef = useRef(false);
  // FIX: variável `checking` e `Loader2` estavam sendo usados no JSX mas nunca declarados,
  // causando erro de build (ReferenceError). Declarados aqui corretamente.
  const [checking, setChecking] = useState(false);

  // Quando aprovado, redireciona
  useEffect(() => {
    if (approved === true && !navigatedRef.current) {
      navigatedRef.current = true;
      navigate("/", { replace: true });
    }
  }, [approved, navigate]);

  const checkApproval = useCallback(async () => {
    if (!user?.id || navigatedRef.current) return;
    setChecking(true);
    try {
      await refreshApproval();
    } catch (err) {
      logger.error("checkApproval error:", err);
    } finally {
      setChecking(false);
    }
  }, [user?.id, refreshApproval]);



  const bloqueado = blocked;

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-4 py-8 bg-background">
      <div className="w-full max-w-[400px] text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
        <Logo className="h-9 w-auto object-contain mx-auto mb-8" />

        <div className="rounded-2xl border bg-card p-6 sm:p-8 shadow-sm space-y-5">
          <div className={`h-16 w-16 mx-auto rounded-2xl flex items-center justify-center ${bloqueado ? "bg-destructive/10" : "bg-warning/15"}`}>
            {bloqueado ? <ShieldOff className="h-8 w-8 text-destructive" /> : <Clock className="h-8 w-8 text-warning" />}
          </div>

          <div className="space-y-2">
            <h1 className={`text-xl font-bold tracking-tight ${bloqueado ? "text-destructive" : ""}`}>
              {bloqueado ? "Acesso bloqueado" : "Acesso suspenso"}
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {bloqueado
                ? "O seu acesso foi bloqueado pelo administrador."
                : "O administrador suspendeu temporariamente o acesso desta conta."}
            </p>
            <p className="text-xs text-muted-foreground">
              {bloqueado
                ? "Fale com o administrador do sistema para saber mais."
                : "Assim que o administrador reativar sua conta, você volta a entrar normalmente."}
            </p>
          </div>

          <div className="space-y-2">
            {!bloqueado && (
              <Button variant="outline" className="w-full h-11 rounded-xl gap-2" onClick={checkApproval} disabled={checking}>
                {checking ? <><Loader2 className="h-4 w-4 animate-spin" />Verificando…</> : <><RefreshCw className="h-4 w-4" />Já fui reativado? Verificar agora</>}
              </Button>
            )}
            <Button variant="ghost" className="w-full h-11 rounded-xl gap-2 text-muted-foreground" onClick={signOut}>
              <LogOut className="h-4 w-4" /> Sair
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
