/**
 * Tipos compartilhados para Pedido comercial.
 * Usado em: Financeiro, Comercial, PedidosEstoquePanel.
 */

export interface PedidoItem {
  id: string;
  stock_item_id: string;
  lote: string;
  quantidade: number;
  device_model?: string;
  device_reference?: string;
  ncm?: string;
  cfop?: string;
  unidade?: string;
  valor_unitario?: number;
  preco_venda?: number;
}

export interface PedidoBase {
  id: string;
  cliente_nome: string;
  cliente_documento?: string;
  cliente_telefone?: string;
  cliente_email?: string;
  cliente_endereco?: string;
  vendedora_nome: string | null;
  vendedora_id: string | null;
  status: string;
  frete: number;
  observacoes: string | null;
  nota_fiscal: string | null;
  protocolo_sefaz?: string | null;
  chave_acesso_nfe?: string | null;
  desconto_pct?: number;
  xml_nfe?: string | null;
  rastreio_envio?: string | null;
  transportadora?: string | null;
  created_at: string;
  separado_em: string | null;
  nf_criada_em: string | null;
  enviado_em: string | null;
  itens: PedidoItem[];
}
