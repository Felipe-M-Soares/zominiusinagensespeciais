import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Logo } from "@/components/Logo";
import { Home } from "lucide-react";
import { logger } from "@/lib/logger";

const NotFound = () => {
  const location = useLocation();
  useEffect(() => { logger.error("404:", location.pathname); }, [location.pathname]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: "hsl(var(--background))" }}>
      <div className="text-center space-y-8 animate-in fade-in duration-500">
        <Logo className="h-9 object-contain mx-auto"/>
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-4">
            <div className="h-px w-10" style={{ background: "hsl(var(--primary))" }}/>
            <span className="text-[5rem] font-bold leading-none" style={{ fontFamily: "'Syne', sans-serif", color: "hsl(var(--primary))" }}>404</span>
            <div className="h-px w-10" style={{ background: "hsl(var(--primary))" }}/>
          </div>
          <p className="text-[17px] font-semibold" style={{ fontFamily: "'Syne', sans-serif" }}>Página não encontrada</p>
          <p className="text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>
            O endereço{" "}<code className="px-1.5 py-0.5 rounded text-[12px]" style={{ background: "hsl(var(--muted))", fontFamily: "'JetBrains Mono', monospace" }}>{location.pathname}</code>{" "}não existe.
          </p>
        </div>
        <Link to="/" className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-[13.5px] font-bold transition-all"
          style={{ fontFamily: "'Syne', sans-serif", background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", boxShadow: "0 4px 16px hsl(var(--primary) / 0.24)" }}>
          <Home className="h-4 w-4"/>Voltar ao início
        </Link>
      </div>
    </div>
  );
};
export default NotFound;
