import { useState } from "react";
import { useStockMovements } from "@/hooks/useStock";
import { cancelMovement } from "@/hooks/useStock";
import type { StockItem, StockMovement } from "@/hooks/useStock";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowDownCircle, ArrowUpCircle, Clock, Trash2, AlertTriangle, User, Tag } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  item: StockItem | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void; // recarrega o estoque após cancelamento
}

export function StockHistoryPanel({ item, open, onClose, onSuccess }: Props) {
  const { movements, loading, refetch } = useStockMovements(open && item ? item.id : null, item?.fase);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  if (!item) return null;

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  }

  async function handleCancel(mv: StockMovement) {
    setCancelling(mv.id);
    const result = await cancelMovement(mv.id, mv.stock_item_id);
    setCancelling(null);
    setConfirmId(null);
    if (result.ok) {
      toast.success("Movimento cancelado e estoque revertido.");
      refetch();
      onSuccess(); // atualiza os cards
    } else {
      toast.error(result.error ?? "Erro ao cancelar movimento.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setConfirmId(null); onClose(); } }}>
      <DialogContent className="max-w-sm p-0 rounded-2xl overflow-hidden border-border/30">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-3">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
          <div className="relative">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                <Clock className="h-4 w-4 text-primary" />
                Histórico de Movimentos
              </DialogTitle>
            </DialogHeader>
            <p className="text-[12px] text-muted-foreground mt-1 line-clamp-1">{item.device.model}</p>
          </div>
        </div>

        <div className="px-3 pb-5 max-h-[420px] overflow-y-auto space-y-1.5">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          )}

          {!loading && movements.length === 0 && (
            <div className="text-center py-10 text-sm text-muted-foreground">
              Nenhum movimento registrado
            </div>
          )}

          {movements.map((mv) => (
            <div
              key={mv.id}
              className={cn(
                "rounded-xl border transition-all",
                mv.type === "entrada"
                  ? "bg-success/5 border-success/20"
                  : "bg-destructive/5 border-destructive/20"
              )}
            >
              {/* Linha principal */}
              <div className="flex items-start gap-3 p-3">
                {mv.type === "entrada"
                  ? <ArrowDownCircle className="h-4 w-4 mt-0.5 text-success shrink-0" />
                  : <ArrowUpCircle   className="h-4 w-4 mt-0.5 text-destructive shrink-0" />}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn(
                      "text-[12px] font-semibold",
                      mv.type === "entrada" ? "text-success" : "text-destructive"
                    )}>
                      {mv.type === "entrada" ? "+" : "-"}{mv.quantity} un.
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{fmtDate(mv.created_at)}</span>
                  </div>
                  {mv.lote && (
                    <p className="flex items-center gap-1 text-[11px] font-mono font-semibold text-primary/80 mt-0.5">
                      <Tag className="h-2.5 w-2.5" />Lote {mv.lote}
                    </p>
                  )}
                  {mv.reason && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{mv.reason}</p>
                  )}
                  {mv.user_display_name && (
                    <p className="flex items-center gap-1 text-[10px] text-muted-foreground/50 mt-0.5">
                      <User className="h-2.5 w-2.5" />{mv.user_display_name}
                    </p>
                  )}
                </div>

                {/* Botão cancelar movimento */}
                <button
                  type="button"
                  title="Cancelar este movimento"
                  onClick={() => setConfirmId(confirmId === mv.id ? null : mv.id)}
                  className="h-6 w-6 flex items-center justify-center rounded-lg text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>

              {/* Confirmação inline */}
              {confirmId === mv.id && (
                <div className="px-3 pb-3 space-y-2 border-t border-destructive/15 pt-2">
                  <div className="flex items-start gap-2 text-[11px] text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                      Isso cancelará {mv.type === "entrada" ? "a entrada" : "a saída"} de{" "}
                      <strong>{mv.quantity} un.</strong> e reverterá o estoque.
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-7 text-[11px] rounded-lg"
                      onClick={() => setConfirmId(null)}
                    >
                      Não
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 h-7 text-[11px] rounded-lg bg-destructive hover:bg-destructive/90 text-destructive-foreground gap-1"
                      onClick={() => handleCancel(mv)}
                      disabled={cancelling === mv.id}
                    >
                      {cancelling === mv.id
                        ? <div className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        : <Trash2 className="h-3 w-3" />}
                      Cancelar movimento
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
