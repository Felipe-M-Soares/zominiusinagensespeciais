/**
 * pedidoUtils — Criação atômica de pedidos comerciais
 */

import { supabase } from "@/integrations/supabase/client";

export interface PedidoItemInput {
  stock_item_id: string;
  lote: string | null;
  quantidade: number;
  device_model?: string;
  /** Preço unitário já líquido (com o desconto daquela peça aplicado). Vai para pedido_itens.valor_unitario. */
  valorUnitarioLiquido?: number;
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
  frete?: number;
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
    enderecoEntrega, usarEnderecoCliente, frete,
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
      parcelas: ["cartao_credito", "boleto"].includes(formaPagamento ?? "") ? (parcelas ?? 1) : 1,
      endereco_entrega: enderecoEntrega ?? null,
      usar_endereco_cliente: usarEnderecoCliente ?? true,
      frete: frete ?? 0,
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
    valor_unitario: i.valorUnitarioLiquido ?? 0,
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
