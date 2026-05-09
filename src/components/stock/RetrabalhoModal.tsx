import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Package, Tag, ChevronDown, CheckCircle2, Minus, Plus, Wrench,
} from "lucide-react";
import type { StockItem, LoteSummary } from "@/hooks/useStock";
import { fetchLotesSummary, transferToRetrabalho } from "@/hooks/useStock";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  item: StockItem | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function RetrabalhoModal({ item, open, onClose, onSuccess }: Props) {
  const { user } = useAuth();
  const displayName: string | null =
    (user?.user_metadata?.display_name as string) ?? user?.email ?? null;

  const [lote, setLote] = useState("");
  const [qty, setQty] = useState<number | "">(1);
  const [loading, setLoading] = useState(false);

  const [existingLotes, setExistingLotes] = useState<LoteSummary[]>([]);
  const [lotesLoading, setLotesLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (open && item) {
      setLotesLoading(true);
      fetchLotesSummary(item.id, item.fase).then((data) => {
        if (!cancelled) {
          setExistingLotes(data.filter((l) => l.saldo > 0));
          setLotesLoading(false);
        }
      }).catch(() => { if (!cancelled) setLotesLoading(false); });
    } else {
      setExistingLotes([]);
      setLote("");
      setQty(1);
      setDropdownOpen(false);
    }
    return () => { cancelled = true; };
  }, [open, item]);

  if (!item) return null;

  const d = item.device;
  const resolvedQty = qty === "" ? 0 : qty;
  const selectedLote = existingLotes.find((l) => l.lote === lote);
  const maxQty = selectedLote?.saldo ?? item.quantity;
  const afterExpedicaoQty = item.quantity - resolvedQty;

  function selectLote(l: LoteSummary) {
    setLote(l.lote);
    setQty(l.saldo);
    setDropdownOpen(false);
  }

  async function handleConfirm() {
    const safeQty = Math.trunc(resolvedQty);
    if (!item || safeQty < 1) return;
    if (!lote) { toast.error("Selecione o lote para retrabalho."); return; }
    if (afterExpedicaoQty < 0) { toast.error("Quantidade maior que o saldo disponível."); return; }

    setLoading(true);
    const result = await transferToRetrabalho(
      item.id,
      item.device_id,
      lote,
      safeQty,
      user?.id ?? null,
      displayName
    );
    setLoading(false);

    if (result.ok) {
      toast.success(`${safeQty} un. enviada${safeQty > 1 ? "s" : ""} para Retrabalho`, {
        description: `${d.model} · Lote ${lote} → Fila de Retrabalho`,
      });
      onSuccess();
      onClose();
    } else {
      toast.error(result.error ?? "Erro ao enviar para retrabalho.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm p-0 rounded-2xl overflow-hidden border-border/30">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-4">
          <div className="absolute inset-0 bg-gradient-to-b from-orange-500/5 to-transparent" />
          <div className="relative">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                <Wrench className="h-4 w-4 text-orange-500" />
                Enviar para Retrabalho
              </DialogTitle>
            </DialogHeader>
            <div className="mt-3 rounded-xl bg-muted/20 border border-border/30 p-3 space-y-1">
              <p className="text-[13px] font-semibold leading-snug line-clamp-2">{d.model}</p>
              <p className="text-[11px] text-muted-foreground font-mono">{d.reference}</p>
              <div className="flex items-center gap-2 pt-0.5">
                <Package className="h-3.5 w-3.5 text-primary" />
                <span className="text-[12px] font-medium">
                  Expedição:{" "}
                  <span className={item.quantity === 0 ? "text-destructive" : ""}>
                    {item.quantity} un.
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {/* Fluxo visual */}
          <div className="flex items-center justify-center gap-3 py-1">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success/10 border border-success/30">
              <Package className="h-3.5 w-3.5 text-success" />
              <span className="text-[11px] font-medium text-success">Expedição</span>
            </div>
            <ArrowLeft className="h-4 w-4 text-orange-500" />
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/30">
              <Wrench className="h-3.5 w-3.5 text-orange-500" />
              <span className="text-[11px] font-medium text-orange-500">Retrabalho</span>
            </div>
          </div>

          {/* Aviso */}
          <div className="rounded-xl bg-orange-500/8 border border-orange-500/25 px-3 py-2.5 text-[11px] text-orange-600 dark:text-orange-400">
            <strong>Retrabalho:</strong> As unidades ficam em fila de retrabalho. Após concluir, envie para Expedição pela aba Retrabalho.
          </div>

          {/* Seleção de lote */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Tag className="h-3 w-3" />
              Selecionar Lote *
            </label>

            <div className="relative">
              <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className={cn(
                  "w-full flex items-center justify-between h-11 px-3 rounded-xl border text-sm font-mono tracking-widest transition-colors",
                  lote
                    ? "border-orange-500/50 bg-orange-500/5 text-foreground"
                    : "border-border bg-background text-muted-foreground",
                  "hover:bg-muted/20"
                )}
              >
                <span className={lote ? "text-foreground font-semibold" : "text-muted-foreground text-xs font-sans tracking-normal"}>
                  {lote
                    || (lotesLoading
                      ? "Carregando lotes..."
                      : existingLotes.length === 0
                        ? "Nenhum lote com saldo disponível"
                        : "Selecione o lote...")}
                </span>
                <div className="flex items-center gap-1.5">
                  {lote && <CheckCircle2 className="h-3.5 w-3.5 text-orange-500" />}
                  <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", dropdownOpen && "rotate-180")} />
                </div>
              </button>

              {dropdownOpen && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
                  {lotesLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                    </div>
                  ) : existingLotes.length === 0 ? (
                    <div className="px-3 py-3 text-[12px] text-muted-foreground text-center">
                      Nenhum lote com saldo disponível na expedição
                    </div>
                  ) : (
                    <div className="max-h-[180px] overflow-y-auto">
                      {existingLotes.map((l) => (
                        <button
                          key={l.lote}
                          type="button"
                          onClick={() => selectLote(l)}
                          className={cn(
                            "w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-accent/50 transition-colors border-b border-border/30 last:border-0",
                            lote === l.lote && "bg-orange-500/10"
                          )}
                        >
                          <div>
                            <span className="text-[13px] font-mono font-bold text-foreground tracking-wider">
                              {l.lote}
                            </span>
                            <p className="text-[10px] text-muted-foreground">
                              Último mov.: {new Date(l.last_movement).toLocaleDateString("pt-BR")}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 text-orange-500">
                            <span className="text-[13px] font-bold tabular-nums">{l.saldo}</span>
                            <span className="text-[10px] opacity-70">un.</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Quantidade */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Quantidade para retrabalho
              {selectedLote && (
                <span className="ml-1.5 text-orange-500/70 normal-case">
                  (máx: {selectedLote.saldo} un.)
                </span>
              )}
            </label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-xl"
                onClick={() => setQty((q) => Math.max(1, (q === "" ? 1 : q) - 1))}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <Input
                inputMode="numeric"
                pattern="[0-9]*"
                value={qty}
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, "");
                  setQty(raw === "" ? "" : Math.min(Math.max(1, parseInt(raw)), maxQty));
                }}
                onFocus={() => setQty("")}
                onBlur={() => { if (qty === "") setQty(1); }}
                className="text-center h-10 text-base font-semibold rounded-xl"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-xl"
                onClick={() => setQty((q) => Math.min((q === "" ? 1 : q) + 1, maxQty))}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Preview */}
          {lote && resolvedQty > 0 && (
            <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 px-4 py-3 space-y-2">
              <p className="text-[11px] font-medium text-orange-500/70 uppercase tracking-wider">
                Resultado do retrabalho
              </p>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Package className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground text-[12px]">Expedição ficará com</span>
                </div>
                <span className={cn(
                  "font-bold text-[13px]",
                  afterExpedicaoQty < 0 ? "text-destructive" : "text-foreground"
                )}>
                  {afterExpedicaoQty < 0 ? "Insuficiente" : `${afterExpedicaoQty} un.`}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Wrench className="h-3.5 w-3.5 text-orange-500" />
                  <span className="text-muted-foreground text-[12px]">Retrabalho receberá</span>
                </div>
                <span className="font-bold text-[13px] text-orange-500">+{resolvedQty} un.</span>
              </div>
            </div>
          )}

          {/* Ações */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1 h-10 rounded-xl" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              className="flex-1 h-10 rounded-xl gap-2 font-semibold bg-orange-500 hover:bg-orange-600 text-white"
              onClick={handleConfirm}
              disabled={loading || resolvedQty < 1 || !lote || afterExpedicaoQty < 0}
            >
              {loading
                ? <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : <Wrench className="h-4 w-4" />}
              Enviar para Retrabalho
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
