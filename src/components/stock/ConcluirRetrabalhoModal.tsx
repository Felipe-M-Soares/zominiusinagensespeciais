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
  ArrowRight, Package, Tag, ChevronDown, CheckCircle2, Minus, Plus, Wrench, Truck,
} from "lucide-react";
import type { StockItem, LoteSummary } from "@/hooks/useStock";
import { fetchLotesSummary, transferRetrabalhoToExpedicao } from "@/hooks/useStock";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  item: StockItem | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ConcluirRetrabalhoModal({ item, open, onClose, onSuccess }: Props) {
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
          const lotesComSaldo = data.filter((l) => l.saldo > 0);
          // Sem fallback de lote vazio — peças sem lote numerado não podem ser movimentadas.
          // O usuário deve primeiro registrar uma entrada com lote válido (DDMMYYS-NN).
          setExistingLotes(lotesComSaldo);
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
  const afterRetrabalhoQty = item.quantity - resolvedQty;

  function selectLote(l: LoteSummary) {
    setLote(l.lote);
    setQty(l.saldo);
    setDropdownOpen(false);
  }

  async function handleConfirm() {
    const safeQty = Math.trunc(resolvedQty);
    if (!item || safeQty < 1) return;
    if (!lote) { toast.error("Selecione o lote a concluir."); return; }
    const LOTE_INVALIDO = new Set(["sem lote", "a-definir", "a definir"]);
    if (LOTE_INVALIDO.has(lote.trim().toLowerCase())) {
      toast.error("Lote sem numeração não é permitido. Registre uma entrada com lote válido (ex: 0101261-01) antes de concluir.");
      return;
    }
    if (afterRetrabalhoQty < 0) { toast.error("Quantidade maior que o saldo disponível."); return; }

    setLoading(true);
    const result = await transferRetrabalhoToExpedicao(
      item.id,
      item.device_id,
      lote,
      safeQty,
      user?.id ?? null,
      displayName
    );
    setLoading(false);

    if (result.ok) {
      toast.success(`${safeQty} un. concluída${safeQty > 1 ? "s" : ""} → Expedição`, {
        description: `${d.model} · Lote ${lote}`,
      });
      onSuccess();
      onClose();
    } else {
      toast.error(result.error ?? "Erro ao concluir retrabalho.");
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
                Concluir Retrabalho
              </DialogTitle>
            </DialogHeader>
            <div className="mt-3 rounded-xl bg-muted/20 border border-border/30 p-3 space-y-1">
              <p className="text-[13px] font-semibold leading-snug line-clamp-2">{d.model}</p>
              <p className="text-[11px] text-muted-foreground font-mono">{d.reference}</p>
              <div className="flex items-center gap-2 pt-0.5">
                <Wrench className="h-3.5 w-3.5 text-orange-500" />
                <span className="text-[12px] font-medium">
                  Retrabalho:{" "}
                  <span className={item.quantity === 0 ? "text-destructive" : "text-orange-500"}>
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
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/30">
              <Wrench className="h-3.5 w-3.5 text-orange-500" />
              <span className="text-[11px] font-medium text-orange-500">Retrabalho</span>
            </div>
            <ArrowRight className="h-4 w-4 text-success" />
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success/10 border border-success/30">
              <Truck className="h-3.5 w-3.5 text-success" />
              <span className="text-[11px] font-medium text-success">Expedição</span>
            </div>
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
                      Sem lote numerado no retrabalho.
Registre uma entrada com lote (DDMMYYS-NN) antes de concluir.
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
              Quantidade concluída
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
            <div className="rounded-xl border border-success/20 bg-success/5 px-4 py-3 space-y-2">
              <p className="text-[11px] font-medium text-success/70 uppercase tracking-wider">
                Resultado
              </p>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground text-[12px]">Retrabalho ficará com</span>
                </div>
                <span className={cn(
                  "font-bold text-[13px]",
                  afterRetrabalhoQty < 0 ? "text-destructive" : "text-foreground"
                )}>
                  {afterRetrabalhoQty < 0 ? "Insuficiente" : `${afterRetrabalhoQty} un.`}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Package className="h-3.5 w-3.5 text-success" />
                  <span className="text-muted-foreground text-[12px]">Expedição receberá</span>
                </div>
                <span className="font-bold text-[13px] text-success">+{resolvedQty} un.</span>
              </div>
            </div>
          )}

          {/* Ações */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1 h-10 rounded-xl" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              className="flex-1 h-10 rounded-xl gap-2 font-semibold bg-success hover:bg-success/90 text-success-foreground"
              onClick={handleConfirm}
              disabled={loading || resolvedQty < 1 || !lote || afterRetrabalhoQty < 0}
            >
              {loading
                ? <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : <Truck className="h-4 w-4" />}
              Enviar para Expedição
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
