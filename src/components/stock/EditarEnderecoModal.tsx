import { useState, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Pedido } from "@/components/stock/pedidosEstoqueTypes";
import { MapPin } from "lucide-react";

interface EditarEnderecoModalProps {
  pedido: Pedido | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditarEnderecoModal({ pedido, onClose, onSuccess }: EditarEnderecoModalProps) {
  const [endereco, setEndereco] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!pedido) return;
    // Carrega endereço atual
    supabase
      .from("pedidos_comerciais")
      .select("endereco_entrega, usar_endereco_cliente")
      .eq("id", pedido.id)
      .maybeSingle()
      .then(({ data }) => {
        setEndereco((data as { endereco_entrega?: string } | null)?.endereco_entrega ?? "");
      });
  }, [pedido]);

  if (!pedido) return null;

  async function handleSalvar() {
    if (!pedido) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("pedidos_comerciais")
        .update({
          endereco_entrega: endereco.trim() || null,
          usar_endereco_cliente: !endereco.trim(),
        })
        .eq("id", pedido.id);
      if (error) throw error;
      toast.success("Endereço de entrega atualizado.");
      onSuccess();
      onClose();
    } catch (_e) {
      toast.error("Erro ao salvar endereço.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 p-5 space-y-4 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
            <MapPin className="h-4 w-4 text-blue-500" />
          </div>
          <div>
            <p className="text-sm font-semibold">Editar Endereço de Entrega</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">{pedido.cliente_nome}</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Novo endereço</label>
          <textarea
            value={endereco}
            onChange={e => setEndereco(e.target.value)}
            placeholder="Rua, número, bairro, cidade/UF, CEP..."
            rows={3}
            maxLength={400}
            className="w-full rounded-xl border border-border/50 bg-background text-sm px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
          <p className="text-[10px] text-muted-foreground/60">Deixe em branco para usar o endereço cadastrado do cliente.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">Cancelar</button>
          <button type="button" onClick={handleSalvar} disabled={saving} className="flex-1 h-9 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
            {saving ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
