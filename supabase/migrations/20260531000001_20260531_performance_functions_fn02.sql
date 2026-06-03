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
