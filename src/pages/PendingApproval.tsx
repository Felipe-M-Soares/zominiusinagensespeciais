import { useEffect, useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Logo } from "@/components/Logo";
import { Clock, LogOut, ShieldOff, Loader2, RefreshCw } from "lucide-react";
import { logger } from "@/lib/logger";

function StatusCard({ children, accentColor }: { children: React.ReactNode; accentColor: string }) {
  return (
    <div className="w-full max-w-sm text-center space-y-6">
      <Logo className="h-9 object-contain mx-auto"/>
      <div className="rounded-xl border overflow-hidden" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))", boxShadow: "0 8px 32px hsl(220 25% 10% / 0.08)" }}>
        <div className="h-[2px]" style={{ background: `linear-gradient(90deg, ${accentColor}, transparent)` }}/>
        <div className="p-6 space-y-5">{children}</div>
      </div>
    </div>
  );
}

export default function PendingApproval() {
  const { signOut, user, refreshApproval, approved, blocked } = useAuth();
  const navigate = useNavigate();
  const navigatedRef = useRef(false);
  const [checking, setChecking] = useState(false);
  useEffect(() => { if (approved === true && !navigatedRef.current) { navigatedRef.current = true; navigate("/", { replace: true }); } }, [approved, navigate]);
  const checkApproval = useCallback(async () => {
    if (!user?.id || navigatedRef.current) return;
    setChecking(true);
    try { await refreshApproval(); } catch (err) { logger.error("checkApproval:", err); } finally { setChecking(false); }
  }, [user?.id, refreshApproval]);

  if (blocked) return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "hsl(var(--background))" }}>
      <StatusCard accentColor="hsl(4 80% 52%)">
        <div className="h-14 w-14 mx-auto rounded-xl flex items-center justify-center" style={{ background: "hsl(4 80% 52% / 0.10)", border: "1px solid hsl(4 80% 52% / 0.20)" }}><ShieldOff className="h-7 w-7" style={{ color: "hsl(4 80% 52%)" }}/></div>
        <div className="space-y-1.5"><h1 className="text-[16px] font-bold" style={{ fontFamily: "'Syne', sans-serif", color: "hsl(4 80% 40%)" }}>Acesso Bloqueado</h1><p className="text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>O seu acesso foi bloqueado pelo administrador.</p></div>
        <button onClick={signOut} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-medium" style={{ color: "hsl(var(--muted-foreground))", background: "hsl(var(--muted) / 0.5)" }}><LogOut className="h-3.5 w-3.5"/>Sair</button>
      </StatusCard>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "hsl(var(--background))" }}>
      <StatusCard accentColor="hsl(var(--primary))">
        <div className="h-14 w-14 mx-auto rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--primary) / 0.10)", border: "1px solid hsl(var(--primary) / 0.20)" }}><Clock className="h-7 w-7" style={{ color: "hsl(var(--primary))" }}/></div>
        <div className="space-y-1.5"><h1 className="text-[16px] font-bold" style={{ fontFamily: "'Syne', sans-serif" }}>Aguardando Aprovação</h1><p className="text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>Você receberá acesso assim que o administrador aprovar seu cadastro.</p></div>
        <button onClick={checkApproval} disabled={checking} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-medium transition-all border" style={{ color: "hsl(var(--foreground))", background: "transparent", borderColor: "hsl(var(--border))" }}>
          {checking ? <><Loader2 className="h-3.5 w-3.5 animate-spin"/>Verificando...</> : <><RefreshCw className="h-3.5 w-3.5"/>Verificar aprovação</>}
        </button>
        <button onClick={signOut} className="w-full flex items-center justify-center gap-2 px-4 py-1.5 rounded-lg text-[12.5px]" style={{ color: "hsl(var(--muted-foreground))" }}><LogOut className="h-3.5 w-3.5"/>Sair</button>
      </StatusCard>
    </div>
  );
}
