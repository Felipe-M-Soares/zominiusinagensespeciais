import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Home } from "lucide-react";
import { logger } from "@/lib/logger";
import { useTranslation } from "react-i18next";

// FIX: Página estava em inglês; corrigida para português.
// FIX: Link com <a href="/"> causava reload full-page; trocado para <Link> do React Router.
const NotFound = () => {
const location = useLocation();
const { t } = useTranslation();

useEffect(() => {
  logger.error("404: rota não encontrada:", location.pathname);
}, [location.pathname]);

return (
  <div className="flex min-h-screen items-center justify-center bg-background px-4">
    <div className="text-center space-y-6">
      <Logo className="h-12 object-contain mx-auto" />
      <div className="space-y-2">
        <h1 className="text-6xl font-bold text-primary">404</h1>
        <p className="text-xl font-semibold text-foreground">{t("notFound.title")}</p>
        <p className="text-sm text-muted-foreground">
          {t("notFound.addressPrefix")} <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{location.pathname}</code> {t("notFound.addressSuffix")}
        </p>
      </div>
      <Button asChild>
        <Link to="/" className="gap-2">
          <Home className="h-4 w-4" />
          {t("notFound.backHome")}
        </Link>
      </Button>
    </div>
  </div>
);
};

export default NotFound;
