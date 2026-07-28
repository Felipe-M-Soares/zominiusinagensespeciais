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
  Tag,
  ScanBarcode,
  CheckCircle2,
  XCircle,
  PackagePlus,
  Minus,
  Plus,
  FileText,
  Mail,
  Package2,
  Tags,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { formatLote, loteStatus } from "@/lib/lote";

// Tipo de material de embalagem recebido. Sem coluna nova no banco: é
// gravado como um prefixo "[Tipo] " no início da descrição (mesma convenção
// de texto livre já usada em outras partes do app) e lido de volta em
// RecebimentoPanel para exibir badge/filtro.
export type TipoMaterial = "etiqueta" | "envelope" | "sache";
export const TIPO_MATERIAL_LABEL: Record<TipoMaterial, string> = {
  etiqueta: "Etiqueta", envelope: "Envelope", sache: "Sachê",
};
export const TIPO_MATERIAL_ICON: Record<TipoMaterial, typeof Tags> = {
  etiqueta: Tags, envelope: Mail, sache: Package2,
};
export function parseTipoMaterial(descricao: string): TipoMaterial | null {
  const m = descricao.match(/^\[(Etiqueta|Envelope|Sachê)\]\s*/);
  if (!m) return null;
  const map: Record<string, TipoMaterial> = { "Etiqueta": "etiqueta", "Envelope": "envelope", "Sachê": "sache" };
  return map[m[1]] ?? null;
}
export function stripTipoPrefix(descricao: string): string {
  return descricao.replace(/^\[(Etiqueta|Envelope|Sachê)\]\s*/, "");
}

function loteHint(lote: string): string {
  if (!lote) return "Ex: 0101261-01 (com turno) ou 010126-01 (peça de terceiro, sem turno)";
  if (loteStatus(lote) === "valid") return "Lote válido ✓";
  if (lote.length < 6) return "Digite a data: DDMMAA";
  if (lote.length === 6) return "Adicione o turno (1 dígito) ou já coloque o hífen se a peça não tem turno";
  if (lote.length === 7 && !lote.includes("-")) return "Adicione o hífen";
  if (/^\d{6,7}-\d$/.test(lote)) return "Digite os 2 dígitos do sublote";
  if (/^\d{6,7}-\d{2}$/.test(lote)) return "Lote válido! Adicione /A, /B... se for continuação";
  if (/^\d{6,7}-\d{2}\//.test(lote)) return "Adicione a letra de continuação (A, B, C...)";
  return "Formato: DDMMYYS-NN (com turno) ou DDMMYY-NN (sem turno)";
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function RecebimentoMaterialModal({ open, onClose, onSuccess }: Props) {
  const { user } = useAuth();
  const displayName: string | null =
    (user?.user_metadata?.display_name as string) ?? user?.email ?? null;

  const [lote, setLote] = useState("");
  const [qty, setQty] = useState<number | "">(1);
  const [tipo, setTipo] = useState<TipoMaterial | null>(null);
  const [descricao, setDescricao] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [loading, setLoading] = useState(false);

  const qtyRef = useRef<HTMLInputElement>(null);

  const loteOk = loteStatus(lote);
  const resolvedQty = qty === "" ? 0 : qty;

  useEffect(() => {
    if (open) {
      setLote("");
      setQty(1);
      setTipo(null);
      setDescricao("");
      setFornecedor("");
      setTimeout(() => qtyRef.current?.focus(), 80);
    }
  }, [open]);

  async function handleSubmit() {
    const safeQty = Math.trunc(resolvedQty);
    if (safeQty < 1) { toast.error("Quantidade deve ser maior que zero."); return; }
    if (!lote.trim()) { toast.error("Informe o número do lote."); return; }
    if (loteOk === "invalid") { toast.error("Lote inválido. Use DDMMYYS-NN (com turno) ou DDMMYY-NN (sem turno, peça de terceiro).\nEx: 0101261-01 ou 010126-01"); return; }
    if (!tipo) { toast.error("Selecione o tipo de material: etiqueta, envelope ou sachê."); return; }
    if (!descricao.trim()) { toast.error("Descreva o material recebido."); return; }

    const descricaoFinal = `[${TIPO_MATERIAL_LABEL[tipo]}] ${descricao.trim()}`;

    setLoading(true);
    const { error } = await supabase.from("recebimento_materiais").insert({
      lote: lote.trim().toUpperCase(),
      quantity: safeQty,
      descricao: descricaoFinal,
      fornecedor: fornecedor.trim() || null,
      user_id: user?.id ?? null,
      user_display_name: displayName,
      status: "ativo",
    });
    setLoading(false);

    if (error) {
      toast.error("Erro ao registrar recebimento. Tente novamente.");
    } else {
      toast.success(`Recebimento registrado — ${safeQty} un.`, {
        description: `Lote ${lote.toUpperCase()} · ${descricaoFinal}`,
      });
      onSuccess();
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm p-0 rounded-2xl overflow-hidden border-border/30">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-4">
          <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 to-transparent" />
          <div className="relative">
            <DialogHeader>
              <DialogTitle className="text-sm font-semibold flex items-center gap-2">
                <PackagePlus className="h-4 w-4 text-cyan-500" />
                Registrar Recebimento
              </DialogTitle>
            </DialogHeader>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Registre a chegada de material com lote, tipo, quantidade e descrição.
            </p>
          </div>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {/* Lote */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Tag className="h-3 w-3" />
              Número do Lote *
              <span className="ml-auto flex items-center gap-1 text-[10px] font-normal text-muted-foreground/60 normal-case"><ScanBarcode className="h-2.5 w-2.5" /> Bipe o código de barras</span>
            </label>
            <div className="relative">
              <Input
                autoFocus
                placeholder="0101261-01"
                value={lote}
                onChange={(e) => setLote(formatLote(e.target.value))}
                maxLength={13}
                className={cn(
                  "pr-8 h-11 rounded-xl font-mono text-sm tracking-widest uppercase transition-colors",
                  lote && loteOk === "valid" && "border-success/50 bg-success/5",
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
            <p className={cn(
              "text-[10px] leading-relaxed",
              loteOk === "valid" ? "text-success" :
              loteOk === "invalid" ? "text-destructive/70" :
              "text-muted-foreground/60"
            )}>
              {loteHint(lote)}
            </p>
          </div>

          {/* Tipo de material */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Tipo de Material *
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(TIPO_MATERIAL_LABEL) as TipoMaterial[]).map((t) => {
                const Icon = TIPO_MATERIAL_ICON[t];
                const active = tipo === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTipo(t)}
                    className={cn(
                      "flex flex-col items-center justify-center gap-1 h-16 rounded-xl border-2 text-[11px] font-semibold transition-all",
                      active ? "border-cyan-500 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400" : "border-border/50 text-muted-foreground hover:border-border hover:bg-muted/20"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {TIPO_MATERIAL_LABEL[t]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quantidade */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Quantidade *
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

          {/* Descrição */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <FileText className="h-3 w-3" />
              Descrição do Material *
            </label>
            <Input
              placeholder="Ex: térmica 40x60mm, kraft A5, sílica 5g..."
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="h-11 rounded-xl text-sm"
              maxLength={300}
            />
          </div>

          {/* Fornecedor */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Fornecedor <span className="normal-case text-muted-foreground/50">(opcional)</span>
            </label>
            <Input
              placeholder="Ex: Distribuidor ABC, NF 5678..."
              value={fornecedor}
              onChange={(e) => setFornecedor(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              className="h-10 rounded-xl text-sm"
              maxLength={200}
            />
          </div>

          {/* Ações */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1 h-10 rounded-xl" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              className="flex-1 h-10 rounded-xl gap-2 font-semibold bg-cyan-600 hover:bg-cyan-700 text-white"
              onClick={handleSubmit}
              disabled={loading || resolvedQty < 1 || !lote || loteOk === "invalid" || !tipo || !descricao.trim()}
            >
              {loading
                ? <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : <PackagePlus className="h-4 w-4" />}
              Registrar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
