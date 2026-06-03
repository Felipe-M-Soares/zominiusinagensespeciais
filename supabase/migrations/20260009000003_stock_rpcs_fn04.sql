-- ── cancel_movement ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_movement(p_movement_id uuid, p_stock_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_movement public.stock_movements%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;
  SELECT * INTO v_movement FROM public.stock_movements WHERE id = p_movement_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Movimento não encontrado'); END IF;
  IF v_movement.type = 'entrada' THEN
    UPDATE public.stock_items SET quantity = GREATEST(0, quantity - v_movement.quantity) WHERE id = p_stock_item_id;
  ELSE
    UPDATE public.stock_items SET quantity = quantity + v_movement.quantity WHERE id = p_stock_item_id;
  END IF;
  DELETE FROM public.stock_movements WHERE id = p_movement_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
