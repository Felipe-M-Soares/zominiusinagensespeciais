import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/format";
import { toast } from "sonner";
import { totalPedido, type PedidoCompleto } from "@/types/comercial";

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
  const valor = totalPedido(pedido);

  return (
    <Dialog open onOpenChange={v => !v && !saving && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-primary" />Confirmar pedido?</DialogTitle>
          <DialogDescription className="truncate">{pedido.cliente_nome} · {formatBRL(valor)}</DialogDescription>
        </DialogHeader>
        <div className="rounded-xl bg-muted/40 border px-3 py-2.5 space-y-1 text-sm">
          <p><strong>{total} unidade{total !== 1 ? "s" : ""}</strong> serão encaminhadas ao estoque para separação.</p>
          <p className="text-xs text-muted-foreground">As peças já estão reservadas. Depois de confirmado, o pedido não pode mais ser editado por aqui.</p>
        </div>
        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" className="flex-1 h-11" onClick={onClose} disabled={saving}>Voltar</Button>
          <Button className="flex-1 h-11 gap-1.5" onClick={handleConfirmar} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
