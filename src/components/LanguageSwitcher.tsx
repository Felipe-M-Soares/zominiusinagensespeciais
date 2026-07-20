import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/i18n";

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  pt: "PT",
  en: "EN",
  es: "ES",
};

interface Props {
  collapsed?: boolean;
  className?: string;
}

/**
 * Seletor de idioma manual. Mesmo com a detecção automática pelo navegador
 * (ver src/i18n/index.ts), o usuário sempre pode trocar manualmente — a
 * escolha fica salva no localStorage e prevalece nas próximas visitas.
 */
export function LanguageSwitcher({ collapsed, className }: Props) {
  const { i18n } = useTranslation();
  const current = (i18n.resolvedLanguage ?? "pt").split("-")[0] as SupportedLanguage;

  return (
    <div className={cn("flex items-center gap-1", collapsed && "flex-col", className)}>
      {!collapsed && <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
      <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
        {SUPPORTED_LANGUAGES.map((lng) => (
          <button
            key={lng}
            type="button"
            onClick={() => i18n.changeLanguage(lng)}
            aria-pressed={current === lng}
            className={cn(
              "px-1.5 py-0.5 rounded-md text-[10px] font-semibold tracking-wide transition-colors",
              current === lng
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {LANGUAGE_LABELS[lng]}
          </button>
        ))}
      </div>
    </div>
  );
}
