BEGIN;
-- PERF-04: Funções aggregate para evitar paginação de milhares de rows no cliente

-- Retorna soma total de peças no estoque (quantity > 0)
CREATE OR REPLACE FUNCTION get_total_stock_quantity()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(SUM(quantity)::integer, 0)
  FROM stock_items
  WHERE quantity > 0;
$$;

-- Retorna total de devices em regularização por fase
CREATE OR REPLACE FUNCTION get_devices_regularizacao_counts()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT json_build_object(
    'total',       COUNT(*),
    'fase_1',      COUNT(*) FILTER (WHERE fase_atual = 1),
    'fase_2',      COUNT(*) FILTER (WHERE fase_atual = 2),
    'fase_3',      COUNT(*) FILTER (WHERE fase_atual = 3),
    'fase_4',      COUNT(*) FILTER (WHERE fase_atual = 4),
    'fase_5',      COUNT(*) FILTER (WHERE fase_atual = 5),
    'pendentes',   COUNT(*) FILTER (WHERE fase_atual < 5),
    'em_processo', COUNT(*) FILTER (WHERE fase_atual = 3 AND status_regularizacao = 'em_processo'),
    'vencendo',    COUNT(*) FILTER (WHERE dias_ate_vencer IS NOT NULL AND dias_ate_vencer < 365)
  )
  FROM devices_regularizacao;
$$;

GRANT EXECUTE ON FUNCTION get_total_stock_quantity() TO authenticated;
GRANT EXECUTE ON FUNCTION get_devices_regularizacao_counts() TO authenticated;

COMMIT;
