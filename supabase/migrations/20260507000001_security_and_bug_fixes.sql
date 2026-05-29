-- =============================================================================
-- SECURITY & BUG FIXES — 2026-05-07
-- Corrige: BUG-01, SEG-01, SEG-02, SEG-03 (parcial DB), PERF-02
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- BUG-01: reserve_stock retornava void — falha silenciosa em estoque insuficiente
-- Agora retorna boolean: true = reservado com sucesso, false = estoque insuficiente
-- DROP obrigatório antes do CREATE: Postgres não permite alterar tipo de retorno
-- de função existente via CREATE OR REPLACE (erro 42P13).
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.reserve_stock(uuid, integer);
CREATE OR REPLACE FUNCTION public.reserve_stock(p_item_id uuid, p_qty integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.stock_items
  SET quantity_reserved = quantity_reserved + p_qty
  WHERE id = p_item_id
    AND (quantity - quantity_reserved) >= p_qty;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;  -- true = reservado, false = estoque insuficiente
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SEG-01: pedido_itens DELETE permitia qualquer usuário autenticado
-- Corrige: restringir DELETE apenas a admins
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "pedido_itens_delete" ON public.pedido_itens;

CREATE POLICY "pedido_itens_delete" ON public.pedido_itens
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- SEG-02: admin_clear_history — operação atômica server-side com verificação
-- de role, substituindo as deletes sequenciais não-transacionais do frontend
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_clear_history()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Verificação server-side de role — não pode ser bypassada pelo frontend
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores podem apagar o histórico';
  END IF;

  -- Deleta na ordem correta respeitando FKs, dentro de uma única transação
  DELETE FROM public.pedido_itens;
  DELETE FROM public.pedidos_comerciais;
  DELETE FROM public.stock_movements;
  UPDATE public.stock_items
    SET quantity = 0, quantity_reserved = 0;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PERF-02: Índice GIN em stock_movements.lote para buscas ILIKE eficientes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_stock_movements_lote_trgm
  ON public.stock_movements USING GIN (lote gin_trgm_ops)
  WHERE lote IS NOT NULL;

-- Índice simples adicional para busca exata por lote (igualdade)
CREATE INDEX IF NOT EXISTS idx_stock_movements_lote
  ON public.stock_movements (lote)
  WHERE lote IS NOT NULL;

ANALYZE public.stock_movements;
