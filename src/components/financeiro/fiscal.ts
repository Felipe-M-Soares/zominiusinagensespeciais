/** Tipos e consultas compartilhadas do faturamento (NF-e). */
import { supabase } from "@/integrations/supabase/client";

export interface EmissorStatus { ativo: boolean; ambiente: 1 | 2; faltando: string[]; carregado: boolean }
export const EMISSOR_INICIAL: EmissorStatus = { ativo: false, ambiente: 2, faltando: [], carregado: false };

export async function carregarEmissor(): Promise<EmissorStatus> {
  try {
    const { data, error } = await supabase.functions.invoke("nfe", { body: { acao: "status" } });
    if (error || !data?.ok) return { ativo: false, ambiente: 2, faltando: ["emissor não instalado"], carregado: true };
    return { ativo: !!data.ativo, ambiente: data.ambiente === 1 ? 1 : 2, faltando: data.faltando ?? [], carregado: true };
  } catch {
    return { ativo: false, ambiente: 2, faltando: ["emissor não instalado"], carregado: true };
  }
}

export interface ClienteFiscal {
  id: string; nome: string; documento: string | null; ie: string | null; email: string | null; telefone: string | null;
  logradouro: string | null; numero: string | null; bairro: string | null; municipio: string | null; uf: string | null;
  cep: string | null; c_mun: string | null;
}
export interface ItemPedido {
  id: string; quantidade: number; valor_unitario: number; lote: string | null;
  stock_items: { devices: { model: string; reference: string; internal_code: string | null; ncm: string | null; cfop_padrao: string | null } | null } | null;
}
export interface PedidoFaturar {
  id: string; created_at: string; vendedora_nome: string | null; frete: number; desconto_pct: number;
  forma_pagamento: string | null; parcelas: number | null; prazo_entrega: string | null; observacoes: string | null;
  clientes: ClienteFiscal | null; pedido_itens: ItemPedido[];
}

export const SELECT_PEDIDO_FATURAR =
  "id,created_at,vendedora_nome,frete,desconto_pct,forma_pagamento,parcelas,prazo_entrega,observacoes," +
  "clientes(id,nome,documento,ie,email,telefone,logradouro,numero,bairro,municipio,uf,cep,c_mun)," +
  "pedido_itens(id,quantidade,valor_unitario,lote,stock_items(devices(model,reference,internal_code,ncm,cfop_padrao)))";

/**
 * Total do pedido em R$ (itens + frete), somado em centavos.
 * valor_unitario já é LÍQUIDO (o desconto por peça é aplicado ao criar o
 * pedido); desconto_pct do pedido é só a média informativa — não reaplicar.
 */
export function totalPedido(p: Pick<PedidoFaturar, "pedido_itens" | "frete">): number {
  const itens = p.pedido_itens.reduce((s, i) => s + Math.round(Number(i.valor_unitario) * 100 * i.quantidade), 0);
  return (itens + Math.round((Number(p.frete) || 0) * 100)) / 100;
}

/** O que falta no cadastro do cliente para emitir NF-e. */
export function pendenciasCliente(c: ClienteFiscal | null): string[] {
  if (!c) return ["cliente"];
  const f: string[] = [];
  const doc = (c.documento ?? "").replace(/\D/g, "");
  if (doc.length !== 11 && doc.length !== 14) f.push("CPF/CNPJ");
  if (!c.logradouro?.trim()) f.push("rua");
  if (!c.numero?.trim()) f.push("número");
  if (!c.bairro?.trim()) f.push("bairro");
  if (!c.municipio?.trim()) f.push("cidade");
  if (!/^[A-Z]{2}$/.test((c.uf ?? "").toUpperCase())) f.push("UF");
  if ((c.cep ?? "").replace(/\D/g, "").length !== 8) f.push("CEP");
  return f;
}

export interface NotaFiscal {
  id: string; tipo: "venda" | "devolucao" | "troca"; origem: "emissor" | "externa";
  pedido_id: string | null; devolucao_id: string | null; modelo: string; serie: string | null; numero: number | null;
  chave: string | null; protocolo: string | null; status: "processando" | "autorizada" | "rejeitada" | "cancelada" | "denegada";
  ambiente: number; natureza: string | null; destinatario_nome: string | null; destinatario_doc: string | null;
  valor_total: number | null; emitida_em: string | null; cancelada_em: string | null; motivo_cancelamento: string | null;
  mensagem: string | null; xml_path: string | null; danfe_path: string | null; danfe_url: string | null;
  eventos: { tipo: string; em: string; texto?: string; protocolo?: string | null }[]; created_at: string;
}

export const STATUS_NF: Record<NotaFiscal["status"], { label: string; cls: string }> = {
  processando: { label: "Processando", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30" },
  autorizada:  { label: "Autorizada",  cls: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30" },
  rejeitada:   { label: "Rejeitada",   cls: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30" },
  cancelada:   { label: "Cancelada",   cls: "bg-muted text-muted-foreground border-border" },
  denegada:    { label: "Denegada",    cls: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30" },
};
export const TIPO_NF: Record<NotaFiscal["tipo"], string> = { venda: "Venda", devolucao: "Devolução", troca: "Troca" };

/** Chama a edge function do emissor e devolve {ok, erro, problemas, ...}. */
export async function chamarEmissor(body: Record<string, unknown>): Promise<Record<string, unknown> & { ok: boolean; erro?: string; problemas?: string[] }> {
  const { data, error } = await supabase.functions.invoke("nfe", { body });
  if (error) {
    // FunctionsHttpError: tenta ler a mensagem do corpo
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) { const j = await ctx.json(); return { ok: false, ...j }; }
    } catch { /* sem corpo */ }
    return { ok: false, erro: "Não foi possível falar com o emissor." };
  }
  return data as Record<string, unknown> & { ok: boolean };
}
