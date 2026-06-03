-- ── increment_stock_quantity ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_stock_quantity(p_item_id uuid, p_qty integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.stock_items SET quantity = quantity + p_qty, updated_at = now() WHERE id = p_item_id;
$$;
GRANT EXECUTE ON FUNCTION public.increment_stock_quantity TO authenticated;
