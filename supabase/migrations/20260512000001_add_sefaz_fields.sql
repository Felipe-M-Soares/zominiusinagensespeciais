-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Integração SEFAZ — NF-e / NFC-e
-- Arquivo: supabase/migrations/20260512000001_add_sefaz_fields.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Novos campos SEFAZ na tabela pedidos_comerciais
ALTER TABLE public.pedidos_comerciais
  ADD COLUMN IF NOT EXISTS chave_acesso_nfe    text,        -- 44 dígitos
  ADD COLUMN IF NOT EXISTS protocolo_sefaz     text,        -- nProt retornado
  ADD COLUMN IF NOT EXISTS dh_autorizacao_nfe  timestamptz, -- dhRecbto SEFAZ
  ADD COLUMN IF NOT EXISTS tipo_nf             text         -- 'nfe' | 'nfce'
    CHECK (tipo_nf IN ('nfe', 'nfce'));

-- 2. Novos campos SEFAZ na tabela clientes (para pré-preencher o modal)
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS documento  text,   -- CPF / CNPJ (já existia, é idempotente)
  ADD COLUMN IF NOT EXISTS ie         text,   -- Inscrição Estadual
  ADD COLUMN IF NOT EXISTS cep        text,
  ADD COLUMN IF NOT EXISTS logradouro text,
  ADD COLUMN IF NOT EXISTS numero     text,
  ADD COLUMN IF NOT EXISTS bairro     text,
  ADD COLUMN IF NOT EXISTS municipio  text,
  ADD COLUMN IF NOT EXISTS uf         char(2),
  ADD COLUMN IF NOT EXISTS c_mun      char(7), -- Código IBGE do município
  ADD COLUMN IF NOT EXISTS ind_ie_dest int DEFAULT 9; -- 9 = Não contribuinte

-- 3. Índice para consulta por chave de acesso
CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_chave_acesso
  ON public.pedidos_comerciais (chave_acesso_nfe)
  WHERE chave_acesso_nfe IS NOT NULL;

-- 4. RPC atômico: faturar_pedido_sefaz
--    Substitui faturar_pedido para incluir campos SEFAZ.
--    Mantém compatibilidade: faturar_pedido original continua existindo.
CREATE OR REPLACE FUNCTION public.faturar_pedido_sefaz(
  p_pedido_id      uuid,
  p_nf             text,    -- ex: "NF-E-000001"
  p_chave_acesso   text,
  p_protocolo      text,
  p_dh_autorizacao timestamptz,
  p_user_id        uuid,
  p_user_name      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
BEGIN
  -- 1. Atualiza pedido com dados SEFAZ e avança para faturado
  UPDATE public.pedidos_comerciais
  SET
    status              = 'faturado',
    nota_fiscal         = p_nf,
    chave_acesso_nfe    = p_chave_acesso,
    protocolo_sefaz     = p_protocolo,
    dh_autorizacao_nfe  = p_dh_autorizacao,
    nf_criada_por       = p_user_id,
    nf_criada_em        = now(),
    enviado_em          = now()           -- financeiro emite + envia no mesmo ato
  WHERE id = p_pedido_id AND status = 'pronto';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Pedido não encontrado ou status inválido');
  END IF;

  -- 2. Baixa estoque + libera reserva atomicamente para cada item
  FOR v_item IN
    SELECT pi.stock_item_id, pi.quantidade, pi.lote
    FROM public.pedido_itens pi
    WHERE pi.pedido_id = p_pedido_id
  LOOP
    UPDATE public.stock_items
    SET
      quantity          = GREATEST(0, quantity - v_item.quantidade),
      quantity_reserved = GREATEST(0, quantity_reserved - v_item.quantidade)
    WHERE id = v_item.stock_item_id;

    INSERT INTO public.stock_movements (
      stock_item_id, type, quantity, reason, lote, user_id, user_display_name
    ) VALUES (
      v_item.stock_item_id,
      'saida',
      v_item.quantidade,
      'SEFAZ ' || p_nf || ' | Prot: ' || p_protocolo,
      v_item.lote,
      p_user_id,
      p_user_name
    );
  END LOOP;

  -- 3. Avança status para 'enviado' (emissão + envio são simultâneos no fluxo)
  UPDATE public.pedidos_comerciais
  SET status = 'enviado'
  WHERE id = p_pedido_id;

  RETURN jsonb_build_object('ok', true, 'protocolo', p_protocolo);
END;
$$;

-- Grant de execução para usuários autenticados (RLS aplicada internamente)
GRANT EXECUTE ON FUNCTION public.faturar_pedido_sefaz TO authenticated;
