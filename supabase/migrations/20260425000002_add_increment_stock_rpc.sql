-- ============================================================
-- RPC: increment_stock_quantity
-- ============================================================
-- Incrementa atomicamente a quantidade de um stock_item.
-- Usado por registerMovement() para evitar race condition
-- em operações de entrada (leitura + escrita não atômica).
-- ============================================================

CREATE OR REPLACE FUNCTION public.increment_stock_quantity(
  p_item_id uuid,
  p_qty     integer
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.stock_items
  SET quantity = quantity + p_qty,
      updated_at = now()
  WHERE id = p_item_id;
$$;

-- Permissão: apenas usuários autenticados e aprovados
REVOKE ALL ON FUNCTION public.increment_stock_quantity FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_stock_quantity TO authenticated;
