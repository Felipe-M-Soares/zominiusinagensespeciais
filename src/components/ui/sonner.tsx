import { Toaster as Sonner } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTheme } from "@/lib/theme";
import { CheckCircle2, XCircle, AlertTriangle, Info, Loader2 } from "lucide-react";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Ícones coloridos usados nos dois modos (mobile e desktop).
const coloredIcons = {
  success: (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm shadow-emerald-500/40">
      <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} />
    </span>
  ),
  error: (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow-sm shadow-red-500/40">
      <XCircle className="h-4 w-4" strokeWidth={2.5} />
    </span>
  ),
  warning: (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-white shadow-sm shadow-amber-500/40">
      <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.5} />
    </span>
  ),
  info: (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500 text-white shadow-sm shadow-sky-500/40">
      <Info className="h-4 w-4" strokeWidth={2.5} />
    </span>
  ),
  loading: (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500 text-white shadow-sm shadow-violet-500/40">
      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
    </span>
  ),
};

const Toaster = ({ ...props }: ToasterProps) => {
  // Segue o tema real do app (antes usava next-themes sem ThemeProvider e
  // ficava preso em "system", destoando quando o usuário escolhia outro tema).
  const { resolvedTheme } = useTheme();
  const isMobile = useIsMobile();

  // Mobile: toasts no topo (longe dos botões fixos no rodapé dos modais) e
  // COM o texto visível — antes eram só um ícone, e a pessoa não conseguia ler
  // a mensagem de erro sem tocar nela.
  return (
    <Sonner
      theme={resolvedTheme}
      // Mobile: topo da tela, longe dos botões "Cancelar/Confirmar" fixos no rodapé dos modais.
      // Desktop: mantém o canto inferior direito, comportamento já conhecido.
      position={isMobile ? "top-center" : "bottom-right"}
      icons={coloredIcons}
      className="toaster group"
      closeButton={!isMobile}
      visibleToasts={isMobile ? 2 : 4}
      offset={isMobile ? 12 : 24}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
export { toast } from "sonner";

