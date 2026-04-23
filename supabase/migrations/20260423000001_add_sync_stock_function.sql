-- ============================================================
-- Função para sincronizar stock_items com devices
-- Insere um stock_item para cada device que ainda não tem um,
-- com fase 'intermediaria' por padrão.
-- Evita o limite de 1000 linhas da API REST do Supabase.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_stock_items_from_devices()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  inserted_count integer;
BEGIN
  -- Insere stock_items para devices que ainda não possuem um
  INSERT INTO public.stock_items (device_id, quantity, min_quantity, fase)
  SELECT d.id, 0, 0, 'intermediaria'
  FROM public.devices d
  WHERE NOT EXISTS (
    SELECT 1 FROM public.stock_items si WHERE si.device_id = d.id
  );

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  RETURN jsonb_build_object('inserted', inserted_count);
END;
$$;

-- Permissão: apenas admins podem chamar via RPC
REVOKE ALL ON FUNCTION public.sync_stock_items_from_devices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_stock_items_from_devices() TO authenticated;
-- A verificação de admin é feita no código antes de chamar
