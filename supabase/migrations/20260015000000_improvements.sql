-- =============================================================================
-- 015: Melhorias de performance, segurança e integridade
-- =============================================================================

-- ── 1. Índice composto em stock_movements (stock_item_id, lote, type) ─────────
-- Acelera fetchLotesSummaryBatch e fetchLotesDisponivelBatch que filtram
-- por stock_item_id + lote + type em batch. Evita bitmap scan.
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_lote_type
  ON public.stock_movements (stock_item_id, lote, type)
  WHERE lote IS NOT NULL;

-- Índice cobrindo quantity para index-only scan em cálculos de saldo
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_lote_covering
  ON public.stock_movements (stock_item_id, lote, type, quantity)
  WHERE lote IS NOT NULL;

-- ── 2. Índice composto em pedido_itens (pedido_id, stock_item_id) ─────────────
-- Cobre as subqueries do RPC marcar_pedido_pronto e recálculo de reservas
CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido_stock
  ON public.pedido_itens (pedido_id, stock_item_id);

-- ── 3. CHECK constraint: quantity_reserved não pode ser negativo ──────────────
DO $f01$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stock_items_quantity_reserved_non_negative'
      AND conrelid = 'public.stock_items'::regclass
  ) THEN
    ALTER TABLE public.stock_items
      ADD CONSTRAINT stock_items_quantity_reserved_non_negative
      CHECK (quantity_reserved >= 0);
  END IF;
END $f01$;

-- ── 4. Tabela de auditoria de ações críticas ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name   text,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  details     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_audit_log_user       ON public.audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity     ON public.audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created    ON public.audit_log (created_at DESC);

-- Admins vêem tudo; usuários vêem suas próprias ações
DROP POLICY IF EXISTS "audit_log_admin_select" ON public.audit_log;
CREATE POLICY "audit_log_admin_select" ON public.audit_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "audit_log_self_select" ON public.audit_log;
CREATE POLICY "audit_log_self_select" ON public.audit_log
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "audit_log_insert" ON public.audit_log;
CREATE POLICY "audit_log_insert" ON public.audit_log
  FOR INSERT WITH CHECK (true);

-- ── 5. Guard no faturar_pedido_sefaz: idempotência ────────────────────────────
CREATE OR REPLACE FUNCTION public.faturar_pedido_sefaz(
  p_pedido_id uuid, p_nf text, p_chave_acesso text, p_protocolo text,
  p_dh_autorizacao timestamptz, p_user_id uuid, p_user_name text,
  p_xml_nfe text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f02$
DECLARE v_status text; v_nf_existente text;
BEGIN
  SELECT status, nota_fiscal INTO v_status, v_nf_existente
  FROM public.pedidos_comerciais WHERE id = p_pedido_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado');
  END IF;

  -- Idempotência: se já faturado com a mesma NF, retorna sucesso sem re-processar
  IF v_nf_existente = p_nf THEN
    RETURN jsonb_build_object('ok', true, 'already_faturado', true);
  END IF;

  -- Apenas pedidos no status 'pronto' podem ser faturados
  IF v_status NOT IN ('pronto') THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'Pedido deve estar no status "pronto" para ser faturado. Status atual: ' || v_status);
  END IF;

  UPDATE public.pedidos_comerciais SET
    status='enviado', nota_fiscal=p_nf, chave_acesso_nfe=p_chave_acesso,
    protocolo_sefaz=p_protocolo, dh_autorizacao_nfe=p_dh_autorizacao,
    nf_criada_por=p_user_id, nf_criada_em=now(), enviado_em=now(), xml_nfe=p_xml_nfe
  WHERE id = p_pedido_id;

  -- Registra na auditoria
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (p_user_id, p_user_name, 'faturar_nf', 'pedido_comercial', p_pedido_id,
    jsonb_build_object('nota_fiscal', p_nf, 'protocolo', p_protocolo));

  RETURN jsonb_build_object('ok', true);
END; $f02$;

GRANT EXECUTE ON FUNCTION public.faturar_pedido_sefaz(uuid,text,text,text,timestamptz,uuid,text,text) TO authenticated;

-- ── 6. Campo rastreio_envio em pedidos_comerciais ─────────────────────────────
ALTER TABLE public.pedidos_comerciais
  ADD COLUMN IF NOT EXISTS rastreio_envio text,
  ADD COLUMN IF NOT EXISTS transportadora text;

CREATE INDEX IF NOT EXISTS idx_pedidos_rastreio
  ON public.pedidos_comerciais (rastreio_envio) WHERE rastreio_envio IS NOT NULL;

