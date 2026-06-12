/**
 * pedidoUtils — Criação atômica de pedidos comerciais
 */

import { supabase } from "@/integrations/supabase/client";

export interface PedidoItemInput {
  stock_item_id: string;
  lote: string | null;
  quantidade: number;
  device_model?: string;
  preco_unitario?: number;
}

export interface CriarPedidoParams {
  clienteId: string;
  itens: PedidoItemInput[];
  vendedoraId: string | undefined;
  vendedoraNome: string;
  observacoes?: string | null;
  descontoPct?: number;
  prazoEntrega?: string | null;
  formaPagamento?: string | null;
  parcelas?: number;
  enderecoEntrega?: string | null;
  usarEnderecoCliente?: boolean;
}

export interface CriarPedidoResult {
  ok: boolean;
  pedidoId?: string;
  error?: string;
}

export async function criarPedidoComReserva(
  params: CriarPedidoParams
): Promise<CriarPedidoResult> {
  const {
    clienteId, itens, vendedoraId, vendedoraNome, observacoes,
    descontoPct, prazoEntrega, formaPagamento, parcelas,
    enderecoEntrega, usarEnderecoCliente,
  } = params;

  const { data: pedido, error: pedidoErr } = await supabase
    .from("pedidos_comerciais")
    .insert({
      cliente_id: clienteId,
      vendedora_id: vendedoraId,
      vendedora_nome: vendedoraNome,
      observacoes: observacoes ?? null,
      desconto_pct: descontoPct ?? 0, // numeric(5,2) após migration 20260035000000_desconto_decimal.sql
      prazo_entrega: prazoEntrega ?? null,
      forma_pagamento: formaPagamento ?? null,
      parcelas: formaPagamento === "cartao_credito" ? (parcelas ?? 1) : 1,
      endereco_entrega: enderecoEntrega ?? null,
      usar_endereco_cliente: usarEnderecoCliente ?? true,
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
    preco_unitario: i.preco_unitario ?? 0,
    valor_total: (i.preco_unitario ?? 0) * i.quantidade,
  }));

  const { error: itensErr } = await supabase
    .from("pedido_itens")
    .insert(itensInsert);

  if (itensErr) {
    await supabase.from("pedidos_comerciais").delete().eq("id", pedidoId);
    return { ok: false, error: "Erro ao inserir itens do pedido." };
  }

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
