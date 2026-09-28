/**
 * pedidoUtils — utilidades de clientes/pedidos.
 * A criação de pedido é feita pela RPC `criar_pedido_venda` (atômica no banco).
 */

import { supabase } from "@/integrations/supabase/client";

/**
 * Exclui um cliente com segurança.
 *
 * Antes, o admin apagava TODOS os pedidos do cliente (inclusive faturados,
 * com NF-e emitida) direto na tabela, sem devolver as reservas de estoque —
 * o que corrompia `quantity_reserved` e apagava histórico fiscal.
 *
 * Agora:
 *  - Se o cliente tiver qualquer pedido que não esteja "cancelado", a exclusão
 *    é recusada com uma mensagem clara (cancele os pedidos antes).
 *  - Pedidos cancelados (reservas já devolvidas pelo cancel_pedido) são
 *    removidos junto — só para admin, que é quem tem permissão de DELETE.
 */
export async function excluirClienteSeguro(
  clienteId: string,
  isAdmin: boolean
): Promise<{ ok: boolean; error?: string }> {
  const { data: peds, error: pedErr } = await supabase
    .from("pedidos_comerciais")
    .select("id, status")
    .eq("cliente_id", clienteId);
  if (pedErr) return { ok: false, error: "Não foi possível verificar os pedidos do cliente." };

  const ativos = (peds ?? []).filter((p) => p.status !== "cancelado");
  if (ativos.length > 0) {
    return {
      ok: false,
      error: `Este cliente possui ${ativos.length} pedido(s) não cancelado(s). Cancele-os antes de excluir — pedidos faturados ficam no histórico fiscal.`,
    };
  }

  const cancelados = (peds ?? []).map((p) => p.id as string);
  if (cancelados.length > 0) {
    if (!isAdmin) {
      return { ok: false, error: "Cliente possui pedidos cancelados no histórico. Peça a um administrador para excluir." };
    }
    const { error: itErr } = await supabase.from("pedido_itens").delete().in("pedido_id", cancelados);
    if (itErr) return { ok: false, error: "Erro ao limpar itens de pedidos cancelados." };
    const { error: pcErr } = await supabase.from("pedidos_comerciais").delete().in("id", cancelados);
    if (pcErr) return { ok: false, error: "Erro ao limpar pedidos cancelados." };
  }

  const { error } = await supabase.from("clientes").delete().eq("id", clienteId);
  if (error) return { ok: false, error: "Não foi possível excluir o cliente." };
  return { ok: true };
}
