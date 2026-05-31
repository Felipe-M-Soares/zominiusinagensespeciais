/**
 * pedidoUtils — Criação atômica de pedidos comerciais
 *
 * Centraliza a lógica de criação de pedido + reserva de estoque,
 * garantindo rollback parcial se qualquer etapa falhar.
 */

import { supabase } from "@/integrations/supabase/client";

export interface PedidoItemInput {
  stock_item_id: string;
  lote: string | null;
  quantidade: number;
  device_model?: string;
}

export interface CriarPedidoParams {
  clienteId: string;
  itens: PedidoItemInput[];
  vendedoraId: string | undefined;
  vendedoraNome: string;
  observacoes?: string | null;
  descontoPct?: number;
  prazoEntrega?: string | null;
}

export interface CriarPedidoResult {
  ok: boolean;
  pedidoId?: string;
  error?: string;
}

/**
 * Cria um pedido comercial e reserva o estoque em três etapas:
 *  1. INSERT pedidos_comerciais
 *  2. INSERT pedido_itens (com rollback do pedido se falhar)
 *  3. RPC reserve_stock para cada item (decrementa quantity_available atomicamente)
 *
 * A RPC reserve_stock é atômica no banco — não há race condition no decremento.
 * O rollback entre etapas 1 e 2 é manual (limitação do cliente JS sem transações).
 */
export async function criarPedidoComReserva(
  params: CriarPedidoParams
): Promise<CriarPedidoResult> {
  const { clienteId, itens, vendedoraId, vendedoraNome, observacoes, descontoPct, prazoEntrega } = params;

  const { data: pedido, error: pedidoErr } = await supabase
    .from("pedidos_comerciais")
    .insert({
      cliente_id: clienteId,
      vendedora_id: vendedoraId,
      vendedora_nome: vendedoraNome,
      observacoes: observacoes ?? null,
      desconto_pct: descontoPct ?? 0,
      prazo_entrega: prazoEntrega ?? null,
    })
    .select()
    .single();

  if (pedidoErr) return { ok: false, error: "Erro ao criar pedido." };

  const pedidoId = (pedido as { id: string }).id;

  const itensInsert = itens.map((i) => ({
    pedido_id: pedidoId,
    stock_item_id: i.stock_item_id,
    lote: i.lote ?? null,
    quantidade: i.quantidade,
    quantidade_reservada: i.quantidade,
  }));

  const { error: itensErr } = await supabase
    .from("pedido_itens")
    .insert(itensInsert);

  if (itensErr) {
    // Rollback: remove o pedido para evitar registro órfão no banco
    await supabase.from("pedidos_comerciais").delete().eq("id", pedidoId);
    return { ok: false, error: "Erro ao inserir itens do pedido." };
  }

  // Reserva estoque via RPC atômica para cada item
  // reserve_stock retorna { ok: boolean, error?: string }
  for (const item of itens) {
    const { data: reserved, error: reserveErr } = await supabase.rpc("reserve_stock", {
      p_item_id: item.stock_item_id,
      p_qty: item.quantidade,
    });
    const result = reserved as { ok?: boolean; error?: string } | null;
    if (reserveErr || result?.ok === false) {
      return {
        ok: false,
        error: result?.error ?? `Estoque insuficiente para ${item.device_model ?? item.stock_item_id}`,
      };
    }
  }

  return { ok: true, pedidoId };
}
