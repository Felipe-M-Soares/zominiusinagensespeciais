-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Garante que a coluna quantity_reserved existe (idempotente)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.stock_items
  ADD COLUMN IF NOT EXISTS quantity_reserved integer NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Recalcula quantity_reserved para todos os stock_items a partir dos
--    pedidos ativos (pendente / separando), corrigindo qualquer divergência
--    causada por migrations não aplicadas ou bugs anteriores.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.stock_items si
SET quantity_reserved = COALESCE(agg.total_reservado, 0)
FROM (
  SELECT
    pi.stock_item_id,
    SUM(pi.quantidade_reservada) AS total_reservado
  FROM public.pedido_itens pi
  JOIN public.pedidos_comerciais pc ON pc.id = pi.pedido_id
  WHERE pc.status IN ('pendente', 'separando')
  GROUP BY pi.stock_item_id
) agg
WHERE si.id = agg.stock_item_id;

-- Zera itens que não têm pedidos ativos mas possam ter ficado com valor residual
UPDATE public.stock_items si
SET quantity_reserved = 0
WHERE quantity_reserved > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.pedido_itens pi
    JOIN public.pedidos_comerciais pc ON pc.id = pi.pedido_id
    WHERE pi.stock_item_id = si.id
      AND pc.status IN ('pendente', 'separando')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Substitui reserve_stock para retornar jsonb com status (evita falha
--    silenciosa quando o WHERE não encontra linhas suficientes)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserve_stock(p_item_id uuid, p_qty integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.stock_items
  SET quantity_reserved = quantity_reserved + p_qty
  WHERE id = p_item_id
    AND (quantity - quantity_reserved) >= p_qty;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Estoque insuficiente ou item não encontrado');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;
