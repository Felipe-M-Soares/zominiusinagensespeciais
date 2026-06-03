CREATE OR REPLACE FUNCTION public.reserve_stock(
  p_pedido_id uuid,
  p_items jsonb  -- [{stock_item_id, quantidade}]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item jsonb; v_id uuid; v_qty integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_id  := (v_item->>'stock_item_id')::uuid;
    v_qty := (v_item->>'quantidade')::integer;
    UPDATE public.stock_items
    SET quantity_reserved = LEAST(quantity, quantity_reserved + v_qty), updated_at = now()
    WHERE id = v_id;
  END LOOP;
  RETURN jsonb_build_object('ok', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.reserve_stock(uuid, jsonb) TO authenticated;
