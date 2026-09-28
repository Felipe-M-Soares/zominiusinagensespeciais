import { useLocation, Link, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Home, SearchX } from "lucide-react";
import { logger } from "@/lib/logger";

// Link do React Router (sem recarregar a página); "/" leva à tela inicial do perfil.
const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    logger.error("404: rota não encontrada:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-[400px] text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
        <Logo className="h-9 w-auto object-contain mx-auto mb-8" />
        <div className="rounded-2xl border bg-card p-6 sm:p-8 shadow-sm space-y-5">
          <div className="h-16 w-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
            <SearchX className="h-8 w-8 text-primary" />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Erro 404</p>
            <h1 className="text-xl font-bold tracking-tight">Página não encontrada</h1>
            <p className="text-sm text-muted-foreground break-words">
              O endereço <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{location.pathname}</code> não existe ou foi movido.
            </p>
          </div>
          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-2">
            <Button variant="outline" className="h-11 rounded-xl gap-2" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" /> Voltar
            </Button>
            <Button asChild className="h-11 rounded-xl gap-2">
              <Link to="/"><Home className="h-4 w-4" /> Tela inicial</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
