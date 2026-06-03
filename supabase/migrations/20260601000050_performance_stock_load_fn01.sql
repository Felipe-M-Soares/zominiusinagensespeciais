-- ── RPC auxiliar: search_devices_for_stock ────────────────────────────────────
-- Resolve busca textual no servidor usando índices GIN trgm.
-- Chamado pelo cliente ANTES de load_stock_page quando há termo de busca.
-- Fix: guard auth.uid() adicionado (estava ausente na versão anterior).
CREATE OR REPLACE FUNCTION public.search_devices_for_stock(p_search text)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- SEG: rejeita chamadas não autenticadas (padrão do projeto)
  IF auth.uid() IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  RETURN ARRAY(
    SELECT id FROM public.devices
    WHERE
      model               ILIKE '%' || p_search || '%' OR
      reference           ILIKE '%' || p_search || '%' OR
      udi_di              ILIKE '%' || p_search || '%' OR
      internal_code       ILIKE '%' || p_search || '%' OR
      anvisa_registration ILIKE '%' || p_search || '%' OR
      brand_name          ILIKE '%' || p_search || '%'
    LIMIT 500
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.search_devices_for_stock(text) TO authenticated;
