CREATE OR REPLACE FUNCTION public.increment_stock_quantity(
  p_item_id uuid, p_qty integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  UPDATE public.stock_items
  SET quantity = quantity + p_qty, updated_at = now()
  WHERE id = p_item_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.increment_stock_quantity(uuid, integer) TO authenticated;
