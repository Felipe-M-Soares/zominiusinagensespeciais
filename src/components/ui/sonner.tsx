import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";
import { useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { CheckCircle2, XCircle, AlertTriangle, Info, Loader2 } from "lucide-react";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Ícones coloridos usados nos dois modos (mobile e desktop).
// No mobile o toast vira uma "pílula" compacta — só o círculo colorido aparece,
// já que o texto fica escondido via CSS para não cobrir botões fixos no rodapé.
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
  const { theme = "system" } = useTheme();
  const isMobile = useIsMobile();

  // No mobile, o toast aparece como uma pílula só com ícone. Tocar nela revela
  // o texto por alguns segundos — sem isso, quem precisa confirmar a mensagem
  // exata (ex: qual erro de validação) não teria como ver.
  useEffect(() => {
    if (!isMobile) return;
    function handleTap(e: MouseEvent | TouchEvent) {
      const toastEl = (e.target as HTMLElement)?.closest?.("[data-sonner-toast]");
      if (!toastEl) return;
      toastEl.classList.add("toast-expanded-tap");
      window.clearTimeout((toastEl as HTMLElement & { _collapseTimer?: number })._collapseTimer);
      (toastEl as HTMLElement & { _collapseTimer?: number })._collapseTimer = window.setTimeout(() => {
        toastEl.classList.remove("toast-expanded-tap");
      }, 3500);
    }
    document.addEventListener("click", handleTap);
    return () => document.removeEventListener("click", handleTap);
  }, [isMobile]);

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      // Mobile: topo da tela, longe dos botões "Cancelar/Confirmar" fixos no rodapé dos modais.
      // Desktop: mantém o canto inferior direito, comportamento já conhecido.
      position={isMobile ? "top-center" : "bottom-right"}
      icons={coloredIcons}
      className={isMobile ? "toaster group toaster-mobile-compact" : "toaster group"}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
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

