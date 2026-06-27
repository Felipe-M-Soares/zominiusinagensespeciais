import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import type { PedidoCompleto } from "@/types/comercial";

interface FaturarModalProps {
  pedido: PedidoCompleto | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function FaturarModal({ pedido, onClose, onSuccess }: FaturarModalProps) {
  const [saving, setSaving] = useState(false);

  if (!pedido) return null;

  async function handleConfirmar() {
    if (!pedido) return;
    setSaving(true);
    try {
      // Apenas muda o status — a reserva já foi feita quando o pedido foi criado.
      // Chamar reserve_stock aqui causaria reserva dupla, inflando quantity_reserved
      // e fazendo quantity_available ficar negativo ou zerar todo o estoque ao marcar pronto.
      const { error } = await supabase
        .from("pedidos_comerciais")
        .update({ status: "separando" })
        .eq("id", pedido.id);
      if (error) throw error;

      toast.success("Pedido confirmado! Encaminhado para separação.");
      onSuccess();
    } catch (_e) {
      toast.error("Erro ao confirmar pedido.");
    } finally {
      setSaving(false);
    }
  }

  const total = pedido.itens.reduce((s, i) => s + i.quantidade, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 p-5 space-y-4 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-4 w-4 text-violet-500" />
          </div>
          <div>
            <p className="text-sm font-semibold">Confirmar Pedido?</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">{pedido.cliente_nome}</p>
          </div>
        </div>
        <div className="rounded-xl bg-muted/20 border border-border/30 px-3 py-2.5 space-y-1">
          <p className="text-[12px] text-muted-foreground">
            <strong className="text-foreground">{total} unidade{total !== 1 ? "s" : ""}</strong> serão encaminhadas ao estoque para separação.
          </p>
          <p className="text-[11px] text-muted-foreground/70">As peças já estão reservadas. O estoque irá separar os lotes e confirmar o envio.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">Cancelar</button>
          <button type="button" onClick={handleConfirmar} disabled={saving} className="flex-1 h-9 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-500 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
            {saving ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Confirmar Pedido
          </button>
        </div>
      </div>
    </div>
  );
}
