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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
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
      devices: {
        Row: {
          anvisa_registration: string
          body_region: string
          brand_name: string
          classification_code: string
          compatible_systems: Json | null
          created_at: string
          exocad_compatibility: string
          icon_url: string | null
          id: string
          implantable: boolean
          intended_use: string
          internal_code: string
          manufacturer_country: string
          model: string
          primary_material: string
          reference: string
          risk_class: string
          secondary_material: string | null
          single_use: boolean
          sterile: boolean
          surface_treatment: string | null
          udi_di: string
          updated_at: string
        }
        Insert: {
          anvisa_registration: string
          body_region: string
          brand_name?: string
          classification_code: string
          compatible_systems?: Json | null
          created_at?: string
          exocad_compatibility?: string
          icon_url?: string | null
          id?: string
          implantable?: boolean
          intended_use: string
          internal_code: string
          manufacturer_country?: string
          model: string
          primary_material: string
          reference: string
          risk_class: string
          secondary_material?: string | null
          single_use?: boolean
          sterile?: boolean
          surface_treatment?: string | null
          udi_di: string
          updated_at?: string
        }
        Update: {
          anvisa_registration?: string
          body_region?: string
          brand_name?: string
          classification_code?: string
          compatible_systems?: Json | null
          created_at?: string
          exocad_compatibility?: string
          icon_url?: string | null
          id?: string
          implantable?: boolean
          intended_use?: string
          internal_code?: string
          manufacturer_country?: string
          model?: string
          primary_material?: string
          reference?: string
          risk_class?: string
          secondary_material?: string | null
          single_use?: boolean
          sterile?: boolean
          surface_treatment?: string | null
          udi_di?: string
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
      profiles: {
        Row: {
          approved: boolean
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approved?: boolean
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approved?: boolean
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
          user_id?: string
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
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      // SEG-FIX: funções de limpeza de histórico por módulo (admin only),
      // todas sem parâmetros, retornam { ok, deleted? }. Já existiam no banco
      // (ver supabase/migrations/20260027000000_estoque.sql e
      // 20260034000000_empresarial.sql) mas nunca tinham sido adicionadas
      // aqui — por isso toda chamada via supabase.rpc(...) dava erro de tipo.
      admin_clear_stock_movements: {
        Args: Record<string, never>
        Returns: { ok: boolean; error?: string; deleted?: number }
      }
      admin_clear_comercial: {
        Args: Record<string, never>
        Returns: { ok: boolean; error?: string; deleted?: number }
      }
      admin_clear_producao: {
        Args: Record<string, never>
        Returns: { ok: boolean; error?: string; deleted?: number }
      }
      admin_clear_rastreabilidade: {
        Args: Record<string, never>
        Returns: { ok: boolean; error?: string; deleted?: number }
      }
      admin_clear_financeiro: {
        Args: Record<string, never>
        Returns: { ok: boolean; error?: string; deleted?: number }
      }
      admin_clear_audit_log: {
        Args: Record<string, never>
        Returns: { ok: boolean; error?: string; deleted?: number }
      }
      // reserve_stock(p_item_id, p_qty) — versão correta, que checa estoque
      // disponível e falha com ok:false se insuficiente (ver
      // 20260027000000_estoque.sql). Existe um overload mais antigo
      // reserve_stock(p_pedido_id, p_items) que nunca falha — evitar usá-lo.
      reserve_stock: {
        Args: { p_item_id: string; p_qty: number }
        Returns: { ok: boolean; error?: string }
      }
      // set_conta_bancaria_token / get_conta_bancaria_token — gravam/leem o
      // token de integração bancária via Supabase Vault (ver
      // 20260029000000_seguranca.sql). O valor real nunca fica em texto
      // puro na tabela financeiro_contas_bancarias.
      set_conta_bancaria_token: {
        Args: { p_conta_id: string; p_token: string | null }
        Returns: { ok: boolean; error?: string }
      }
      get_conta_bancaria_token: {
        Args: { p_conta_id: string }
        Returns: string | null
      }
    }
    Enums: {
      /** SYNC: Manter sincronizado com src/types/roles.ts e supabase/functions/admin-create-user/index.ts
       *  Para gerar automaticamente: npx supabase gen types typescript --local > src/integrations/supabase/types.ts */
      app_role: "admin" | "estoque" | "qualidade" | "comercial" | "financeiro" | "producao"
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
  public: {
    Enums: {
      app_role: ["admin", "estoque", "qualidade", "comercial", "financeiro", "producao"],
    },
  },
} as const
