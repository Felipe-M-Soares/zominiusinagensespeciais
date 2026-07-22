import { useEffect, useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { Clock, LogOut, ShieldOff, Loader2 } from "lucide-react";
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



  // ── TELA DE BLOQUEADO ──────────────────────────────────────────────────────
  if (blocked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-transparent via-transparent to-accent/20 flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center space-y-6">
          <Logo className="h-14 object-contain mx-auto" />

          <div className="bg-card border border-border rounded-2xl p-8 shadow-xl space-y-5">
            {/* Ícone */}
            <div className="h-16 w-16 mx-auto rounded-2xl bg-destructive/10 flex items-center justify-center">
              <ShieldOff className="h-8 w-8 text-destructive" />
            </div>

            <div className="space-y-2">
              <h1 className="text-lg font-semibold text-destructive">Acesso Bloqueado</h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                O seu acesso foi bloqueado pelo administrador.
              </p>
              <p className="text-xs text-muted-foreground/70">
                Entre em contato com o suporte para mais informações.
              </p>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="w-full gap-2 text-muted-foreground text-xs"
              onClick={signOut}
            >
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── TELA DE ACESSO SUSPENSO (approved=false, definido manualmente pelo admin) ──
  return (
    <div className="min-h-screen bg-gradient-to-br from-transparent via-transparent to-accent/20 flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center space-y-6">
        <Logo className="h-14 object-contain mx-auto" />

        <div className="bg-card border border-border rounded-2xl p-8 shadow-xl space-y-5">
          {/* Ícone */}
          <div className="h-16 w-16 mx-auto rounded-2xl bg-amber-500/10 flex items-center justify-center">
            <Clock className="h-8 w-8 text-amber-500" />
          </div>

          <div className="space-y-2">
            <h1 className="text-lg font-semibold">Acesso Suspenso</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              O administrador suspendeu temporariamente o acesso desta conta.
            </p>
            <p className="text-xs text-muted-foreground/70">
              Você recupera o acesso assim que o administrador reativar sua conta no painel.
            </p>
          </div>

<Button
            variant="outline"
            size="sm"
            className="w-full text-xs h-8"
            onClick={checkApproval}
            disabled={checking}
          >
            {checking
              ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Verificando...</>
              : "Já fui reativado? Verificar agora"
            }
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="w-full gap-2 text-muted-foreground text-xs"
            onClick={signOut}
          >
            <LogOut className="h-4 w-4" />
            Sair
          </Button>
        </div>
      </div>
    </div>
  );
}
