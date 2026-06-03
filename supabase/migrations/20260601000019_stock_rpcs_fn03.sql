-- ── stock_movement_atomic ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stock_movement_atomic(
  p_item_id uuid, p_type text, p_qty integer,
  p_reason text, p_lote text, p_user_id uuid, p_user_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new_qty integer;
BEGIN
  IF p_type = 'saida' THEN
    UPDATE public.stock_items SET quantity = quantity - p_qty, updated_at = now()
    WHERE id = p_item_id AND quantity >= p_qty RETURNING quantity INTO v_new_qty;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Estoque insuficiente'); END IF;
  ELSE
    UPDATE public.stock_items SET quantity = quantity + p_qty, updated_at = now()
    WHERE id = p_item_id RETURNING quantity INTO v_new_qty;
  END IF;
  INSERT INTO public.stock_movements(stock_item_id, type, quantity, reason, lote, user_id, user_display_name)
  VALUES (p_item_id, p_type, p_qty, p_reason, p_lote, p_user_id, p_user_name);
  RETURN jsonb_build_object('ok', true, 'new_quantity', v_new_qty);
END;
$$;
