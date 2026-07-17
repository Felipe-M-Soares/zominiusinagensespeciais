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
  status: "pendente" | "separando" | "pronto" | "faturado" | "enviado" | "cancelado" | "retorno";
  observacoes: string | null;
  desconto_pct: number;
  frete: number;
  prazo_entrega: string | null;
  created_at: string;
  faturado_em: string | null;
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
