CREATE OR REPLACE FUNCTION public.stock_movement_atomic(
  p_item_id   uuid,
  p_type      text,
  p_qty       integer,
  p_reason    text,
  p_lote      text,
  p_user_id   uuid,
  p_user_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_current integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;
  IF p_type NOT IN ('entrada','saida') THEN RETURN jsonb_build_object('ok', false, 'error', 'Tipo inválido'); END IF;
  IF p_qty <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'Quantidade deve ser > 0'); END IF;

  SELECT quantity INTO v_current FROM public.stock_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado'); END IF;

  IF p_type = 'saida' AND v_current < p_qty THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Estoque insuficiente: ' || v_current || ' disponível, ' || p_qty || ' solicitado');
  END IF;

  UPDATE public.stock_items
  SET quantity = CASE WHEN p_type = 'entrada' THEN quantity + p_qty ELSE GREATEST(0, quantity - p_qty) END,
      updated_at = now()
  WHERE id = p_item_id;

  INSERT INTO public.stock_movements (stock_item_id, type, quantity, reason, lote, user_id, user_display_name)
  VALUES (p_item_id, p_type, p_qty, p_reason, p_lote, p_user_id, p_user_name);

  RETURN jsonb_build_object('ok', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.stock_movement_atomic(uuid,text,integer,text,text,uuid,text) TO authenticated;
