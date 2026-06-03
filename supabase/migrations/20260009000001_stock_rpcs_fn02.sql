-- ── reserve_stock ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserve_stock(p_item_id uuid, p_qty integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_updated integer;
BEGIN
  UPDATE public.stock_items
  SET quantity_reserved = quantity_reserved + p_qty
  WHERE id = p_item_id AND (quantity - quantity_reserved) >= p_qty;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'Estoque insuficiente ou item não encontrado'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;
