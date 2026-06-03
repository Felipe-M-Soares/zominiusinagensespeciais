CREATE OR REPLACE FUNCTION public.get_lotes_intermediario(p_stock_item_id uuid)
RETURNS TABLE(lote text, saldo integer, last_movement timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;  -- SEG-02: rejeita não autenticados

  RETURN QUERY
    SELECT
      sm.lote,
      SUM(CASE WHEN sm.type='entrada' THEN sm.quantity ELSE -sm.quantity END)::integer AS saldo,
      MAX(sm.created_at) AS last_movement
    FROM public.stock_movements sm
    WHERE sm.stock_item_id = p_stock_item_id
      AND sm.lote IS NOT NULL
    GROUP BY sm.lote
    HAVING SUM(CASE WHEN sm.type='entrada' THEN sm.quantity ELSE -sm.quantity END) > 0
    ORDER BY last_movement DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_lotes_intermediario(uuid) TO authenticated;
