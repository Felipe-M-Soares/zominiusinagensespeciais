import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useConfirmEnter } from "@/hooks/useConfirmEnter";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Pedido, PedidoItem } from "@/components/stock/pedidosEstoqueTypes";
import { Trash2 } from "lucide-react";

interface RemoverItemModalProps {
  pedido: Pedido | null;
  item: PedidoItem | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function RemoverItemModal({ pedido, item, onClose, onSuccess }: RemoverItemModalProps) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  useConfirmEnter(!!(pedido && item), handleRemover, saving);

  if (!pedido || !item) return null;

  async function handleRemover() {
    if (!pedido || !item) return;
    setSaving(true);
    try {
      // RPC atômica por item — libera a reserva e, se a peça já tinha sido
      // separada pro embarque (lotes_separados), devolve a quantidade física
      // pra expedição também (não só release_item_reservation, que só
      // cuidava da reserva e deixava a parte já separada "perdida").
      for (const id of item.ids) {
        const { data, error } = await supabase.rpc("remove_pedido_item", { p_pedido_item_id: id });
        const result = data as { ok?: boolean; error?: string } | null;
        if (error || result?.ok === false) throw new Error(result?.error ?? error?.message ?? "Erro ao remover item.");
      }

      // Calcula novo total do pedido para notificação
      const { data: itensRestantes } = await supabase
        .from("pedido_itens")
        .select("quantidade, preco_unitario")
        .eq("pedido_id", pedido.id);

      const novoTotal = (itensRestantes ?? []).reduce((s: number, i: { quantidade: number; preco_unitario: number | null }) => {
        return s + (i.quantidade * (i.preco_unitario ?? 0));
      }, 0);

      const descontoLabel = (pedido.desconto_pct ?? 0) > 0 ? ` (com ${pedido.desconto_pct}% desc.)` : "";
      const totalFmt = novoTotal > 0
        ? "R$ " + (novoTotal * (1 - (pedido.desconto_pct ?? 0) / 100)).toFixed(2).replace(".", ",")
        : null;

      // Notifica vendedora
      if (pedido.vendedora_id) {
        await supabase.from("notificacoes").insert({
          user_id: pedido.vendedora_id,
          pedido_id: pedido.id,
          tipo: "peca_removida",
          titulo: "Peça removida do pedido pelo estoque",
          mensagem: `A peça "${item.device_model}" (${item.quantidade} un.) foi removida do pedido de ${pedido.cliente_nome} pelo estoque.${totalFmt ? ` Novo valor do pedido: ${totalFmt}${descontoLabel}.` : ""}`,
        });
      }

      toast.success(`${item.device_model} removida do pedido.`);
      onSuccess();
      onClose();
    } catch (_e) {
      toast.error("Erro ao remover peça.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 p-5 space-y-4 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
            <Trash2 className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <p className="text-sm font-semibold">Remover peça do pedido?</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">{pedido.cliente_nome}</p>
          </div>
        </div>
        <div className="rounded-xl bg-muted/20 border border-border/20 px-3 py-2.5 space-y-1">
          <p className="text-[12px] font-semibold">{item.device_model}</p>
          <p className="text-[11px] text-muted-foreground font-mono">{item.device_reference}</p>
          <p className="text-[11px] text-muted-foreground">{item.quantidade} un. serão liberadas da reserva</p>
        </div>
        <div className="rounded-xl bg-amber-500/8 border border-amber-500/20 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
          O comercial será notificado automaticamente com o novo valor do pedido.
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">Cancelar</button>
          <button type="button" onClick={handleRemover} disabled={saving} className="flex-1 h-9 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
            {saving ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Remover peça
          </button>
        </div>
      </div>
    </div>
  );
}
