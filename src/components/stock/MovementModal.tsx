import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Minus,
  Plus,
  Package,
  Barcode,
} from "lucide-react";
import type { StockItem } from "@/hooks/useStock";
import { registerMovement } from "@/hooks/useStock";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface Props {
  item: StockItem | null;
  open: boolean;
  initialType?: "entrada" | "saida";
  onClose: () => void;
  onSuccess: () => void;
}

export function MovementModal({ item, open, initialType = "entrada", onClose, onSuccess }: Props) {
  const { user } = useAuth();
  const [type, setType] = useState<"entrada" | "saida">("entrada");
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const qtyRef = useRef<HTMLInputElement>(null);

  // Reseta ao abrir, respeitando initialType vindo do botão clicado
  useEffect(() => {
    if (open) {
      setType(initialType);
      setQty(1);
      setReason("");
      setTimeout(() => qtyRef.current?.select(), 100);
    }
  }, [open]);

  if (!item) return null;

  const d = item.device;
  const afterQty =
    type === "entrada" ? item.quantity + qty : item.quantity - qty;

  async function handleSubmit() {
    if (!item || qty < 1) return;
    setLoading(true);
    const result = await registerMovement(
      item.id,
      type,
      qty,
      reason,
      user?.id ?? null
    );
    setLoading(false);
    if (result.ok) {
      toast.success(
        type === "entrada"
          ? `+${qty} unidade${qty > 1 ? "s" : ""} adicionada${qty > 1 ? "s" : ""}`
          : `-${qty} unidade${qty > 1 ? "s" : ""} retirada${qty > 1 ? "s" : ""}`,
        { description: d.model }
      );
      onSuccess();
      onClose();
    } else {
      toast.error(result.error ?? "Erro ao registrar movimento.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm p-0 rounded-2xl overflow-hidden border-border/30">
        {/* Header com gradiente */}
        <div className="relative px-5 pt-5 pb-4">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
          <div className="relative">
            <DialogHeader>
              <DialogTitle className="text-sm font-semibold leading-snug">
                Movimentar Estoque
              </DialogTitle>
            </DialogHeader>
            {/* Info do dispositivo */}
            <div className="mt-3 rounded-xl bg-muted/20 border border-border/30 p-3 space-y-1">
              <p className="text-[13px] font-semibold leading-snug text-foreground line-clamp-2">
                {d.model}
              </p>
              <p className="text-[11px] text-muted-foreground font-mono">{d.reference}</p>
              <div className="flex items-center gap-2 pt-1">
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Barcode className="h-3 w-3" />
                  {d.udi_di}
                </span>
              </div>
              <div className="flex items-center gap-2 pt-0.5">
                <Package className="h-3.5 w-3.5 text-primary" />
                <span className="text-[12px] font-medium">
                  Estoque atual:{" "}
                  <span className={item.quantity <= item.min_quantity ? "text-destructive" : "text-foreground"}>
                    {item.quantity} un.
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {/* Seletor de tipo */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType("entrada")}
              className={`flex items-center justify-center gap-2 h-11 rounded-xl border text-sm font-medium transition-all ${
                type === "entrada"
                  ? "bg-success/10 border-success/40 text-success"
                  : "bg-background border-border text-muted-foreground hover:bg-muted/30"
              }`}
            >
              <ArrowDownCircle className="h-4 w-4" />
              Entrada
            </button>
            <button
              type="button"
              onClick={() => setType("saida")}
              className={`flex items-center justify-center gap-2 h-11 rounded-xl border text-sm font-medium transition-all ${
                type === "saida"
                  ? "bg-destructive/10 border-destructive/40 text-destructive"
                  : "bg-background border-border text-muted-foreground hover:bg-muted/30"
              }`}
            >
              <ArrowUpCircle className="h-4 w-4" />
              Saída
            </button>
          </div>

          {/* Quantidade */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Quantidade
            </label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-xl"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <Input
                ref={qtyRef}
                type="number"
                min={1}
                value={qty}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  if (!isNaN(v) && v >= 1) setQty(v);
                }}
                onFocus={(e) => e.target.select()}
                className="text-center h-10 text-base font-semibold rounded-xl"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-xl"
                onClick={() => setQty((q) => q + 1)}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Motivo */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Motivo <span className="normal-case text-muted-foreground/50">(opcional)</span>
            </label>
            <Input
              placeholder={
                type === "entrada" ? "Ex: Recebimento NF 1234" : "Ex: Uso em cirurgia"
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              className="h-10 rounded-xl text-sm"
            />
          </div>

          {/* Preview do resultado */}
          <div
            className={`flex items-center justify-between rounded-xl px-4 py-2.5 text-sm border ${
              afterQty < 0
                ? "bg-destructive/8 border-destructive/30 text-destructive"
                : afterQty <= item.min_quantity
                ? "bg-warning/8 border-warning/30 text-warning"
                : "bg-success/8 border-success/30 text-success"
            }`}
          >
            <span className="text-xs font-medium opacity-70">Novo estoque</span>
            <span className="font-bold">
              {afterQty < 0 ? "Insuficiente" : `${afterQty} unidade${afterQty !== 1 ? "s" : ""}`}
            </span>
          </div>

          {/* Ações */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1 h-10 rounded-xl"
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button
              className={`flex-1 h-10 rounded-xl gap-2 font-semibold ${
                type === "saida"
                  ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  : "bg-success hover:bg-success/90 text-success-foreground"
              }`}
              onClick={handleSubmit}
              disabled={loading || afterQty < 0}
            >
              {loading ? (
                <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : type === "entrada" ? (
                <ArrowDownCircle className="h-4 w-4" />
              ) : (
                <ArrowUpCircle className="h-4 w-4" />
              )}
              Confirmar {type === "entrada" ? "Entrada" : "Saída"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
