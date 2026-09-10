export interface LoteDisponivel {
  lote: string;
  quantity: number;
  stock_item_id: string;
}

export interface PedidoItem {
  id: string;
  ids: string[]; // todos os ids de pedido_itens unificados
  stock_item_id: string;
  lote: string;
  quantidade: number;
  device_model?: string;
  device_reference?: string;
  lotes_disponiveis?: LoteDisponivel[];
  lote_escolhido?: string;
}

export interface LoteSeparado {
  stock_item_id: string;
  lote: string;
  quantidade: number;
  device_model?: string;
}

export interface Pedido {
  id: string;
  cliente_id: string;
  cliente_nome: string;
  cliente_municipio?: string | null;
  cliente_uf?: string | null;
  cliente_telefone?: string | null;
  endereco_entrega?: string | null;
  vendedora_nome: string | null;
  vendedora_id: string | null;
  status: string;
  frete: number;
  observacoes: string | null;
  created_at: string;
  desconto_pct?: number;
  prazo_entrega?: string | null;
  itens: PedidoItem[];
  lotes_separados: LoteSeparado[] | null;
  itens_raw: { stock_item_id: string; lote: string; quantidade: number; device_model?: string; device_reference?: string }[];
}

export interface LoteSelecao {
  [itemId: string]: {
    [lote: string]: number;
  };
}
