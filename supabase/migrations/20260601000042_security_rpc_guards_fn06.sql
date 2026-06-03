CREATE OR REPLACE FUNCTION public.sync_stock_items_from_devices()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'Requer role admin'; END IF;

  INSERT INTO public.stock_items (device_id, quantity, min_quantity, fase)
  SELECT d.id, 0, 0, 'intermediaria'
  FROM public.devices d
  WHERE NOT EXISTS (
    SELECT 1 FROM public.stock_items si
    WHERE si.device_id = d.id AND si.fase = 'intermediaria'
  )
  ON CONFLICT DO NOTHING;
END; $$;
GRANT EXECUTE ON FUNCTION public.sync_stock_items_from_devices() TO authenticated;
