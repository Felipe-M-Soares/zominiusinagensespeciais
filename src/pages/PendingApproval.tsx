import { Link } from "react-router-dom";
  import { useAuth } from "@/hooks/useAuth";
  import { Button } from "@/components/ui/button";
  import { Logo } from "@/components/Logo";
  import { Clock, LogOut } from "lucide-react";

  export default function PendingApproval() {
    const { signOut, user } = useAuth();

    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/30 flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center space-y-6">
          <Logo className="h-14 object-contain mx-auto" />
          <div className="bg-card border border-border rounded-2xl p-8 shadow-xl space-y-4">
            <div className="h-14 w-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto">
              <Clock className="h-7 w-7 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Aguardando Aprovação</h1>
              <p className="text-sm text-muted-foreground mt-2">
                Sua conta <strong>{user?.email}</strong> foi criada com sucesso. Um administrador precisa
                aprovar seu acesso antes que você possa utilizar o app.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Você receberá um email quando seu acesso for liberado. Se já foi aprovado, tente entrar novamente.
            </p>
            <Button variant="outline" className="w-full gap-2" onClick={signOut}>
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      </div>
    );
  }
  