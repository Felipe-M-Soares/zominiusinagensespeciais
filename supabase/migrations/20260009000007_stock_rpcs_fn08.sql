-- ── get_lotes_intermediario ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_lotes_intermediario()
RETURNS TABLE (stock_item_id uuid, lote text, saldo integer, model text, reference text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT si.id, upper(sm.lote), SUM(CASE sm.type WHEN 'entrada' THEN sm.quantity WHEN 'saida' THEN -sm.quantity ELSE 0 END)::integer,
    d.model, d.reference
  FROM public.stock_items si
  JOIN public.devices d ON d.id = si.device_id
  JOIN public.stock_movements sm ON sm.stock_item_id = si.id
  WHERE si.fase = 'intermediaria' AND sm.lote IS NOT NULL
    AND trim(lower(sm.lote)) NOT IN ('a-definir','a definir','sem lote')
    AND (sm.reason IS NULL OR sm.reason NOT IN (
      'Rollback — falha ao criar item de retrabalho',
      'Rollback — falha ao criar item de expedição',
      'Rollback — falha ao registrar entrada na expedição'))
  GROUP BY si.id, upper(sm.lote), d.model, d.reference
  HAVING SUM(CASE sm.type WHEN 'entrada' THEN sm.quantity WHEN 'saida' THEN -sm.quantity ELSE 0 END) > 0
  ORDER BY d.model, upper(sm.lote);
$$;
GRANT EXECUTE ON FUNCTION public.get_lotes_intermediario() TO authenticated;
