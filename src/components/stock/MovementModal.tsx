import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowDownCircle, ArrowUpCircle, Minus, Plus, Package,
  Barcode, Wrench, Tag, CheckCircle2, XCircle,
  ChevronDown,
} from "lucide-react";
import type { StockItem, LoteSummary } from "@/hooks/useStock";
import { registerMovement, fetchLotesSummary } from "@/hooks/useStock";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatLote, loteStatus } from "@/lib/lote";

// ─── Tipos de saída ────────────────────────────────────────────────────────────
const SAIDA_TYPES = [
  { value: "retirada", label: "Retirada", icon: Wrench },
] as const;


function loteHint(lote: string): string {
  if (!lote) return "Ex: 0101261-01  ou  0101261-01/A";
  if (loteStatus(lote) === "valid") return "Lote válido ✓";
  if (lote.length < 6) return "Digite a data: DDMMAA";
  if (lote.length === 6) return "Adicione a sequência do dia (ex: 1, 2...)";
  if (lote.length === 7 && !lote.includes("-")) return "Adicione o hífen após a sequência";
  if (/^\d{7}-\d$/.test(lote)) return "Digite os 2 dígitos do sublote";
  if (/^\d{7}-\d{2}$/.test(lote)) return "Lote válido! Adicione /A, /B... se for continuação";
  if (/^\d{7}-\d{2}\//.test(lote)) return "Adicione a letra de continuação (A, B, C...)";
  return "Formato: DDMMYYS-NN   ou   DDMMYYS-NN/A";
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  item: StockItem | null;
  open: boolean;
  initialType?: "entrada" | "saida";
  /** Quando definido, trava o modal neste tipo e oculta o seletor de tipo */
  lockedType?: "entrada" | "saida";
  onClose: () => void;
  onSuccess: () => void;
}

export function MovementModal({ item, open, initialType = "entrada", lockedType, onClose, onSuccess }: Props) {
  const { user } = useAuth();
  const displayName: string | null =
    (user?.user_metadata?.display_name as string) ?? user?.email ?? null;

  const [type, setType]           = useState<"entrada" | "saida">(initialType);
  const [saidaType, setSaidaType] = useState<"retirada">("retirada");
  const [qty, setQty]             = useState<number | "">(1);
  const [lote, setLote]           = useState("");
  const [reason, setReason]       = useState("");
  const [loading, setLoading]     = useState(false);
  const submittingRef             = useRef(false);

  // Lotes existentes para seleção na saída
  const [existingLotes, setExistingLotes] = useState<LoteSummary[]>([]);
  const [lotesLoading, setLotesLoading]   = useState(false);
  const [loteDropdownOpen, setLoteDropdownOpen] = useState(false);

  const qtyRef = useRef<HTMLInputElement>(null);

  // Carrega lotes existentes ao abrir (saida=só com saldo; entrada=todos para detectar duplicatas)
  useEffect(() => {
    let cancelled = false;
    if (open && item) {
      setLotesLoading(true);
      fetchLotesSummary(item.id).then((data) => {
        if (cancelled) return;
        setExistingLotes(type === "saida" ? data.filter((l) => l.saldo > 0) : data);
        setLotesLoading(false);
      }).catch(() => { if (!cancelled) setLotesLoading(false); });
    } else {
      setExistingLotes([]);
    }
    return () => { cancelled = true; };
  }, [open, item, type]);

  useEffect(() => {
    if (open) {
      setType(lockedType ?? initialType);
      setSaidaType("retirada");
      setQty(1);
      setLote("");
      setReason("");
      setLoteDropdownOpen(false);
      setTimeout(() => qtyRef.current?.select(), 80);
    }
  }, [open, initialType, lockedType]);

  if (!item) return null;

  const d = item.device;
  const resolvedQty = qty === "" ? 0 : qty;
  // Para saída: calcula sobre quantity_available (descontando reservados)
  // Para entrada: calcula sobre quantity total
  const afterQty = type === "entrada"
    ? item.quantity + resolvedQty
    : item.quantity_available - resolvedQty;
  const loteOk = loteStatus(lote);
  const isSaidaMode = type === "saida";

  function buildReason(): string {
    if (isSaidaMode) {
      const label = SAIDA_TYPES.find(t => t.value === saidaType)?.label ?? "";
      return reason.trim() ? `${label} — ${reason.trim()}` : label;
    }
    return reason.trim();
  }

  function selectExistingLote(l: LoteSummary) {
    setLote(l.lote);
    setLoteDropdownOpen(false);
    // Auto-fill qty with available saldo
    setQty(l.saldo);
    setTimeout(() => qtyRef.current?.select(), 50);
  }

  async function handleSubmit() {
    const safeQty = Math.trunc(resolvedQty);
    if (!item || safeQty < 1) return;
    if (!lote.trim()) { toast.error("Informe o número do lote."); return; }
    if (loteOk === "invalid") { toast.error("Lote inválido. Use o formato DDMMYYS-NN ou DDMMYYS-NN/A\nEx: 0101261-01 ou 0101261-01/A"); return; }
    if (submittingRef.current) return;
    submittingRef.current = true;

    setLoading(true);
    const result = await registerMovement(
      item.id, type, safeQty, buildReason(),
      user?.id ?? null, displayName, lote.trim().toUpperCase()
    );
    setLoading(false);
    submittingRef.current = false;
    if (result.ok) {
      toast.success(
        type === "entrada"
          ? `+${safeQty} un. adicionada${safeQty > 1 ? "s" : ""}`
          : `-${safeQty} un. retirada${safeQty > 1 ? "s" : ""}`,
        { description: `${d.model} · Lote ${lote.toUpperCase()}` }
      );
      onSuccess();
      onClose();
    } else {
      toast.error(result.error ?? "Erro ao registrar movimento.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm p-0 rounded-xl overflow-hidden border-border">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-4">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
          <div className="relative">
            <DialogHeader>
              <DialogTitle className="text-sm font-semibold">Movimentar Estoque</DialogTitle>
            </DialogHeader>
            <div className="mt-3 rounded-xl bg-muted/20 border border-border p-3 space-y-1">
              <p className="text-[13px] font-semibold leading-snug line-clamp-2">{d.model}</p>
              <p className="text-[11px] text-muted-foreground font-mono">{d.reference}</p>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground pt-0.5">
                <Barcode className="h-3 w-3" />{d.udi_di}
              </div>
              <div className="flex items-center gap-2 pt-0.5">
                <Package className="h-3.5 w-3.5 text-primary" />
                <span className="text-[12px] font-medium">
                  Estoque atual:{" "}
                  <span className={item.quantity <= item.min_quantity ? "text-destructive" : ""}>
                    {item.quantity} un.
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {/* Tipo: Entrada / Saída — só exibe quando não há travamento */}
          {!lockedType && (
          <div className="grid grid-cols-2 gap-2">
            {(["entrada", "saida"] as const).map((t) => (
              <button key={t} type="button" onClick={() => { setType(t); setLote(""); setLoteDropdownOpen(false); }}
                className={cn(
                  "flex items-center justify-center gap-2 h-11 rounded-xl border text-sm font-medium transition-all",
                  type === t
                    ? t === "entrada"
                      ? "bg-success/10 border-success/40 text-success"
                      : "bg-destructive/10 border-destructive/40 text-destructive"
                    : "bg-background border-border text-muted-foreground hover:bg-muted/30"
                )}>
                {t === "entrada" ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
                {t === "entrada" ? "Entrada" : "Saída"}
              </button>
            ))}
          </div>
          )}



          {/* ── LOTE ────────────────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Tag className="h-3 w-3" />
              {isSaidaMode ? "Selecionar Lote *" : "Número do Lote *"}
            </label>

            {/* SAÍDA: dropdown de lotes existentes com saldo */}
            {isSaidaMode ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setLoteDropdownOpen(!loteDropdownOpen)}
                  className={cn(
                    "w-full flex items-center justify-between h-11 px-3 rounded-xl border text-sm font-mono tracking-widest transition-colors",
                    lote
                      ? "border-success/50 bg-success/5 text-foreground"
                      : "border-border bg-background text-muted-foreground",
                    "hover:bg-muted/20"
                  )}
                >
                  <span className={lote ? "text-foreground font-semibold" : "text-muted-foreground text-xs font-sans tracking-normal"}>
                    {lote || (lotesLoading ? "Carregando lotes..." : existingLotes.length === 0 ? "Nenhum lote disponível" : "Selecione o lote...")}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {lote && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", loteDropdownOpen && "rotate-180")} />
                  </div>
                </button>

                {/* Dropdown list */}
                {loteDropdownOpen && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
                    {lotesLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                      </div>
                    ) : existingLotes.length === 0 ? (
                      <div className="px-3 py-3 text-[12px] text-muted-foreground text-center">
                        Nenhum lote com saldo disponível
                      </div>
                    ) : (
                      <div className="max-h-[180px] overflow-y-auto">
                        {existingLotes.map((l) => (
                          <button
                            key={l.lote}
                            type="button"
                            onClick={() => selectExistingLote(l)}
                            className={cn(
                              "w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-accent/50 transition-colors border-b border-border last:border-0",
                              lote === l.lote && "bg-success/10"
                            )}
                          >
                            <div>
                              <span className="text-[13px] font-mono font-bold text-foreground tracking-wider">
                                {l.lote}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 text-success">
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
            ) : (
              /* ENTRADA: campo livre com validação */
              <div className="relative">
                <Input
                  placeholder="0101261-01"
                  value={lote}
                  onChange={(e) => setLote(formatLote(e.target.value))}
                  maxLength={12}
                  className={cn(
                    "pr-8 h-11 rounded-xl font-mono text-sm tracking-widest uppercase transition-colors",
                    lote && loteOk === "valid"   && "border-success/50 bg-success/5",
                    lote && loteOk === "invalid" && "border-destructive/50 bg-destructive/5"
                  )}
                />
                {lote && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    {loteOk === "valid"
                      ? <CheckCircle2 className="h-4 w-4 text-success" />
                      : <XCircle className="h-4 w-4 text-destructive/60" />}
                  </div>
                )}
              </div>
            )}

            {/* Hint — só para entrada */}
            {!isSaidaMode && (
              <>
                <p className={cn(
                  "text-[10px] leading-relaxed",
                  loteOk === "valid"   ? "text-success" :
                  loteOk === "invalid" ? "text-destructive/70" :
                  "text-muted-foreground/60"
                )}>
                  {loteHint(lote)}
                </p>
                {loteOk === "valid" && existingLotes.some(l => l.lote === lote.toUpperCase()) && (
                  <p className="text-[10px] text-warning font-medium flex items-center gap-1">
                    ⚠️ Este lote já existe para este item. A entrada será somada ao lote existente.
                  </p>
                )}
              </>
            )}
          </div>

          {/* Quantidade */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Quantidade
              {isSaidaMode && lote && existingLotes.find(l => l.lote === lote) && (
                <span className="ml-1.5 text-success/70 normal-case">
                  (disponível: {existingLotes.find(l => l.lote === lote)?.saldo} un.)
                </span>
              )}
            </label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="icon"
                className="h-10 w-10 shrink-0 rounded-xl"
                onClick={() => setQty((q) => Math.max(1, (q === "" ? 1 : q) - 1))}>
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <Input
                ref={qtyRef}
                inputMode="numeric" pattern="[0-9]*"
                value={qty}
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, "");
                  setQty(raw === "" ? "" : Math.min(Math.max(1, parseInt(raw)), 999_999));
                }}
                onFocus={() => setQty("")}
                onBlur={() => { if (qty === "") setQty(1); }}
                className="text-center h-10 text-base font-semibold rounded-xl"
              />
              <Button type="button" variant="outline" size="icon"
                className="h-10 w-10 shrink-0 rounded-xl"
                onClick={() => setQty((q) => Math.min((q === "" ? 1 : q) + 1, 999_999))}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Observação livre */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Observação <span className="normal-case text-muted-foreground/50">(opcional)</span>
            </label>
            <Input
              placeholder={isSaidaMode ? "Ex: paciente, cirurgia..." : "Ex: NF 1234, fornecedor..."}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              className="h-10 rounded-xl text-sm"
            />
          </div>

          {/* Aviso de reservado */}
          {isSaidaMode && item.quantity_reserved > 0 && (
            <div className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs bg-warning/8 border border-warning/30 text-warning">
              <span className="font-semibold">{item.quantity_reserved} un. reservadas</span>
              <span className="opacity-70">— indisponíveis para retirada</span>
            </div>
          )}

          {/* Preview */}
          <div className={cn(
            "flex items-center justify-between rounded-xl px-4 py-2.5 text-sm border",
            afterQty < 0
              ? "bg-destructive/8 border-destructive/30 text-destructive"
              : afterQty <= item.min_quantity
              ? "bg-warning/8 border-warning/30 text-warning"
              : "bg-success/8 border-success/30 text-success"
          )}>
            <span className="text-xs font-medium opacity-70">Novo estoque</span>
            <span className="font-bold">
              {afterQty < 0 ? "Insuficiente" : `${afterQty} unidade${afterQty !== 1 ? "s" : ""}`}
            </span>
          </div>

          {/* Ações */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1 h-10 rounded-xl" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              className={cn(
                "flex-1 h-10 rounded-xl gap-2 font-semibold",
                type === "saida"
                  ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  : "bg-success hover:bg-success/90 text-success-foreground"
              )}
              onClick={handleSubmit}
              disabled={loading || resolvedQty < 1 || afterQty < 0 || !lote || loteOk === "invalid"}
            >
              {loading
                ? <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : type === "entrada"
                ? <ArrowDownCircle className="h-4 w-4" />
                : <ArrowUpCircle className="h-4 w-4" />}
              Confirmar {type === "entrada" ? "Entrada" : "Saída"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
