/**
 * COD-01 FIX: Lógica de criação de pedido extraída para módulo compartilhado.
 *
 * Antes, o loop de criação de pedido + reserva de estoque estava duplicado em:
 *  - src/components/stock/ComercialPanel.tsx
 *  - src/pages/Comercial.tsx
 *
 * Qualquer correção precisava ser aplicada nos dois locais.
 * O bug BUG-01 (checagem incorreta de reserve_stock) existia em ambos.
 */

import { supabase } from "@/integrations/supabase/client";

export interface PedidoItemInput {
  stock_item_id: string;
  lote: string;
  quantidade: number;
  device_model?: string;
}

export interface CriarPedidoParams {
  clienteId: string;
  itens: PedidoItemInput[];
  vendedoraId: string | undefined;
  vendedoraNome: string;
  observacoes?: string | null;
}

export interface CriarPedidoResult {
  ok: boolean;
  pedidoId?: string;
  error?: string;
}

/**
 * Cria um pedido comercial e reserva o estoque atomicamente.
 * BUG-01: reserve_stock retorna boolean — false = estoque insuficiente.
 */
export async function criarPedidoComReserva(
  params: CriarPedidoParams
): Promise<CriarPedidoResult> {
  const { clienteId, itens, vendedoraId, vendedoraNome, observacoes } = params;

  // 1. Cria o pedido
  const { data: pedido, error: pedidoErr } = await supabase
    .from("pedidos_comerciais")
    .insert({
      cliente_id: clienteId,
      vendedora_id: vendedoraId,
      vendedora_nome: vendedoraNome,
      observacoes: observacoes ?? null,
    })
    .select()
    .single();

  if (pedidoErr) return { ok: false, error: "Erro ao criar pedido." };

  const pedidoId = (pedido as { id: string }).id;

  // 2. Insere os itens
  const itensInsert = itens.map((i) => ({
    pedido_id: pedidoId,
    stock_item_id: i.stock_item_id,
    lote: i.lote,
    quantidade: i.quantidade,
    quantidade_reservada: i.quantidade,
  }));

  const { error: itensErr } = await supabase
    .from("pedido_itens")
    .insert(itensInsert);

  if (itensErr) return { ok: false, error: "Erro ao inserir itens do pedido." };

  // 3. Reserva estoque atomicamente para cada item
  // BUG-01 FIX: reserve_stock retorna boolean — false = estoque insuficiente
  for (const item of itens) {
    const { data: reserved, error: reserveErr } = await supabase.rpc("reserve_stock", {
      p_item_id: item.stock_item_id,
      p_qty: item.quantidade,
    });
    if (reserveErr || reserved === false) {
      return {
        ok: false,
        error: `Estoque insuficiente para ${item.device_model ?? item.stock_item_id}`,
      };
    }
  }

  return { ok: true, pedidoId };
}
