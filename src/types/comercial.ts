/**
 * Tipos compartilhados pela página Comercial e seus modais extraídos
 * (ClienteModal, NovoPedidoModal, AdicionarPecaModal, FaturarModal,
 * HistoricoClienteModal, ComentariosModal, HistoricoGeralModal).
 *
 * NOTA: existe também src/types/pedido.ts com um `PedidoItem` diferente
 * (usado por Financeiro/PedidosEstoquePanel) — não são intercambiáveis,
 * os campos divergem (id obrigatório vs opcional, lote nullable vs não,
 * presença de ncm/cfop/unidade vs device_id/desconto_pct). Mantidos
 * separados de propósito.
 */

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export interface Cliente {
  id: string;
  nome: string;
  documento: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  observacoes: string | null;
  created_at: string;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
  ie?: string | null;
  /** Código IBGE do município (7 dígitos). */
  c_mun?: string | null;
}

export interface PedidoItem {
  stock_item_id: string;
  device_id?: string;
  lote: string | null;
  quantidade: number;
  device_model: string;
  device_reference: string;
  preco_unitario?: number;
  /** Desconto individual da peça (vendedora define livremente) */
  desconto_pct?: number;
}

export interface PedidoCompleto {
  id: string;
  cliente_id: string;
  cliente_nome: string;
  vendedora_nome: string | null;
  vendedora_id: string | null;
  status: "pendente" | "separando" | "pronto" | "faturado" | "enviado" | "cancelado" | "retorno";
  observacoes: string | null;
  desconto_pct: number;
  frete: number;
  prazo_entrega: string | null;
  created_at: string;
  faturado_em: string | null;
  nota_fiscal?: string | null;
  forma_pagamento?: string | null;
  parcelas?: number | null;
  rastreio_envio?: string | null;
  /** Crédito do cliente abatido neste pedido (R$). */
  credito_aplicado?: number;
  /** Endereço de entrega gravado no pedido (quando não usa o do cliente). */
  endereco_entrega?: string | null;
  /** true = entrega no endereço do cadastro do cliente. */
  usar_endereco_cliente?: boolean | null;
  itens: Array<{
    id: string;
    stock_item_id: string;
    lote: string | null;
    quantidade: number;
    quantidade_reservada: number;
    device_model?: string;
    device_reference?: string;
    valor_unitario?: number;
    device_id?: string;
  }>;
}

/** Rótulos das formas de pagamento usadas nos pedidos comerciais. */
export const FORMAS_PGTO_PEDIDO: Record<string, string> = {
  pix: "PIX", boleto: "Boleto", cartao_credito: "Cartão crédito", cartao_debito: "Cartão débito", dinheiro: "Dinheiro",
};

/** Situação do pedido — rótulo curto para listas/filtros. */
export const SITUACAO_PEDIDO: Record<PedidoCompleto["status"], string> = {
  pendente: "Aguardando confirmação", separando: "Em separação", pronto: "Pronto (aguardando NF)",
  faturado: "Faturado", enviado: "Enviado", cancelado: "Cancelado", retorno: "Voltou do estoque",
};

/** Pedidos que contam como venda (confirmados pela vendedora e não cancelados). */
export const STATUS_VENDA: PedidoCompleto["status"][] = ["separando", "pronto", "faturado", "enviado"];

/** Total do pedido: itens (valor unitário já líquido) + frete. */
export function totalPedido(p: Pick<PedidoCompleto, "itens" | "frete">): number {
  return p.itens.reduce((s, i) => s + (i.valor_unitario ?? 0) * i.quantidade, 0) + (p.frete ?? 0);
}

/** Pedido com prazo de entrega vencido e ainda não faturado/enviado/cancelado. */
export function pedidoAtrasado(p: Pick<PedidoCompleto, "prazo_entrega" | "status">, agora = new Date()): boolean {
  return !!p.prazo_entrega && !["cancelado", "enviado", "faturado"].includes(p.status)
    && new Date(`${p.prazo_entrega}T23:59:59`) < agora;
}

export interface Comentario {
  id: string;
  user_name: string;
  texto: string;
  created_at: string;
}

/** Registra uma ação no audit_log. Falha silenciosamente — nunca bloqueia o fluxo principal. */
export async function logAudit(
  userId: string | undefined,
  userName: string | null | undefined,
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>
) {
  try {
    await supabase.from("audit_log").insert({
      user_id: userId ?? null,
      user_name: userName ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details: details ? (details as Json) : undefined,
    });
  } catch {
    // Falha silenciosa — não bloqueia ações críticas
  }
}
