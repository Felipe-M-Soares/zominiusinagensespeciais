/**
 * Ações de escrita do módulo Estoque que não existem em useStock.ts
 * (arquivo compartilhado — não editado aqui). Só combinam RPCs já existentes.
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchLotesSummary, registerMovement } from "@/hooks/useStock";
import type { StockItem } from "@/hooks/useStock";

export const MOTIVO_ZERAR = "Ajuste de inventário — saldo zerado pelo administrador";

/**
 * Zera o saldo de uma peça por LANÇAMENTO DE AJUSTE (uma saída por lote com
 * saldo, e o restante sem lote), preservando o histórico de movimentações.
 *
 * Substitui o antigo "zerar estoque e histórico", que apagava as
 * movimentações (rastreabilidade ANVISA) e os itens de pedidos antigos.
 */
export async function zerarSaldoPorAjuste(
  item: StockItem,
  userId: string | null,
  userName: string | null,
): Promise<{ ok: boolean; error?: string }> {
  // Não zera com pedidos ativos usando a peça (a reserva ficaria sem saldo)
  const { data: ativos, error: eAtivos } = await supabase
    .from("pedido_itens")
    .select("pedido_id, pedidos_comerciais!inner(status)")
    .eq("stock_item_id", item.id)
    .in("pedidos_comerciais.status", ["pendente", "separando", "retorno"]);
  if (eAtivos) return { ok: false, error: "Não foi possível verificar os pedidos desta peça." };
  if (ativos && ativos.length > 0) {
    return { ok: false, error: `Há ${ativos.length} pedido(s) ativo(s) usando esta peça. Cancele ou conclua antes de zerar.` };
  }

  const { data: atual } = await supabase.from("stock_items").select("quantity").eq("id", item.id).maybeSingle();
  let restante = (atual as { quantity: number } | null)?.quantity ?? item.quantity;
  if (restante <= 0) return { ok: true };

  const lotes = (await fetchLotesSummary(item.id, item.fase)).filter(l => l.saldo > 0);
  for (const l of lotes) {
    if (restante <= 0) break;
    const qtd = Math.min(l.saldo, restante);
    const r = await registerMovement(item.id, "saida", qtd, MOTIVO_ZERAR, userId, userName, l.lote);
    if (!r.ok) return r;
    restante -= qtd;
  }
  if (restante > 0) {
    const r = await registerMovement(item.id, "saida", restante, MOTIVO_ZERAR, userId, userName, null);
    if (!r.ok) return r;
  }
  return { ok: true };
}
