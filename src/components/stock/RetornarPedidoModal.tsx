import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useConfirmEnter } from "@/hooks/useConfirmEnter";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Pedido } from "@/components/stock/pedidosEstoqueTypes";
import { RotateCcw } from "lucide-react";

interface RetornarPedidoModalProps {
  pedido: Pedido | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function RetornarPedidoModal({ pedido, onClose, onSuccess }: RetornarPedidoModalProps) {
  const { user } = useAuth();
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (pedido) setMotivo(""); }, [pedido]);
  useConfirmEnter(!!pedido, handleRetornar, saving);

  if (!pedido) return null;

  async function handleRetornar() {
    if (!pedido) return;
    setSaving(true);
    try {
      // Muda status para "retorno" — mantém reservas intactas
      const { error } = await supabase
        .from("pedidos_comerciais")
        .update({ status: "retorno", observacoes: motivo.trim() ? ("[RETORNO] " + motivo.trim()) : null })
        .eq("id", pedido.id);
      if (error) throw error;

      // Notifica a vendedora do pedido
      if (pedido.vendedora_id) {
        await supabase.from("notificacoes").insert({
          user_id: pedido.vendedora_id,
          pedido_id: pedido.id,
          tipo: "pedido_retornado",
          titulo: "Pedido retornado ao comercial",
          mensagem: `O pedido de ${pedido.cliente_nome} foi retornado pelo estoque para revisão.${motivo.trim() ? " Motivo: " + motivo.trim() : ""}`,
        });
      }

      toast.success("Pedido retornado ao comercial. Reservas mantidas.");
      onSuccess();
      onClose();
    } catch (_e) {
      toast.error("Erro ao retornar pedido.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 p-5 space-y-4 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-orange-500/10 flex items-center justify-center shrink-0">
            <RotateCcw className="h-4 w-4 text-orange-500" />
          </div>
          <div>
            <p className="text-sm font-semibold">Retornar ao Comercial?</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">{pedido.cliente_nome}</p>
          </div>
        </div>
        <div className="rounded-xl bg-orange-500/8 border border-orange-500/20 px-3 py-2.5 text-[12px] text-orange-700 dark:text-orange-400">
          As peças reservadas permanecem reservadas. O status ficará como <strong>Retorno</strong> até o comercial fazer as alterações.
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Motivo (opcional)</label>
          <textarea
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            placeholder="Ex: Quantidade errada, peça indisponível no lote..."
            rows={3}
            maxLength={500}
            className="w-full rounded-xl border border-border/50 bg-background text-sm px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/30"
          />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">Cancelar</button>
          <button type="button" onClick={handleRetornar} disabled={saving} className="flex-1 h-9 rounded-xl bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
            {saving ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Retornar
          </button>
        </div>
      </div>
    </div>
  );
}
