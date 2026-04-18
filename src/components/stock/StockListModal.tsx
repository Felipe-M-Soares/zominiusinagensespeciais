import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StockItem } from "@/hooks/useStock";
import { Package, AlertTriangle, TrendingDown, CheckCircle2, List } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  items: StockItem[];
}

export function StockListModal({ open, onClose, items }: Props) {
  // Apenas itens com pelo menos 1 unidade, ordenados por nome
  const available = [...items]
    .filter((i) => i.quantity > 0)
    .sort((a, b) => a.device.model.localeCompare(b.device.model, "pt-BR"));

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md p-0 rounded-2xl overflow-hidden border-border/30">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-3">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
          <div className="relative">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                <List className="h-4 w-4 text-primary" />
                Peças em Estoque
              </DialogTitle>
            </DialogHeader>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {available.length} peça{available.length !== 1 ? "s" : ""} com unidades disponíveis
            </p>
          </div>
        </div>

        <div className="px-3 pb-4 max-h-[480px] overflow-y-auto space-y-1">
          {available.length === 0 && (
            <div className="text-center py-12 text-sm text-muted-foreground">
              Nenhuma peça com estoque disponível
            </div>
          )}

          {available.map((item) => {
            const isLow = item.quantity <= item.min_quantity;
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/20 transition-colors"
              >
                {/* Indicador de status */}
                {isLow
                  ? <TrendingDown className="h-3.5 w-3.5 text-warning shrink-0" />
                  : <CheckCircle2  className="h-3.5 w-3.5 text-success shrink-0" />}

                {/* Info da peça */}
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-foreground leading-snug line-clamp-1">
                    {item.device.model}
                  </p>
                  <p className="text-[10px] text-muted-foreground font-mono">{item.device.reference}</p>
                </div>

                {/* Quantidade */}
                <div className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-bold tabular-nums shrink-0",
                  isLow ? "bg-warning/10 text-warning" : "bg-success/10 text-success"
                )}>
                  <Package className="h-3 w-3" />
                  {item.quantity}
                  <span className="text-[10px] font-normal opacity-70">un.</span>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
