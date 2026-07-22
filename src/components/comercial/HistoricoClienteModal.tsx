import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { History, X } from "lucide-react";
import type { Cliente } from "@/types/comercial";

export function HistoricoClienteModal({ clienteId, clientes, onClose }: {
  clienteId: string | null;
  clientes: Cliente[];
  onClose: () => void;
}) {
  const [pedidos, setPedidos] = useState<{ id: string; status: string; created_at: string; itens: { device_model?: string; quantidade: number }[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const cliente = clientes.find(c => c.id === clienteId);

  useEffect(() => {
    if (!clienteId) return;
    setLoading(true);
    supabase
      .from("pedidos_comerciais")
      .select("id, status, created_at, pedido_itens(quantidade, stock_items!pedido_itens_stock_item_id_fkey(devices!stock_items_device_id_fkey(model)))")
      .eq("cliente_id", clienteId)
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data }) => {
        setPedidos((data ?? []).map((p: Record<string, unknown>) => ({
          id: p.id as string,
          status: p.status as string,
          created_at: p.created_at as string,
          itens: ((p.pedido_itens as Record<string,unknown>[]) ?? []).map((i: Record<string,unknown>) => ({
            device_model: ((i.stock_items as { devices?: { model?: string } } | null)?.devices?.model),
            quantidade: i.quantidade as number,
          })),
        })));
        setLoading(false);
      });
  }, [clienteId]);

  if (!clienteId) return null;

  const statusColors: Record<string, string> = {
    pendente: "bg-amber-500/10 text-amber-600",
    separando: "bg-blue-500/10 text-blue-600",
    pronto: "bg-emerald-500/10 text-emerald-600",
    faturado: "bg-violet-500/10 text-violet-600",
    enviado: "bg-green-500/10 text-green-600",
    cancelado: "bg-muted/30 text-muted-foreground",
    retorno: "bg-orange-500/10 text-orange-600",
  };
  const statusLabels: Record<string, string> = {
    pendente: "Pendente", separando: "Separando", pronto: "Pronto",
    faturado: "Faturado", enviado: "Enviado", cancelado: "Cancelado", retorno: "Retorno",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-card border border-border/30 shadow-xl overflow-hidden flex flex-col max-h-[90vh] sm:max-h-[85vh] animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/20 shrink-0">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-violet-500" />
            <div>
              <p className="text-sm font-semibold">Histórico de Compras</p>
              <p className="text-[11px] text-muted-foreground">{cliente?.nome ?? "Cliente"}</p>
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && <div className="flex items-center justify-center py-10"><div className="h-5 w-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}
          {!loading && pedidos.length === 0 && (
            <div className="text-center py-10 text-sm text-muted-foreground">Nenhum pedido encontrado</div>
          )}
          {!loading && pedidos.map(p => {
            const totalItens = p.itens.reduce((s, i) => s + i.quantidade, 0);
            return (
              <div key={p.id} className="rounded-xl border border-border/20 bg-background/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground/70">
                    {new Date(p.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                  </span>
                  <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", statusColors[p.status] ?? "bg-muted/20 text-muted-foreground")}>
                    {statusLabels[p.status] ?? p.status}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {p.itens.slice(0, 3).map((i, idx) => (
                    <div key={idx} className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground truncate">{i.device_model ?? "—"}</span>
                      <span className="font-semibold shrink-0 ml-2">{i.quantidade} un.</span>
                    </div>
                  ))}
                  {p.itens.length > 3 && <p className="text-[10px] text-muted-foreground/50">+{p.itens.length - 3} itens · {totalItens} un. total</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
