export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      apontamento_paradas: {
        Row: {
          apontamento_id: string
          created_at: string
          duracao_horas: number
          id: string
          observacao: string | null
          tipo_parada_id: number
          tipo_parada_nome: string
        }
        Insert: {
          apontamento_id: string
          created_at?: string
          duracao_horas?: number
          id?: string
          observacao?: string | null
          tipo_parada_id: number
          tipo_parada_nome: string
        }
        Update: {
          apontamento_id?: string
          created_at?: string
          duracao_horas?: number
          id?: string
          observacao?: string | null
          tipo_parada_id?: number
          tipo_parada_nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "apontamento_paradas_apontamento_id_fkey"
            columns: ["apontamento_id"]
            isOneToOne: false
            referencedRelation: "apontamentos_producao"
            referencedColumns: ["id"]
          },
        ]
      }
      apontamento_refugos: {
        Row: {
          apontamento_id: string
          created_at: string
          id: string
          observacao: string | null
          quantidade: number
          tipo_refugo_id: number
          tipo_refugo_nome: string
        }
        Insert: {
          apontamento_id: string
          created_at?: string
          id?: string
          observacao?: string | null
          quantidade?: number
          tipo_refugo_id: number
          tipo_refugo_nome: string
        }
        Update: {
          apontamento_id?: string
          created_at?: string
          id?: string
          observacao?: string | null
          quantidade?: number
          tipo_refugo_id?: number
          tipo_refugo_nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "apontamento_refugos_apontamento_id_fkey"
            columns: ["apontamento_id"]
            isOneToOne: false
            referencedRelation: "apontamentos_producao"
            referencedColumns: ["id"]
          },
        ]
      }
      apontamentos_producao: {
        Row: {
          comprimento_mm: number | null
          consumo_mp_metros: number | null
          created_at: string
          cycle_time_min: number | null
          data_apontamento: string
          descricao_mp: string | null
          descricao_produto: string | null
          equipamento: string | null
          fim: string | null
          grupo: string
          horario_fim: number
          horario_inicio: number
          horas_planejadas: number
          id: string
          inicio: string
          lead_time_horas: number | null
          lote: string
          lote_mp: string | null
          maquina: string
          maquina_codigo: string | null
          operador: string
          ordem_id: string | null
          produto: string
          qtde_plan_disp: number
          qtde_por_hora: number
          qtde_prevista: number | null
          quantidade: number
          seq_producao: number | null
          status: string
          turno: string
          unidade_medida: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          comprimento_mm?: number | null
          consumo_mp_metros?: number | null
          created_at?: string
          cycle_time_min?: number | null
          data_apontamento?: string
          descricao_mp?: string | null
          descricao_produto?: string | null
          equipamento?: string | null
          fim?: string | null
          grupo?: string
          horario_fim?: number
          horario_inicio?: number
          horas_planejadas?: number
          id?: string
          inicio: string
          lead_time_horas?: number | null
          lote: string
          lote_mp?: string | null
          maquina: string
          maquina_codigo?: string | null
          operador: string
          ordem_id?: string | null
          produto: string
          qtde_plan_disp?: number
          qtde_por_hora?: number
          qtde_prevista?: number | null
          quantidade?: number
          seq_producao?: number | null
          status?: string
          turno?: string
          unidade_medida?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          comprimento_mm?: number | null
          consumo_mp_metros?: number | null
          created_at?: string
          cycle_time_min?: number | null
          data_apontamento?: string
          descricao_mp?: string | null
          descricao_produto?: string | null
          equipamento?: string | null
          fim?: string | null
          grupo?: string
          horario_fim?: number
          horario_inicio?: number
          horas_planejadas?: number
          id?: string
          inicio?: string
          lead_time_horas?: number | null
          lote?: string
          lote_mp?: string | null
          maquina?: string
          maquina_codigo?: string | null
          operador?: string
          ordem_id?: string | null
          produto?: string
          qtde_plan_disp?: number
          qtde_por_hora?: number
          qtde_prevista?: number | null
          quantidade?: number
          seq_producao?: number | null
          status?: string
          turno?: string
          unidade_medida?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      backup_configs: {
        Row: {
          created_at: string
          id: string
          last_backup: string | null
          schedule: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_backup?: string | null
          schedule?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_backup?: string | null
          schedule?: string
          updated_at?: string
        }
        Relationships: []
      }
      catalogs: {
        Row: {
          created_at: string
          file_path: string
          file_size: number | null
          id: string
          title: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_path: string
          file_size?: number | null
          id?: string
          title: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_path?: string
          file_size?: number | null
          id?: string
          title?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      certificados: {
        Row: {
          alerta_dias: number
          arquivo_url: string | null
          created_at: string
          created_by: string | null
          data_emissao: string | null
          data_validade: string | null
          id: string
          nome: string
          numero: string | null
          observacoes: string | null
          orgao_emissor: string | null
          status: string
          tipo: string
          updated_at: string
        }
        Insert: {
          alerta_dias?: number
          arquivo_url?: string | null
          created_at?: string
          created_by?: string | null
          data_emissao?: string | null
          data_validade?: string | null
          id?: string
          nome: string
          numero?: string | null
          observacoes?: string | null
          orgao_emissor?: string | null
          status?: string
          tipo?: string
          updated_at?: string
        }
        Update: {
          alerta_dias?: number
          arquivo_url?: string | null
          created_at?: string
          created_by?: string | null
          data_emissao?: string | null
          data_validade?: string | null
          id?: string
          nome?: string
          numero?: string | null
          observacoes?: string | null
          orgao_emissor?: string | null
          status?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: []
      }
      clientes: {
        Row: {
          bairro: string | null
          c_mun: string | null
          cep: string | null
          created_at: string
          created_by: string | null
          documento: string | null
          email: string | null
          endereco: string | null
          id: string
          ie: string | null
          ind_ie_dest: number | null
          logradouro: string | null
          municipio: string | null
          nome: string
          numero: string | null
          observacoes: string | null
          telefone: string | null
          uf: string | null
          updated_at: string
        }
        Insert: {
          bairro?: string | null
          c_mun?: string | null
          cep?: string | null
          created_at?: string
          created_by?: string | null
          documento?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          ie?: string | null
          ind_ie_dest?: number | null
          logradouro?: string | null
          municipio?: string | null
          nome: string
          numero?: string | null
          observacoes?: string | null
          telefone?: string | null
          uf?: string | null
          updated_at?: string
        }
        Update: {
          bairro?: string | null
          c_mun?: string | null
          cep?: string | null
          created_at?: string
          created_by?: string | null
          documento?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          ie?: string | null
          ind_ie_dest?: number | null
          logradouro?: string | null
          municipio?: string | null
          nome?: string
          numero?: string | null
          observacoes?: string | null
          telefone?: string | null
          uf?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          contact: string
          created_at: string
          id: string
          location: string
          name: string
        }
        Insert: {
          contact: string
          created_at?: string
          id?: string
          location?: string
          name: string
        }
        Update: {
          contact?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
        }
        Relationships: []
      }
      contas_financeiras: {
        Row: {
          banco_id: string | null
          categoria: string
          created_at: string
          created_by: string | null
          data_emissao: string
          data_pagamento: string | null
          data_vencimento: string
          descricao: string
          fornecedor_id: string | null
          id: string
          nota_fiscal: string | null
          observacoes: string | null
          pedido_compra_id: string | null
          pedido_id: string | null
          status: string
          tipo: string
          updated_at: string
          valor: number
        }
        Insert: {
          banco_id?: string | null
          categoria?: string
          created_at?: string
          created_by?: string | null
          data_emissao?: string
          data_pagamento?: string | null
          data_vencimento: string
          descricao: string
          fornecedor_id?: string | null
          id?: string
          nota_fiscal?: string | null
          observacoes?: string | null
          pedido_compra_id?: string | null
          pedido_id?: string | null
          status?: string
          tipo: string
          updated_at?: string
          valor: number
        }
        Update: {
          banco_id?: string | null
          categoria?: string
          created_at?: string
          created_by?: string | null
          data_emissao?: string
          data_pagamento?: string | null
          data_vencimento?: string
          descricao?: string
          fornecedor_id?: string | null
          id?: string
          nota_fiscal?: string | null
          observacoes?: string | null
          pedido_compra_id?: string | null
          pedido_id?: string | null
          status?: string
          tipo?: string
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "contas_financeiras_banco_id_fkey"
            columns: ["banco_id"]
            isOneToOne: false
            referencedRelation: "financeiro_contas_bancarias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_financeiras_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_financeiras_pedido_compra_id_fkey"
            columns: ["pedido_compra_id"]
            isOneToOne: false
            referencedRelation: "pedidos_compra"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_financeiras_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_comerciais"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          anvisa_registration: string | null
          ativo: boolean
          body_region: string | null
          brand_name: string | null
          cfop_padrao: string
          classification_code: string
          compatible_systems: Json | null
          created_at: string
          data_registro_anvisa: string | null
          data_vencimento_anvisa: string | null
          desconto_max_pct: number
          desenho_tecnico_path: string | null
          empresa_afe: boolean
          empresa_bpf: boolean
          empresa_lf: boolean
          exocad_compatibility: string | null
          gtin: string | null
          icon_url: string | null
          id: string
          implantable: boolean
          intended_use: string | null
          internal_code: string | null
          ipi_pct: number
          manufacturer_country: string | null
          margem_minima_pct: number
          model: string
          ncm: string
          numero_processo_anvisa: string | null
          observacoes_preco: string | null
          preco_custo: number
          preco_venda: number
          primary_material: string | null
          reference: string
          regime: string | null
          risk_class: string
          rotulo_udi_ok: boolean
          secondary_material: string | null
          single_use: boolean
          siud_transmitido_em: string | null
          status_regularizacao: string
          sterile: boolean
          surface_treatment: string | null
          udi_di: string | null
          unidade: string
          updated_at: string
        }
        Insert: {
          anvisa_registration?: string | null
          ativo?: boolean
          body_region?: string | null
          brand_name?: string | null
          cfop_padrao?: string
          classification_code: string
          compatible_systems?: Json | null
          created_at?: string
          data_registro_anvisa?: string | null
          data_vencimento_anvisa?: string | null
          desconto_max_pct?: number
          desenho_tecnico_path?: string | null
          empresa_afe?: boolean
          empresa_bpf?: boolean
          empresa_lf?: boolean
          exocad_compatibility?: string | null
          gtin?: string | null
          icon_url?: string | null
          id?: string
          implantable?: boolean
          intended_use?: string | null
          internal_code?: string | null
          ipi_pct?: number
          manufacturer_country?: string | null
          margem_minima_pct?: number
          model: string
          ncm?: string
          numero_processo_anvisa?: string | null
          observacoes_preco?: string | null
          preco_custo?: number
          preco_venda?: number
          primary_material?: string | null
          reference: string
          regime?: string | null
          risk_class: string
          rotulo_udi_ok?: boolean
          secondary_material?: string | null
          single_use?: boolean
          siud_transmitido_em?: string | null
          status_regularizacao?: string
          sterile?: boolean
          surface_treatment?: string | null
          udi_di?: string | null
          unidade?: string
          updated_at?: string
        }
        Update: {
          anvisa_registration?: string | null
          ativo?: boolean
          body_region?: string | null
          brand_name?: string | null
          cfop_padrao?: string
          classification_code?: string
          compatible_systems?: Json | null
          created_at?: string
          data_registro_anvisa?: string | null
          data_vencimento_anvisa?: string | null
          desconto_max_pct?: number
          desenho_tecnico_path?: string | null
          empresa_afe?: boolean
          empresa_bpf?: boolean
          empresa_lf?: boolean
          exocad_compatibility?: string | null
          gtin?: string | null
          icon_url?: string | null
          id?: string
          implantable?: boolean
          intended_use?: string | null
          internal_code?: string | null
          ipi_pct?: number
          manufacturer_country?: string | null
          margem_minima_pct?: number
          model?: string
          ncm?: string
          numero_processo_anvisa?: string | null
          observacoes_preco?: string | null
          preco_custo?: number
          preco_venda?: number
          primary_material?: string | null
          reference?: string
          regime?: string | null
          risk_class?: string
          rotulo_udi_ok?: boolean
          secondary_material?: string | null
          single_use?: boolean
          siud_transmitido_em?: string | null
          status_regularizacao?: string
          sterile?: boolean
          surface_treatment?: string | null
          udi_di?: string | null
          unidade?: string
          updated_at?: string
        }
        Relationships: []
      }
      ferramentas_cnc: {
        Row: {
          codigo: string
          created_at: string
          custo_unitario: number | null
          descricao: string
          fornecedor_id: string | null
          horas_uso: number
          id: string
          maquina_codigo: string | null
          observacoes: string | null
          pecas_produzidas: number
          status: string
          tipo: string
          ultima_troca: string | null
          updated_at: string
          vida_util_horas: number | null
          vida_util_pecas: number
        }
        Insert: {
          codigo: string
          created_at?: string
          custo_unitario?: number | null
          descricao: string
          fornecedor_id?: string | null
          horas_uso?: number
          id?: string
          maquina_codigo?: string | null
          observacoes?: string | null
          pecas_produzidas?: number
          status?: string
          tipo?: string
          ultima_troca?: string | null
          updated_at?: string
          vida_util_horas?: number | null
          vida_util_pecas?: number
        }
        Update: {
          codigo?: string
          created_at?: string
          custo_unitario?: number | null
          descricao?: string
          fornecedor_id?: string | null
          horas_uso?: number
          id?: string
          maquina_codigo?: string | null
          observacoes?: string | null
          pecas_produzidas?: number
          status?: string
          tipo?: string
          ultima_troca?: string | null
          updated_at?: string
          vida_util_horas?: number | null
          vida_util_pecas?: number
        }
        Relationships: [
          {
            foreignKeyName: "ferramentas_cnc_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ferramentas_cnc_maquina_codigo_fkey"
            columns: ["maquina_codigo"]
            isOneToOne: false
            referencedRelation: "maquinas_producao"
            referencedColumns: ["codigo"]
          },
        ]
      }
      feedback_reports: {
        Row: {
          app_version: string | null
          created_at: string
          id: string
          mensagem: string
          pagina: string | null
          status: string
          tipo: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          id?: string
          mensagem: string
          pagina?: string | null
          status?: string
          tipo: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          app_version?: string | null
          created_at?: string
          id?: string
          mensagem?: string
          pagina?: string | null
          status?: string
          tipo?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      financeiro_contas_bancarias: {
        Row: {
          agencia: string
          banco: string
          conta: string
          created_at: string
          created_by: string | null
          envio_automatico_nf: boolean
          id: string
          integracao_ativa: boolean
          open_finance_ativo: boolean
          pix_chave: string | null
          saldo_atual: number
          tipo: string
          token_api_secret_id: string | null
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          agencia: string
          banco: string
          conta: string
          created_at?: string
          created_by?: string | null
          envio_automatico_nf?: boolean
          id?: string
          integracao_ativa?: boolean
          open_finance_ativo?: boolean
          pix_chave?: string | null
          saldo_atual?: number
          tipo?: string
          token_api_secret_id?: string | null
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          agencia?: string
          banco?: string
          conta?: string
          created_at?: string
          created_by?: string | null
          envio_automatico_nf?: boolean
          id?: string
          integracao_ativa?: boolean
          open_finance_ativo?: boolean
          pix_chave?: string | null
          saldo_atual?: number
          tipo?: string
          token_api_secret_id?: string | null
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: []
      }
      financeiro_lancamentos: {
        Row: {
          categoria: string
          chave_nfe: string | null
          created_at: string
          created_by: string | null
          data_lancamento: string
          descricao: string
          fornecedor: string | null
          id: string
          modo_teste: boolean
          nota_fiscal_manual: string | null
          observacoes: string | null
          periodicidade: string | null
          recorrente: boolean
          status_nf: string
          tipo: string
          updated_at: string
          valor: number
          xml_nfe: string | null
        }
        Insert: {
          categoria: string
          chave_nfe?: string | null
          created_at?: string
          created_by?: string | null
          data_lancamento?: string
          descricao: string
          fornecedor?: string | null
          id?: string
          modo_teste?: boolean
          nota_fiscal_manual?: string | null
          observacoes?: string | null
          periodicidade?: string | null
          recorrente?: boolean
          status_nf?: string
          tipo: string
          updated_at?: string
          valor: number
          xml_nfe?: string | null
        }
        Update: {
          categoria?: string
          chave_nfe?: string | null
          created_at?: string
          created_by?: string | null
          data_lancamento?: string
          descricao?: string
          fornecedor?: string | null
          id?: string
          modo_teste?: boolean
          nota_fiscal_manual?: string | null
          observacoes?: string | null
          periodicidade?: string | null
          recorrente?: boolean
          status_nf?: string
          tipo?: string
          updated_at?: string
          valor?: number
          xml_nfe?: string | null
        }
        Relationships: []
      }
      fornecedores: {
        Row: {
          ativo: boolean
          categoria: string
          cep: string | null
          cidade: string | null
          cnpj: string | null
          contato: string | null
          created_at: string
          created_by: string | null
          email: string | null
          endereco: string | null
          id: string
          ie: string | null
          nome_fantasia: string | null
          observacoes: string | null
          prazo_entrega_dias: number
          razao_social: string
          telefone: string | null
          uf: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          categoria?: string
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          contato?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          ie?: string | null
          nome_fantasia?: string | null
          observacoes?: string | null
          prazo_entrega_dias?: number
          razao_social: string
          telefone?: string | null
          uf?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          categoria?: string
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          contato?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          ie?: string | null
          nome_fantasia?: string | null
          observacoes?: string | null
          prazo_entrega_dias?: number
          razao_social?: string
          telefone?: string | null
          uf?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      manuals: {
        Row: {
          created_at: string
          description: string | null
          file_path: string
          file_size: number | null
          id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          file_path: string
          file_size?: number | null
          id?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          file_path?: string
          file_size?: number | null
          id?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      maquinas_producao: {
        Row: {
          codigo: string
          created_at: string
          disponibilidade: number
          fabricante: string | null
          horimetro: number | null
          id: string
          modelo: string | null
          nome: string
          proxima_manutencao: string | null
          setor: string
          status: string
          ultima_manutencao: string | null
          updated_at: string
        }
        Insert: {
          codigo: string
          created_at?: string
          disponibilidade?: number
          fabricante?: string | null
          horimetro?: number | null
          id?: string
          modelo?: string | null
          nome: string
          proxima_manutencao?: string | null
          setor?: string
          status?: string
          ultima_manutencao?: string | null
          updated_at?: string
        }
        Update: {
          codigo?: string
          created_at?: string
          disponibilidade?: number
          fabricante?: string | null
          horimetro?: number | null
          id?: string
          modelo?: string | null
          nome?: string
          proxima_manutencao?: string | null
          setor?: string
          status?: string
          ultima_manutencao?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      materias_primas_producao: {
        Row: {
          codigo: string
          created_at: string
          descricao: string
          estoque_atual: number
          estoque_maximo: number
          estoque_minimo: number
          fornecedor: string | null
          id: string
          localizacao: string | null
          lote_atual: string | null
          ultima_entrada: string | null
          ultima_saida: string | null
          unidade: string
          updated_at: string
        }
        Insert: {
          codigo: string
          created_at?: string
          descricao: string
          estoque_atual?: number
          estoque_maximo?: number
          estoque_minimo?: number
          fornecedor?: string | null
          id?: string
          localizacao?: string | null
          lote_atual?: string | null
          ultima_entrada?: string | null
          ultima_saida?: string | null
          unidade?: string
          updated_at?: string
        }
        Update: {
          codigo?: string
          created_at?: string
          descricao?: string
          estoque_atual?: number
          estoque_maximo?: number
          estoque_minimo?: number
          fornecedor?: string | null
          id?: string
          localizacao?: string | null
          lote_atual?: string | null
          ultima_entrada?: string | null
          ultima_saida?: string | null
          unidade?: string
          updated_at?: string
        }
        Relationships: []
      }
      metas_producao: {
        Row: {
          ano: number
          created_at: string
          created_by: string | null
          id: string
          maquina_codigo: string | null
          mes: number
          meta_disponibilidade_pct: number
          meta_oee_pct: number
          meta_pecas: number
          meta_qualidade_pct: number
        }
        Insert: {
          ano: number
          created_at?: string
          created_by?: string | null
          id?: string
          maquina_codigo?: string | null
          mes: number
          meta_disponibilidade_pct?: number
          meta_oee_pct?: number
          meta_pecas?: number
          meta_qualidade_pct?: number
        }
        Update: {
          ano?: number
          created_at?: string
          created_by?: string | null
          id?: string
          maquina_codigo?: string | null
          mes?: number
          meta_disponibilidade_pct?: number
          meta_oee_pct?: number
          meta_pecas?: number
          meta_qualidade_pct?: number
        }
        Relationships: []
      }
      movimentos_mp_producao: {
        Row: {
          created_at: string
          id: string
          lote: string | null
          materia_prima_desc: string
          materia_prima_id: string | null
          observacoes: string | null
          operador: string
          ordem_producao: string | null
          quantidade: number
          tipo: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          lote?: string | null
          materia_prima_desc: string
          materia_prima_id?: string | null
          observacoes?: string | null
          operador: string
          ordem_producao?: string | null
          quantidade?: number
          tipo?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          lote?: string | null
          materia_prima_desc?: string
          materia_prima_id?: string | null
          observacoes?: string | null
          operador?: string
          ordem_producao?: string | null
          quantidade?: number
          tipo?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movimentos_mp_producao_materia_prima_id_fkey"
            columns: ["materia_prima_id"]
            isOneToOne: false
            referencedRelation: "materias_primas_producao"
            referencedColumns: ["id"]
          },
        ]
      }
      notas_devolucao_troca: {
        Row: {
          avulsa: boolean
          chave_acesso: string | null
          cliente_documento: string | null
          cliente_email: string | null
          cliente_endereco: string | null
          cliente_ie: string | null
          cliente_nome: string
          cliente_telefone: string | null
          created_at: string
          created_by: string | null
          dh_autorizacao: string | null
          id: string
          itens: Json
          modo_teste: boolean
          motivo: string
          natureza_operacao: string | null
          nf_original_chave: string | null
          nf_original_numero: string | null
          numero: string | null
          pedido_id: string | null
          protocolo_sefaz: string | null
          serie: string
          status: string
          status_msg: string | null
          tipo: string
          tipo_nota: string
          tp_nf: string
          updated_at: string
          valor_frete: number
          valor_total: number
          xml_nfe: string | null
        }
        Insert: {
          avulsa?: boolean
          chave_acesso?: string | null
          cliente_documento?: string | null
          cliente_email?: string | null
          cliente_endereco?: string | null
          cliente_ie?: string | null
          cliente_nome: string
          cliente_telefone?: string | null
          created_at?: string
          created_by?: string | null
          dh_autorizacao?: string | null
          id?: string
          itens?: Json
          modo_teste?: boolean
          motivo: string
          natureza_operacao?: string | null
          nf_original_chave?: string | null
          nf_original_numero?: string | null
          numero?: string | null
          pedido_id?: string | null
          protocolo_sefaz?: string | null
          serie?: string
          status?: string
          status_msg?: string | null
          tipo: string
          tipo_nota?: string
          tp_nf?: string
          updated_at?: string
          valor_frete?: number
          valor_total?: number
          xml_nfe?: string | null
        }
        Update: {
          avulsa?: boolean
          chave_acesso?: string | null
          cliente_documento?: string | null
          cliente_email?: string | null
          cliente_endereco?: string | null
          cliente_ie?: string | null
          cliente_nome?: string
          cliente_telefone?: string | null
          created_at?: string
          created_by?: string | null
          dh_autorizacao?: string | null
          id?: string
          itens?: Json
          modo_teste?: boolean
          motivo?: string
          natureza_operacao?: string | null
          nf_original_chave?: string | null
          nf_original_numero?: string | null
          numero?: string | null
          pedido_id?: string | null
          protocolo_sefaz?: string | null
          serie?: string
          status?: string
          status_msg?: string | null
          tipo?: string
          tipo_nota?: string
          tp_nf?: string
          updated_at?: string
          valor_frete?: number
          valor_total?: number
          xml_nfe?: string | null
        }
        Relationships: []
      }
      nfe_sequencia: {
        Row: {
          id: string
          serie: string
          tipo: string
          ultimo_num: number
          updated_at: string | null
        }
        Insert: {
          id?: string
          serie?: string
          tipo?: string
          ultimo_num?: number
          updated_at?: string | null
        }
        Update: {
          id?: string
          serie?: string
          tipo?: string
          ultimo_num?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      notificacoes: {
        Row: {
          created_at: string
          id: string
          lida: boolean
          mensagem: string | null
          pedido_id: string | null
          tipo: string
          titulo: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lida?: boolean
          mensagem?: string | null
          pedido_id?: string | null
          tipo: string
          titulo: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lida?: boolean
          mensagem?: string | null
          pedido_id?: string | null
          tipo?: string
          titulo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_comerciais"
            referencedColumns: ["id"]
          },
        ]
      }
      nao_conformidades: {
        Row: {
          id: string
          numero: string
          setor_origem: Database["public"]["Enums"]["app_role"]
          aberto_por: string
          aberto_por_nome: string | null
          titulo: string
          descricao: string
          envolve_peca: boolean
          device_id: string | null
          lote: string | null
          quantidade_afetada: number | null
          status: string
          decisao: string | null
          numero_decisao: string | null
          analise_qualidade: string | null
          acao_corretiva: string | null
          decidido_por: string | null
          decidido_por_nome: string | null
          decidido_em: string | null
          encerrado_em: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          numero?: string
          setor_origem: Database["public"]["Enums"]["app_role"]
          aberto_por: string
          aberto_por_nome?: string | null
          titulo: string
          descricao: string
          envolve_peca?: boolean
          device_id?: string | null
          lote?: string | null
          quantidade_afetada?: number | null
          status?: string
          decisao?: string | null
          numero_decisao?: string | null
          analise_qualidade?: string | null
          acao_corretiva?: string | null
          decidido_por?: string | null
          decidido_por_nome?: string | null
          decidido_em?: string | null
          encerrado_em?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          numero?: string
          setor_origem?: Database["public"]["Enums"]["app_role"]
          aberto_por?: string
          aberto_por_nome?: string | null
          titulo?: string
          descricao?: string
          envolve_peca?: boolean
          device_id?: string | null
          lote?: string | null
          quantidade_afetada?: number | null
          status?: string
          decisao?: string | null
          numero_decisao?: string | null
          analise_qualidade?: string | null
          acao_corretiva?: string | null
          decidido_por?: string | null
          decidido_por_nome?: string | null
          decidido_em?: string | null
          encerrado_em?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nao_conformidades_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      ordens_planejamento: {
        Row: {
          capacidade: number | null
          created_at: string
          data_fim: string
          data_inicio: string
          id: string
          maquina: string
          numero: string
          prioridade: string
          produto: string
          quantidade: number
          quantidade_produzida: number
          status: string
          turno: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          capacidade?: number | null
          created_at?: string
          data_fim: string
          data_inicio: string
          id?: string
          maquina: string
          numero: string
          prioridade?: string
          produto: string
          quantidade?: number
          quantidade_produzida?: number
          status?: string
          turno?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          capacidade?: number | null
          created_at?: string
          data_fim?: string
          data_inicio?: string
          id?: string
          maquina?: string
          numero?: string
          prioridade?: string
          produto?: string
          quantidade?: number
          quantidade_produzida?: number
          status?: string
          turno?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      paradas_producao: {
        Row: {
          created_at: string
          duracao_min: number | null
          fim: string | null
          id: string
          inicio: string
          maquina: string
          motivo: string
          observacoes: string | null
          operador: string
          tipo: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          duracao_min?: number | null
          fim?: string | null
          id?: string
          inicio?: string
          maquina: string
          motivo: string
          observacoes?: string | null
          operador: string
          tipo?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          duracao_min?: number | null
          fim?: string | null
          id?: string
          inicio?: string
          maquina?: string
          motivo?: string
          observacoes?: string | null
          operador?: string
          tipo?: string
          user_id?: string | null
        }
        Relationships: []
      }
      peca_favoritas: {
        Row: {
          created_at: string
          device_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "peca_favoritas_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "peca_favoritas_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices_regularizacao"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_comentarios: {
        Row: {
          created_at: string
          id: string
          pedido_id: string
          texto: string
          user_id: string
          user_name: string
        }
        Insert: {
          created_at?: string
          id?: string
          pedido_id: string
          texto: string
          user_id: string
          user_name: string
        }
        Update: {
          created_at?: string
          id?: string
          pedido_id?: string
          texto?: string
          user_id?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "pedido_comentarios_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_comerciais"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_compra_itens: {
        Row: {
          created_at: string
          descricao: string
          id: string
          lote_recebido: string | null
          materia_prima_id: string | null
          pedido_id: string
          quantidade: number
          quantidade_recebida: number
          unidade: string
          valor_total: number | null
          valor_unitario: number
        }
        Insert: {
          created_at?: string
          descricao: string
          id?: string
          lote_recebido?: string | null
          materia_prima_id?: string | null
          pedido_id: string
          quantidade: number
          quantidade_recebida?: number
          unidade?: string
          valor_total?: number | null
          valor_unitario?: number
        }
        Update: {
          created_at?: string
          descricao?: string
          id?: string
          lote_recebido?: string | null
          materia_prima_id?: string | null
          pedido_id?: string
          quantidade?: number
          quantidade_recebida?: number
          unidade?: string
          valor_total?: number | null
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "pedido_compra_itens_materia_prima_id_fkey"
            columns: ["materia_prima_id"]
            isOneToOne: false
            referencedRelation: "materias_primas_producao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_compra_itens_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_compra"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_itens: {
        Row: {
          created_at: string
          id: string
          lote: string | null
          pedido_id: string
          preco_unitario: number | null
          quantidade: number
          quantidade_reservada: number
          stock_item_id: string
          valor_total: number | null
          valor_unitario: number
        }
        Insert: {
          created_at?: string
          id?: string
          lote?: string | null
          pedido_id: string
          preco_unitario?: number | null
          quantidade: number
          quantidade_reservada?: number
          stock_item_id: string
          valor_total?: number | null
          valor_unitario?: number
        }
        Update: {
          created_at?: string
          id?: string
          lote?: string | null
          pedido_id?: string
          preco_unitario?: number | null
          quantidade?: number
          quantidade_reservada?: number
          stock_item_id?: string
          valor_total?: number | null
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "pedido_itens_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_comerciais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_itens_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_comerciais: {
        Row: {
          chave_acesso_nfe: string | null
          cliente_id: string
          created_at: string
          desconto_pct: number
          dh_autorizacao_nfe: string | null
          endereco_entrega: string | null
          enviado_em: string | null
          faturado_em: string | null
          faturado_por: string | null
          forma_pagamento: string | null
          frete: number
          id: string
          lotes_separados: Json | null
          nf_criada_em: string | null
          nf_criada_por: string | null
          nota_fiscal: string | null
          observacoes: string | null
          parcelas: number | null
          prazo_entrega: string | null
          protocolo_sefaz: string | null
          rastreio_envio: string | null
          separado_em: string | null
          separado_por: string | null
          status: string
          tipo_nf: string | null
          transportadora: string | null
          updated_at: string
          usar_endereco_cliente: boolean | null
          vendedora_id: string | null
          vendedora_nome: string | null
          xml_nfe: string | null
        }
        Insert: {
          chave_acesso_nfe?: string | null
          cliente_id: string
          created_at?: string
          desconto_pct?: number
          dh_autorizacao_nfe?: string | null
          endereco_entrega?: string | null
          enviado_em?: string | null
          faturado_em?: string | null
          faturado_por?: string | null
          forma_pagamento?: string | null
          frete?: number
          id?: string
          lotes_separados?: Json | null
          nf_criada_em?: string | null
          nf_criada_por?: string | null
          nota_fiscal?: string | null
          observacoes?: string | null
          parcelas?: number | null
          prazo_entrega?: string | null
          protocolo_sefaz?: string | null
          rastreio_envio?: string | null
          separado_em?: string | null
          separado_por?: string | null
          status?: string
          tipo_nf?: string | null
          transportadora?: string | null
          updated_at?: string
          usar_endereco_cliente?: boolean | null
          vendedora_id?: string | null
          vendedora_nome?: string | null
          xml_nfe?: string | null
        }
        Update: {
          chave_acesso_nfe?: string | null
          cliente_id?: string
          created_at?: string
          desconto_pct?: number
          dh_autorizacao_nfe?: string | null
          endereco_entrega?: string | null
          enviado_em?: string | null
          faturado_em?: string | null
          faturado_por?: string | null
          forma_pagamento?: string | null
          frete?: number
          id?: string
          lotes_separados?: Json | null
          nf_criada_em?: string | null
          nf_criada_por?: string | null
          nota_fiscal?: string | null
          observacoes?: string | null
          parcelas?: number | null
          prazo_entrega?: string | null
          protocolo_sefaz?: string | null
          rastreio_envio?: string | null
          separado_em?: string | null
          separado_por?: string | null
          status?: string
          tipo_nf?: string | null
          transportadora?: string | null
          updated_at?: string
          usar_endereco_cliente?: boolean | null
          vendedora_id?: string | null
          vendedora_nome?: string | null
          xml_nfe?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_comerciais_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_compra: {
        Row: {
          created_at: string
          created_by: string | null
          data_pedido: string
          data_previsao: string | null
          data_recebimento: string | null
          fornecedor_id: string | null
          fornecedor_nome: string
          id: string
          nota_fiscal_entrada: string | null
          observacoes: string | null
          status: string
          updated_at: string
          valor_total: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data_pedido?: string
          data_previsao?: string | null
          data_recebimento?: string | null
          fornecedor_id?: string | null
          fornecedor_nome: string
          id?: string
          nota_fiscal_entrada?: string | null
          observacoes?: string | null
          status?: string
          updated_at?: string
          valor_total?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data_pedido?: string
          data_previsao?: string | null
          data_recebimento?: string | null
          fornecedor_id?: string | null
          fornecedor_nome?: string
          id?: string
          nota_fiscal_entrada?: string | null
          observacoes?: string | null
          status?: string
          updated_at?: string
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_compra_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos_producao: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          descricao: string
          dim_altura: number | null
          dim_comprimento: number | null
          dim_diametro: number | null
          dim_largura: number | null
          id: string
          lead_time_dias: number
          pecas_por_hora: number
          peso_gramas: number | null
          tempo_ciclo_seg: number
          tipo_material: string
          unidade_medida: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          descricao: string
          dim_altura?: number | null
          dim_comprimento?: number | null
          dim_diametro?: number | null
          dim_largura?: number | null
          id?: string
          lead_time_dias?: number
          pecas_por_hora?: number
          peso_gramas?: number | null
          tempo_ciclo_seg?: number
          tipo_material?: string
          unidade_medida?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          descricao?: string
          dim_altura?: number | null
          dim_comprimento?: number | null
          dim_diametro?: number | null
          dim_largura?: number | null
          id?: string
          lead_time_dias?: number
          pecas_por_hora?: number
          peso_gramas?: number | null
          tempo_ciclo_seg?: number
          tipo_material?: string
          unidade_medida?: string
          updated_at?: string
        }
        Relationships: []
      }
      programas_cnc: {
        Row: {
          conteudo: string
          created_at: string
          created_by: string | null
          id: string
          linguagem: string
          maquina_codigo: string | null
          nome: string
          updated_at: string
        }
        Insert: {
          conteudo?: string
          created_at?: string
          created_by?: string | null
          id?: string
          linguagem?: string
          maquina_codigo?: string | null
          nome: string
          updated_at?: string
        }
        Update: {
          conteudo?: string
          created_at?: string
          created_by?: string | null
          id?: string
          linguagem?: string
          maquina_codigo?: string | null
          nome?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "programas_cnc_maquina_codigo_fkey"
            columns: ["maquina_codigo"]
            isOneToOne: false
            referencedRelation: "maquinas_producao"
            referencedColumns: ["codigo"]
          },
        ]
      }
      profiles: {
        Row: {
          approved: boolean
          blocked: boolean
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          login: string | null
          must_change_password: boolean
          theme: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          approved?: boolean
          blocked?: boolean
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          login?: string | null
          must_change_password?: boolean
          theme?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          approved?: boolean
          blocked?: boolean
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          login?: string | null
          must_change_password?: boolean
          theme?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rastreabilidade_pos_venda: {
        Row: {
          cirurgiao: string | null
          cliente_id: string | null
          cliente_nome: string
          clinica: string | null
          created_at: string
          data_envio: string
          device_id: string | null
          device_model: string
          device_ref: string
          id: string
          lote: string
          observacoes: string | null
          paciente_codigo: string | null
          pedido_id: string | null
          pedido_item_id: string | null
          quantidade: number
          status_recall: string
          stock_item_id: string | null
          udi_di: string | null
        }
        Insert: {
          cirurgiao?: string | null
          cliente_id?: string | null
          cliente_nome: string
          clinica?: string | null
          created_at?: string
          data_envio: string
          device_id?: string | null
          device_model: string
          device_ref: string
          id?: string
          lote: string
          observacoes?: string | null
          paciente_codigo?: string | null
          pedido_id?: string | null
          pedido_item_id?: string | null
          quantidade: number
          status_recall?: string
          stock_item_id?: string | null
          udi_di?: string | null
        }
        Update: {
          cirurgiao?: string | null
          cliente_id?: string | null
          cliente_nome?: string
          clinica?: string | null
          created_at?: string
          data_envio?: string
          device_id?: string | null
          device_model?: string
          device_ref?: string
          id?: string
          lote?: string
          observacoes?: string | null
          paciente_codigo?: string | null
          pedido_id?: string | null
          pedido_item_id?: string | null
          quantidade?: number
          status_recall?: string
          stock_item_id?: string | null
          udi_di?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rastreabilidade_pos_venda_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rastreabilidade_pos_venda_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rastreabilidade_pos_venda_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices_regularizacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rastreabilidade_pos_venda_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_comerciais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rastreabilidade_pos_venda_pedido_item_id_fkey"
            columns: ["pedido_item_id"]
            isOneToOne: false
            referencedRelation: "pedido_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rastreabilidade_pos_venda_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_log: {
        Row: {
          action: string
          created_at: string
          id: number
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: number
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: number
          user_id?: string
        }
        Relationships: []
      }
      recebimento_materiais: {
        Row: {
          created_at: string
          descricao: string
          fornecedor: string | null
          id: string
          lote: string
          quantity: number
          retirado_em: string | null
          retirado_por: string | null
          status: string
          updated_at: string
          user_display_name: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          descricao: string
          fornecedor?: string | null
          id?: string
          lote: string
          quantity: number
          retirado_em?: string | null
          retirado_por?: string | null
          status?: string
          updated_at?: string
          user_display_name?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          descricao?: string
          fornecedor?: string | null
          id?: string
          lote?: string
          quantity?: number
          retirado_em?: string | null
          retirado_por?: string | null
          status?: string
          updated_at?: string
          user_display_name?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      refugos_producao: {
        Row: {
          created_at: string
          destinacao: string
          id: string
          lote: string
          maquina: string
          medicoes: Json | null
          motivo: string
          observacoes: string | null
          operador: string
          produto: string
          quantidade: number
          tipo_defeito: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          destinacao?: string
          id?: string
          lote: string
          maquina: string
          medicoes?: Json | null
          motivo: string
          observacoes?: string | null
          operador: string
          produto: string
          quantidade?: number
          tipo_defeito?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          destinacao?: string
          id?: string
          lote?: string
          maquina?: string
          medicoes?: Json | null
          motivo?: string
          observacoes?: string | null
          operador?: string
          produto?: string
          quantidade?: number
          tipo_defeito?: string
          user_id?: string | null
        }
        Relationships: []
      }
      stock_backups: {
        Row: {
          created_at: string
          created_by: string | null
          created_name: string | null
          file_path: string | null
          id: string
          item_count: number
          payload: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_name?: string | null
          file_path?: string | null
          id?: string
          item_count?: number
          payload?: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_name?: string | null
          file_path?: string | null
          id?: string
          item_count?: number
          payload?: Json
        }
        Relationships: []
      }
      stock_items: {
        Row: {
          created_at: string
          device_id: string
          fase: string
          id: string
          location: string | null
          min_quantity: number
          notes: string | null
          quantity: number
          quantity_reserved: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          device_id: string
          fase?: string
          id?: string
          location?: string | null
          min_quantity?: number
          notes?: string | null
          quantity?: number
          quantity_reserved?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          device_id?: string
          fase?: string
          id?: string
          location?: string | null
          min_quantity?: number
          notes?: string | null
          quantity?: number
          quantity_reserved?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_items_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_items_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices_regularizacao"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          id: string
          lote: string | null
          quantity: number
          reason: string | null
          stock_item_id: string
          type: string
          user_display_name: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          lote?: string | null
          quantity: number
          reason?: string | null
          stock_item_id: string
          type: string
          user_display_name?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          lote?: string | null
          quantity?: number
          reason?: string | null
          stock_item_id?: string
          type?: string
          user_display_name?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      tipo_parada_producao: {
        Row: {
          ativo: boolean
          categoria: string
          created_at: string
          id: number
          nome: string
        }
        Insert: {
          ativo?: boolean
          categoria?: string
          created_at?: string
          id?: number
          nome: string
        }
        Update: {
          ativo?: boolean
          categoria?: string
          created_at?: string
          id?: number
          nome?: string
        }
        Relationships: []
      }
      tipo_refugo_producao: {
        Row: {
          ativo: boolean
          created_at: string
          id: number
          nome: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: number
          nome: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: number
          nome?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      devices_regularizacao: {
        Row: {
          anvisa_registration: string | null
          brand_name: string | null
          classification_code: string | null
          data_registro_anvisa: string | null
          data_vencimento_anvisa: string | null
          dias_ate_vencer: number | null
          empresa_afe: boolean | null
          empresa_bpf: boolean | null
          empresa_lf: boolean | null
          fase_atual: number | null
          gtin: string | null
          id: string | null
          model: string | null
          numero_processo_anvisa: string | null
          reference: string | null
          regime: string | null
          risk_class: string | null
          rotulo_udi_ok: boolean | null
          siud_transmitido_em: string | null
          status_regularizacao: string | null
          udi_di: string | null
          updated_at: string | null
        }
        Insert: {
          anvisa_registration?: string | null
          brand_name?: string | null
          classification_code?: string | null
          data_registro_anvisa?: string | null
          data_vencimento_anvisa?: string | null
          dias_ate_vencer?: never
          empresa_afe?: boolean | null
          empresa_bpf?: boolean | null
          empresa_lf?: boolean | null
          fase_atual?: never
          gtin?: string | null
          id?: string | null
          model?: string | null
          numero_processo_anvisa?: string | null
          reference?: string | null
          regime?: string | null
          risk_class?: string | null
          rotulo_udi_ok?: boolean | null
          siud_transmitido_em?: string | null
          status_regularizacao?: string | null
          udi_di?: string | null
          updated_at?: string | null
        }
        Update: {
          anvisa_registration?: string | null
          brand_name?: string | null
          classification_code?: string | null
          data_registro_anvisa?: string | null
          data_vencimento_anvisa?: string | null
          dias_ate_vencer?: never
          empresa_afe?: boolean | null
          empresa_bpf?: boolean | null
          empresa_lf?: boolean | null
          fase_atual?: never
          gtin?: string | null
          id?: string | null
          model?: string | null
          numero_processo_anvisa?: string | null
          reference?: string | null
          regime?: string | null
          risk_class?: string | null
          rotulo_udi_ok?: boolean | null
          siud_transmitido_em?: string | null
          status_regularizacao?: string | null
          udi_di?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_device_to_stock_rpc: {
        Args: { p_device_id: string }
        Returns: undefined
      }
      abrir_nao_conformidade: {
        Args: {
          p_titulo: string
          p_descricao: string
          p_envolve_peca?: boolean
          p_device_id?: string | null
          p_lote?: string | null
          p_quantidade_afetada?: number | null
        }
        Returns: Json
      }
      admin_clear_audit_log: { Args: never; Returns: Json }
      admin_clear_comercial: { Args: never; Returns: Json }
      admin_clear_financeiro: { Args: never; Returns: Json }
      admin_clear_history: { Args: never; Returns: undefined }
      admin_clear_producao: { Args: never; Returns: Json }
      admin_clear_rastreabilidade: { Args: never; Returns: Json }
      admin_clear_stock_movements: { Args: never; Returns: Json }
      admin_create_user: {
        Args: {
          p_display_name: string
          p_login: string
          p_password: string
          p_role?: string
        }
        Returns: Json
      }
      admin_delete_user: { Args: { p_target_user_id: string }; Returns: Json }
      admin_regularizar_todos_devices: { Args: never; Returns: Json }
      admin_reset_password: {
        Args: { p_new_password: string; p_target_user_id: string }
        Returns: Json
      }
      atualizar_status_ferramentas: { Args: never; Returns: undefined }
      atualizar_status_vencido: { Args: never; Returns: undefined }
      calcular_oee: {
        Args: { p_data_fim?: string; p_data_ini?: string; p_maquina?: string }
        Returns: Json
      }
      can_write_stock: { Args: never; Returns: boolean }
      cancelar_devolucao_troca: {
        Args: { p_id: string; p_motivo: string }
        Returns: Json
      }
      cancel_movement: {
        Args: { p_movement_id: string; p_stock_item_id: string }
        Returns: Json
      }
      cancel_pedido: { Args: { p_pedido_id: string }; Returns: Json }
      check_rate_limit: {
        Args: { p_action: string; p_user_id?: string }
        Returns: boolean
      }
      cleanup_audit_log: { Args: never; Returns: undefined }
      decidir_nao_conformidade: {
        Args: { p_id: string; p_decisao: string; p_analise: string }
        Returns: Json
      }
      encerrar_nao_conformidade: {
        Args: { p_id: string; p_acao_corretiva: string }
        Returns: Json
      }
      criar_apontamento_ppi51: {
        Args: {
          p_comprimento_mm: number | null
          p_consumo_mp_metros: number | null
          p_cycle_time_min: number
          p_data: string
          p_descricao_mp: string
          p_descricao_produto: string
          p_equipamento: string
          p_horario_fim: number
          p_horario_inicio: number
          p_horas_planejadas: number
          p_lead_time_horas: number
          p_lote: string
          p_lote_mp: string
          p_maquina: string
          p_operador: string
          p_ordem_id?: string | null
          p_paradas?: Json
          p_produto: string
          p_qtde_plan_disp: number
          p_qtde_por_hora: number
          p_qtde_produzida: number
          p_refugos?: Json
          p_turno: string
        }
        Returns: Json
      }
      dashboard_gerencial: { Args: never; Returns: Json }
      delete_stock_item: { Args: { p_stock_item_id: string }; Returns: Json }
      ensure_stock_item_fase: {
        Args: {
          p_device_id: string
          p_fase: string
          p_notes_override?: string | null
          p_source_item_id: string
        }
        Returns: string
      }
      enviar_feedback: {
        Args: {
          p_app_version?: string
          p_mensagem: string
          p_pagina?: string
          p_tipo: string
        }
        Returns: Json
      }
      atualizar_status_feedback: {
        Args: { p_id: string; p_status: string }
        Returns: Json
      }
      listar_feedback_reports: {
        Args: { p_status?: string }
        Returns: {
          app_version: string | null
          created_at: string
          id: string
          mensagem: string
          pagina: string | null
          status: string
          tipo: string
          user_id: string | null
          user_name: string | null
        }[]
      }
      faturar_pedido: {
        Args: {
          p_nf: string
          p_pedido_id: string
          p_user_id: string
          p_user_name: string
        }
        Returns: Json
      }
      faturar_pedido_sefaz: {
        Args: {
          p_chave_acesso: string
          p_dh_autorizacao: string
          p_nf: string
          p_pedido_id: string
          p_protocolo: string
          p_user_id: string
          p_user_name: string
          p_xml_nfe?: string | null
        }
        Returns: Json
      }
      get_devices_regularizacao_counts: { Args: never; Returns: Json }
      get_lotes_intermediario:
        | {
            Args: never
            Returns: {
              lote: string
              model: string
              reference: string
              saldo: number
              stock_item_id: string
            }[]
          }
        | {
            Args: { p_stock_item_id: string }
            Returns: {
              last_movement: string
              lote: string
              saldo: number
            }[]
          }
      get_conta_bancaria_token: {
        Args: { p_conta_id: string }
        Returns: string
      }
      get_my_role: { Args: never; Returns: string }
      get_next_nf_number: {
        Args: { p_serie?: string; p_tipo?: string }
        Returns: number
      }
      get_total_stock_quantity: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_stock_quantity: {
        Args: { p_item_id: string; p_qty: number }
        Returns: undefined
      }
      is_admin_user: { Args: never; Returns: boolean }
      is_approved_user: { Args: never; Returns: boolean }
      load_stock_page: {
        Args: {
          p_device_ids?: string[] | null
          p_limit?: number
          p_offset?: number
          p_search?: string | null
        }
        Returns: Json
      }
      marcar_pedido_pronto: {
        Args: { p_pedido_id: string; p_user_name: string }
        Returns: Json
      }
      obter_saude_sistema: {
        Args: never
        Returns: Json
      }
      peek_next_nf_number: {
        Args: { p_serie?: string; p_tipo?: string }
        Returns: number
      }
      registrar_devolucao_troca: {
        Args: {
          p_chave_acesso: string | null
          p_dh_autorizacao: string | null
          p_id: string
          p_protocolo: string | null
          p_status: string
          p_status_msg: string
          p_xml_nfe?: string | null
        }
        Returns: Json
      }
      remove_pedido_item: {
        Args: { p_pedido_item_id: string }
        Returns: Json
      }
      release_item_reservation: {
        Args: { p_quantity: number; p_stock_item_id: string }
        Returns: undefined
      }
      reserve_stock:
        | { Args: { p_item_id: string; p_qty: number }; Returns: Json }
        | { Args: { p_items: Json; p_pedido_id: string }; Returns: Json }
      resolve_cfop_device: { Args: { p_implantable: boolean }; Returns: string }
      resolve_ncm_device: {
        Args: {
          p_body_region: string
          p_classification: string
          p_implantable: boolean
          p_primary_material: string
          p_risk_class: string
        }
        Returns: string
      }
      resolve_ncm_device_by_id: {
        Args: { p_device_id: string }
        Returns: string
      }
      resumo_mensal_producao: {
        Args: { p_ano?: number; p_mes?: number }
        Returns: Json
      }
      search_devices_for_stock: {
        Args: { p_search: string }
        Returns: string[]
      }
      set_conta_bancaria_token: {
        Args: { p_conta_id: string; p_token: string | null }
        Returns: Json
      }
      set_own_password: { Args: { p_password: string }; Returns: Json }
      set_password_done: { Args: never; Returns: undefined }
      stock_movement_atomic: {
        Args: {
          p_item_id: string
          p_lote: string | null
          p_qty: number
          p_reason: string | null
          p_type: string
          p_user_id: string | null
          p_user_name: string | null
        }
        Returns: Json
      }
      sync_stock_items_from_devices: { Args: never; Returns: Json }
      update_stock_item_settings: {
        Args: {
          p_item_id: string
          p_location?: string | null
          p_min_qty?: number | null
          p_notes?: string | null
        }
        Returns: undefined
      }
      upsert_stock_item_for_device: {
        Args: { p_device_id: string; p_fase?: string }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "estoque"
        | "qualidade"
        | "comercial"
        | "financeiro"
        | "producao"
        | "processos"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: [
        "admin",
        "estoque",
        "qualidade",
        "comercial",
        "financeiro",
        "producao",
        "processos",
      ],
    },
  },
} as const
