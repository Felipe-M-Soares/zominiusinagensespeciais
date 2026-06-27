// Auto-gerado a partir das migrations — execute "supabase gen types typescript" para atualizar
// Este arquivo representa o schema atual do banco de dados

export type Database = {
  public: {
    Tables: {
      stock_items: {
        Row: {
          id: string
          device_id: string
          quantity: number
          quantity_reserved: number
          min_quantity: number
          location: string | null
          notes: string | null
          fase: "intermediaria" | "expedicao" | "retrabalho"
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database["public"]["Tables"]["stock_items"]["Row"], "id" | "created_at" | "updated_at"> & { id?: string }
        Update: Partial<Database["public"]["Tables"]["stock_items"]["Insert"]>
      }
      stock_movements: {
        Row: {
          id: string
          stock_item_id: string
          type: "entrada" | "saida"
          quantity: number
          reason: string | null
          lote: string | null
          user_id: string | null
          user_display_name: string | null
          created_at: string
        }
        Insert: Omit<Database["public"]["Tables"]["stock_movements"]["Row"], "id" | "created_at"> & { id?: string }
        Update: Partial<Database["public"]["Tables"]["stock_movements"]["Insert"]>
      }
      pedidos_comerciais: {
        Row: {
          id: string
          cliente_id: string
          vendedora_id: string | null
          vendedora_nome: string | null
          status: "pendente" | "separando" | "pronto" | "faturado" | "enviado" | "cancelado"
          observacoes: string | null
          frete: number
          desconto_pct: number
          separado_por: string | null
          separado_em: string | null
          faturado_por: string | null
          faturado_em: string | null
          nota_fiscal: string | null
          nf_criada_por: string | null
          nf_criada_em: string | null
          enviado_em: string | null
          lotes_separados: LoteSeparado[] | null
          chave_acesso_nfe: string | null
          protocolo_sefaz: string | null
          dh_autorizacao_nfe: string | null
          tipo_nf: "nfe" | "nfce" | null
          xml_nfe: string | null
          rastreio_envio: string | null
          transportadora: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database["public"]["Tables"]["pedidos_comerciais"]["Row"], "id" | "created_at" | "updated_at"> & { id?: string }
        Update: Partial<Database["public"]["Tables"]["pedidos_comerciais"]["Insert"]>
      }
      pedido_itens: {
        Row: {
          id: string
          pedido_id: string
          stock_item_id: string
          lote: string | null
          quantidade: number
          quantidade_reservada: number
          created_at: string
        }
        Insert: Omit<Database["public"]["Tables"]["pedido_itens"]["Row"], "id" | "created_at"> & { id?: string }
        Update: Partial<Database["public"]["Tables"]["pedido_itens"]["Insert"]>
      }
      clientes: {
        Row: {
          id: string
          nome: string
          documento: string | null
          telefone: string | null
          email: string | null
          endereco: string | null
          observacoes: string | null
          ie: string | null
          cep: string | null
          logradouro: string | null
          numero: string | null
          bairro: string | null
          municipio: string | null
          uf: string | null
          c_mun: string | null
          ind_ie_dest: number | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database["public"]["Tables"]["clientes"]["Row"], "id" | "created_at" | "updated_at"> & { id?: string }
        Update: Partial<Database["public"]["Tables"]["clientes"]["Insert"]>
      }
      notificacoes: {
        Row: {
          id: string
          user_id: string
          pedido_id: string | null
          tipo: string
          titulo: string
          mensagem: string | null
          lida: boolean
          created_at: string
        }
        Insert: Omit<Database["public"]["Tables"]["notificacoes"]["Row"], "id" | "created_at"> & { id?: string }
        Update: Partial<Database["public"]["Tables"]["notificacoes"]["Insert"]>
      }
      audit_log: {
        Row: {
          id: string
          user_id: string | null
          user_name: string | null
          action: string
          entity_type: string
          entity_id: string | null
          details: Record<string, unknown> | null
          created_at: string
        }
        Insert: Omit<Database["public"]["Tables"]["audit_log"]["Row"], "id" | "created_at"> & { id?: string }
        Update: Partial<Database["public"]["Tables"]["audit_log"]["Insert"]>
      }
    }
    Functions: {
      cancel_pedido: { Args: { p_pedido_id: string }; Returns: { success: boolean } }
      marcar_pedido_pronto: { Args: { p_pedido_id: string; p_user_name: string }; Returns: { ok: boolean; error?: string } }
      faturar_pedido_sefaz: {
        Args: { p_pedido_id: string; p_nf: string; p_chave_acesso: string; p_protocolo: string; p_dh_autorizacao: string; p_user_id: string; p_user_name: string; p_xml_nfe?: string }
        Returns: { ok: boolean; error?: string; already_faturado?: boolean }
      }
      reserve_stock: { Args: { p_pedido_id: string; p_items: Array<{ stock_item_id: string; quantidade: number }> }; Returns: { ok: boolean; error?: string } }
      stock_movement_atomic: { Args: { p_item_id: string; p_type: string; p_qty: number; p_reason: string | null; p_lote: string | null; p_user_id: string | null; p_user_name: string | null }; Returns: { ok: boolean; error?: string } }
      delete_stock_item: { Args: { p_stock_item_id: string }; Returns: { ok: boolean; error?: string } }
      // Limpeza de histórico por módulo (admin only) — todas sem parâmetros,
      // retornam { ok, deleted } com a contagem de registros apagados.
      admin_clear_stock_movements: { Args: Record<string, never>; Returns: { ok: boolean; error?: string; deleted?: number } }
      admin_clear_comercial:       { Args: Record<string, never>; Returns: { ok: boolean; error?: string; deleted?: number } }
      admin_clear_producao:        { Args: Record<string, never>; Returns: { ok: boolean; error?: string; deleted?: number } }
      admin_clear_rastreabilidade: { Args: Record<string, never>; Returns: { ok: boolean; error?: string; deleted?: number } }
      admin_clear_financeiro:      { Args: Record<string, never>; Returns: { ok: boolean; error?: string; deleted?: number } }
      admin_clear_audit_log:       { Args: Record<string, never>; Returns: { ok: boolean; error?: string; deleted?: number } }
      admin_regularizar_todos_devices: { Args: Record<string, never>; Returns: { ok: boolean; error?: string } }
    }
  }
}

export interface LoteSeparado {
  pedido_item_id: string
  stock_item_id: string
  lote: string
  quantidade: number
  device_model?: string
}

// Alias para compatibilidade com código existente
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"]
