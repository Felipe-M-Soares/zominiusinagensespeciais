import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { invokeWithAuth } from "@/lib/invokeEdgeFunction";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { Clock, LogOut, CheckCircle, Loader2 } from "lucide-react";

// CORREÇÃO: servidor exige 55s de conta criada antes de aprovar.
// Usamos 62s no frontend para dar margem de latência de rede (+7s).
const AUTO_APPROVE_SECONDS = 62;
const POLL_INTERVAL_MS = 5_000;

export default function PendingApproval() {
  const { signOut, user, refreshApproval, approved } = useAuth();
  const navigate = useNavigate();

  const [secondsLeft, setSecondsLeft] = useState(AUTO_APPROVE_SECONDS);
  // FIX LOOP: controla se a Edge Function já foi invocada para evitar chamadas repetidas
  const autoApproveCalledRef = useRef(false);
  const [autoApproveTriggered, setAutoApproveTriggered] = useState(false);
  // FIX LOOP INFINITO: quando auto-approve falha (ex: JWT inválido), mostra mensagem
  // ao invés de ficar preso em "Ativando sua conta..." para sempre.
  const [autoApproveFailed, setAutoApproveFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  // FIX LOOP: flag para evitar que o polling continue após navegar
  const navigatedRef = useRef(false);

  // Quando approved virar true no contexto, navega para home
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
      console.error("checkApproval error:", err);
    } finally {
      setChecking(false);
    }
  }, [user?.id, refreshApproval]);

  // FIX LOOP: a Edge Function auto-approve só é chamada uma vez usando ref
  const triggerAutoApprove = useCallback(async () => {
    if (!user?.id || autoApproveCalledRef.current) return;
    autoApproveCalledRef.current = true;
    try {
      const { errorMsg } = await invokeWithAuth("auto-approve", {
        body: { user_id: user.id },
      });
      // Se a Edge Function retornou erro, marca falha para sair do spinner infinito
      if (errorMsg) {
        console.error("auto-approve error:", errorMsg);
        setAutoApproveFailed(true);
      }
    } catch (err) {
      console.error("auto-approve invoke error:", err);
      setAutoApproveFailed(true);
    }
  }, [user?.id]);

  // Countdown decrescente 60 → 0
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1_000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  // FIX LOOP: quando chega a 0 dispara aprovação + verifica, mas nunca em loop
  useEffect(() => {
    if (secondsLeft === 0 && !autoApproveTriggered) {
      setAutoApproveTriggered(true);
      triggerAutoApprove().then(async () => {
        if (!navigatedRef.current) {
          // Força refresh do token para que RLS leia approved=true atualizado
          await supabase.auth.refreshSession().catch(() => {});
          checkApproval();
        }
      });
    }
  }, [secondsLeft, autoApproveTriggered, triggerAutoApprove, checkApproval]);

  // FIX LOOP: polling para enquanto o componente estiver montado E não tiver navegado
  useEffect(() => {
    const interval = setInterval(() => {
      if (!navigatedRef.current) checkApproval();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [checkApproval]);

  const progress = Math.round(((AUTO_APPROVE_SECONDS - secondsLeft) / AUTO_APPROVE_SECONDS) * 100);
  const isApproving = secondsLeft === 0;
  const circumference = 2 * Math.PI * 28;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/30 flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center space-y-6">
        <Logo className="h-14 object-contain mx-auto" />

        <div className="bg-card border border-border rounded-2xl p-8 shadow-xl space-y-5">

          {/* Ícone com progresso circular */}
          <div className="relative h-16 w-16 mx-auto">
            <svg className="absolute inset-0 h-16 w-16 -rotate-90" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="28" fill="none" strokeWidth="4"
                className="stroke-amber-100 dark:stroke-amber-900/30" />
              <circle cx="32" cy="32" r="28" fill="none" strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - progress / 100)}
                className={`transition-all duration-1000 ease-linear ${
                  autoApproveFailed ? "stroke-amber-400" :
                  isApproving ? "stroke-green-500" : "stroke-amber-500"
                }`}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              {isApproving && !autoApproveFailed
                ? <Loader2 className="h-6 w-6 text-green-500 animate-spin" />
                : <Clock className="h-6 w-6 text-amber-500" />
              }
            </div>
          </div>

          {isApproving && !autoApproveFailed ? (
            <div>
              <h1 className="text-lg font-semibold text-green-600 dark:text-green-400">
                Ativando sua conta...
              </h1>
              <p className="text-sm text-muted-foreground mt-2">
                Aprovação automática em andamento. Você será redirecionado em instantes.
              </p>
            </div>
          ) : autoApproveFailed ? (
            <div>
              <h1 className="text-lg font-semibold text-amber-600 dark:text-amber-400">
                Aguardando Aprovação
              </h1>
              <p className="text-sm text-muted-foreground mt-2">
                A aprovação automática não pôde ser concluída agora.<br />
                Sua conta será aprovada assim que o administrador confirmar seu acesso.
              </p>
            </div>
          ) : (
            <div>
              <h1 className="text-lg font-semibold">Aguardando Aprovação</h1>
              <p className="text-sm text-muted-foreground mt-2">
                Sua conta <strong>{user?.email}</strong> foi criada com sucesso.
              </p>
            </div>
          )}

          {!isApproving && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 space-y-1">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300 flex items-center justify-center gap-1.5">
                <CheckCircle className="h-3.5 w-3.5" />
                Aprovação automática em
              </p>
              <p className="text-4xl font-bold tabular-nums text-amber-600 dark:text-amber-400 tracking-tight">
                {String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:
                {String(secondsLeft % 60).padStart(2, "0")}
              </p>
              <p className="text-xs text-amber-600/70 dark:text-amber-400/70">
                Ou assim que o administrador aprovar manualmente
              </p>
            </div>
          )}

          {checking && (
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Verificando status...
            </p>
          )}

          {(!isApproving || autoApproveFailed) && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs h-8"
              onClick={checkApproval}
              disabled={checking}
            >
              {checking
                ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Verificando...</>
                : "Já fui aprovado? Verificar agora"
              }
            </Button>
          )}

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
