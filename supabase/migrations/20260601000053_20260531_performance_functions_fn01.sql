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
