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
  ArrowDownCircle,
  ArrowUpCircle,
  Minus,
  Plus,
  Package,
  Barcode,
  ShoppingCart,
  Wrench,
  Tag,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import type { StockItem } from "@/hooks/useStock";
import { registerMovement } from "@/hooks/useStock";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Tipos de saída
const SAIDA_TYPES = [
  { value: "retirada", label: "Retirada", icon: Wrench },
  { value: "venda",    label: "Venda",    icon: ShoppingCart },
] as const;

// ─── Validação e formatação do lote ──────────────────────────────────────────
// Formato padrão:   DDMMAA-TT-NN   ex: 010126-01    (data-turno-numero)
// Formato com barra: DDMMAA-TT-NN/X  ex: 010126-01/A
const LOTE_REGEX = /^\d{6}-\d{2}([/][A-Za-z])?$/;

function formatLote(raw: string): string {
  // Remove tudo que não é dígito, hífen ou barra+letra
  let v = raw.toUpperCase().replace(/[^0-9\-/A-Z]/g, "");

  // Auto-insere hífen após 6 dígitos (data)
  if (/^\d{7,}/.test(v)) {
    v = v.slice(0, 6) + "-" + v.slice(6);
  }

  // Após o hífen, auto-insere outro hífen implicitamente (turno tem 2 dígitos)
  // Ex: 010126-01 → fica pronto; 010126-01/A → ok
  return v.slice(0, 12); // máx: 010126-01/A = 12 chars
}

function loteStatus(lote: string): "empty" | "valid" | "invalid" {
  if (!lote) return "empty";
  if (LOTE_REGEX.test(lote)) return "valid";
  return "invalid";
}

function loteHint(lote: string): string {
  if (!lote) return "Ex: 010126-01  ou  010126-01/A";
  const st = loteStatus(lote);
  if (st === "valid") return "Lote válido ✓";
  // Hints progressivos
  if (lote.length < 6) return "Digite os 6 dígitos da data (DDMMAA)";
  if (lote.length === 6 && !lote.includes("-")) return "Adicione o hífen após a data";
  if (/^\d{6}-\d$/.test(lote)) return "Digite os 2 dígitos do turno";
  if (/^\d{6}-\d{2}$/.test(lote)) return "Lote válido! Adicione /A, /B... se for continuação";
  if (/^\d{6}-\d{2}\//.test(lote)) return "Adicione a letra de continuação (A, B, C...)";
  return "Formato: DDMMAA-TT   ou   DDMMAA-TT/A";
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  item: StockItem | null;
  open: boolean;
  initialType?: "entrada" | "saida";
  onClose: () => void;
  onSuccess: () => void;
}

export function MovementModal({ item, open, initialType = "entrada", onClose, onSuccess }: Props) {
  const { user } = useAuth();
  const displayName: string | null =
    (user?.user_metadata?.display_name as string) ?? user?.email ?? null;

  const [type, setType]           = useState<"entrada" | "saida">(initialType);
  const [saidaType, setSaidaType] = useState<"retirada" | "venda">("retirada");
  const [qty, setQty]             = useState<number | "">(1);
  const [lote, setLote]           = useState("");
  const [reason, setReason]       = useState("");
  const [loading, setLoading]     = useState(false);
  const qtyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setType(initialType);
      setSaidaType("retirada");
      setQty(1);
      setLote("");
      setReason("");
      setTimeout(() => qtyRef.current?.select(), 80);
    }
  }, [open, initialType]);

  if (!item) return null;

  const d = item.device;
  const resolvedQty = qty === "" ? 0 : qty;
  const afterQty = type === "entrada" ? item.quantity + resolvedQty : item.quantity - resolvedQty;
  const loteOk = loteStatus(lote);

  function buildReason(): string {
    if (type === "saida") {
      const label = SAIDA_TYPES.find(t => t.value === saidaType)?.label ?? "";
      return reason.trim() ? `${label} — ${reason.trim()}` : label;
    }
    return reason.trim();
  }

  async function handleSubmit() {
    if (!item || resolvedQty < 1) return;
    // Lote obrigatório
    if (!lote.trim()) {
      toast.error("Informe o número do lote.");
      return;
    }
    if (loteOk === "invalid") {
      toast.error("Lote inválido. Use o formato DDMMAA-TT ou DDMMAA-TT/A");
      return;
    }
    setLoading(true);
    const result = await registerMovement(
      item.id, type, resolvedQty, buildReason(),
      user?.id ?? null, displayName, lote.trim().toUpperCase()
    );
    setLoading(false);
    if (result.ok) {
      toast.success(
        type === "entrada"
          ? `+${resolvedQty} un. adicionada${resolvedQty > 1 ? "s" : ""}`
          : `-${resolvedQty} un. retirada${resolvedQty > 1 ? "s" : ""}`,
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
      <DialogContent className="max-w-sm p-0 rounded-2xl overflow-hidden border-border/30">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-4">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
          <div className="relative">
            <DialogHeader>
              <DialogTitle className="text-sm font-semibold">Movimentar Estoque</DialogTitle>
            </DialogHeader>
            <div className="mt-3 rounded-xl bg-muted/20 border border-border/30 p-3 space-y-1">
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
          {/* Tipo: Entrada / Saída */}
          <div className="grid grid-cols-2 gap-2">
            {(["entrada", "saida"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setType(t)}
                className={cn(
                  "flex items-center justify-center gap-2 h-11 rounded-xl border text-sm font-medium transition-all",
                  type === t
                    ? t === "entrada"
                      ? "bg-success/10 border-success/40 text-success"
                      : "bg-destructive/10 border-destructive/40 text-destructive"
                    : "bg-background border-border text-muted-foreground hover:bg-muted/30"
                )}>
                {t === "entrada"
                  ? <ArrowDownCircle className="h-4 w-4" />
                  : <ArrowUpCircle className="h-4 w-4" />}
                {t === "entrada" ? "Entrada" : "Saída"}
              </button>
            ))}
          </div>

          {/* Sub-tipo de saída */}
          {type === "saida" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Tipo de saída
              </label>
              <div className="grid grid-cols-2 gap-2">
                {SAIDA_TYPES.map(({ value, label, icon: Icon }) => (
                  <button key={value} type="button" onClick={() => setSaidaType(value)}
                    className={cn(
                      "flex items-center justify-center gap-2 h-10 rounded-xl border text-[13px] font-medium transition-all",
                      saidaType === value
                        ? "bg-primary/10 border-primary/40 text-primary"
                        : "bg-background border-border text-muted-foreground hover:bg-muted/30"
                    )}>
                    <Icon className="h-3.5 w-3.5" />{label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Lote — campo obrigatório com validação visual */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Tag className="h-3 w-3" />
              Número do Lote <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Input
                placeholder="010126-01"
                value={lote}
                onChange={(e) => setLote(formatLote(e.target.value))}
                onFocus={() => { if (!lote) setLote(""); }}
                maxLength={12}
                className={cn(
                  "pr-8 h-11 rounded-xl font-mono text-sm tracking-widest uppercase transition-colors",
                  lote && loteOk === "valid"   && "border-success/50 bg-success/5 focus-visible:ring-success/30",
                  lote && loteOk === "invalid" && "border-destructive/50 bg-destructive/5 focus-visible:ring-destructive/30"
                )}
              />
              {/* Ícone de status */}
              {lote && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  {loteOk === "valid"
                    ? <CheckCircle2 className="h-4 w-4 text-success" />
                    : <XCircle className="h-4 w-4 text-destructive/60" />}
                </div>
              )}
            </div>
            <p className={cn(
              "text-[10px] leading-relaxed",
              loteOk === "valid"   ? "text-success" :
              loteOk === "invalid" ? "text-destructive/70" :
              "text-muted-foreground/60"
            )}>
              {loteHint(lote)}
            </p>
          </div>

          {/* Quantidade */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Quantidade
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
                  setQty(raw === "" ? "" : Math.max(1, parseInt(raw)));
                }}
                onFocus={() => setQty("")}
                onBlur={() => { if (qty === "") setQty(1); }}
                className="text-center h-10 text-base font-semibold rounded-xl"
              />
              <Button type="button" variant="outline" size="icon"
                className="h-10 w-10 shrink-0 rounded-xl"
                onClick={() => setQty((q) => (q === "" ? 1 : q) + 1)}>
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
              placeholder={type === "entrada" ? "Ex: NF 1234, fornecedor..." : "Ex: paciente, cirurgia..."}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              className="h-10 rounded-xl text-sm"
            />
          </div>

          {/* Preview do resultado */}
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
