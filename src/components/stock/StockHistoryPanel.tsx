import { useStockMovements } from "@/hooks/useStock";
import type { StockItem } from "@/hooks/useStock";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowDownCircle, ArrowUpCircle, Clock } from "lucide-react";

interface Props {
  item: StockItem | null;
  open: boolean;
  onClose: () => void;
}

export function StockHistoryPanel({ item, open, onClose }: Props) {
  const { movements, loading } = useStockMovements(open && item ? item.id : null);

  if (!item) return null;

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm p-0 rounded-2xl overflow-hidden border-border/30">
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

        <div className="px-3 pb-5 max-h-[400px] overflow-y-auto space-y-1.5">
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
              className={`flex items-start gap-3 p-3 rounded-xl border ${
                mv.type === "entrada"
                  ? "bg-success/5 border-success/20"
                  : "bg-destructive/5 border-destructive/20"
              }`}
            >
              {mv.type === "entrada" ? (
                <ArrowDownCircle className="h-4 w-4 mt-0.5 text-success shrink-0" />
              ) : (
                <ArrowUpCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[12px] font-semibold ${mv.type === "entrada" ? "text-success" : "text-destructive"}`}>
                    {mv.type === "entrada" ? "+" : "-"}{mv.quantity} un.
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{fmtDate(mv.created_at)}</span>
                </div>
                {mv.reason && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{mv.reason}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
