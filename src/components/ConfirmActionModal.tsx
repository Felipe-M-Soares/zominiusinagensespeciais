/**
 * ConfirmActionModal — Modal de confirmação com resumo para ações críticas
 *
 * Exibe um resumo do impacto antes de confirmar ações destrutivas ou
 * financeiramente relevantes (cancelamento de pedido, saída de estoque grande).
 *
 * Uso:
 *   <ConfirmActionModal
 *     open={confirming}
 *     title="Cancelar pedido?"
 *     description="Esta ação não pode ser desfeita."
 *     items={[
 *       { label: "Pedido", value: "#ABC123" },
 *       { label: "Valor", value: "R$ 4.800,00", highlight: true },
 *       { label: "Peças", value: "12 unidades" },
 *     ]}
 *     consequence="Devolve a reserva ao estoque de expedição."
 *     confirmLabel="Cancelar pedido"
 *     confirmVariant="destructive"
 *     onConfirm={handleCancel}
 *     onCancel={() => setConfirming(false)}
 *   />
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ConfirmItem {
  label: string;
  value: string;
  highlight?: boolean; // destaca em vermelho/âmbar
}

interface Props {
  open: boolean;
  title: string;
  description?: string;
  items?: ConfirmItem[];
  consequence?: string;
  confirmLabel?: string;
  confirmVariant?: "destructive" | "default";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmActionModal({
  open,
  title,
  description,
  items = [],
  consequence,
  confirmLabel = "Confirmar",
  confirmVariant = "destructive",
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <div className={cn(
              "h-9 w-9 rounded-full flex items-center justify-center shrink-0",
              confirmVariant === "destructive"
                ? "bg-destructive/10"
                : "bg-primary/10"
            )}>
              {confirmVariant === "destructive"
                ? <AlertTriangle className="h-4 w-4 text-destructive" />
                : <Info className="h-4 w-4 text-primary" />
              }
            </div>
            <div>
              <AlertDialogTitle className="text-base">{title}</AlertDialogTitle>
              {description && (
                <AlertDialogDescription className="mt-1 text-xs">
                  {description}
                </AlertDialogDescription>
              )}
            </div>
          </div>
        </AlertDialogHeader>

        {items.length > 0 && (
          <div className="rounded-lg border border-border/50 bg-muted/30 divide-y divide-border/30 my-2">
            {items.map((item) => (
              <div key={item.label} className="flex justify-between items-center px-3 py-2">
                <span className="text-xs text-muted-foreground">{item.label}</span>
                <span className={cn(
                  "text-xs font-semibold",
                  item.highlight ? "text-destructive" : "text-foreground"
                )}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {consequence && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
            → {consequence}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={loading}>
            Voltar
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              confirmVariant === "destructive" && "bg-destructive hover:bg-destructive/90"
            )}
          >
            {loading ? "Processando..." : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
