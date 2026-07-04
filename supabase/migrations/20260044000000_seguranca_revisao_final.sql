-- =============================================================================
-- SEGURANÇA — Revisão final pós-auditoria
-- =============================================================================
-- Corrige funções SECURITY DEFINER antigas que ainda não tinham search_path fixo
-- e reduz exposição para anon. Não altera fluxo do app.

ALTER FUNCTION public.resolve_ncm_device_by_id(uuid) SET search_path = public;
ALTER FUNCTION public.get_total_stock_quantity() SET search_path = public;
ALTER FUNCTION public.get_devices_regularizacao_counts() SET search_path = public;

REVOKE ALL ON FUNCTION public.resolve_ncm_device_by_id(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_total_stock_quantity() FROM anon;
REVOKE ALL ON FUNCTION public.get_devices_regularizacao_counts() FROM anon;

GRANT EXECUTE ON FUNCTION public.resolve_ncm_device_by_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_total_stock_quantity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_devices_regularizacao_counts() TO authenticated;
