-- ── sync_stock_items_from_devices ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_stock_items_from_devices()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inserted_count integer;
BEGIN
  INSERT INTO public.stock_items (device_id, quantity, min_quantity, fase)
  SELECT d.id, 0, 0, 'intermediaria' FROM public.devices d
  WHERE NOT EXISTS (SELECT 1 FROM public.stock_items si WHERE si.device_id = d.id);
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN jsonb_build_object('inserted', inserted_count);
END;
$$;
GRANT EXECUTE ON FUNCTION public.sync_stock_items_from_devices() TO authenticated;
