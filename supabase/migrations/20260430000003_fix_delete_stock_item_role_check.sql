-- Fix: delete_stock_item lia `role` de `profiles`, mas a coluna não existe lá.
-- Roles são armazenados em `public.user_roles`. Corrige a função para usar a tabela certa.

CREATE OR REPLACE FUNCTION public.delete_stock_item(p_stock_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.app_role;
BEGIN
  -- Verifica se quem chama é admin (tabela correta: user_roles, não profiles)
  SELECT role INTO v_role
    FROM public.user_roles
   WHERE user_id = auth.uid()
   LIMIT 1;

  IF v_role IS DISTINCT FROM 'admin'::public.app_role THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Apenas administradores podem excluir peças.');
  END IF;

  -- Deleta pedidos_comerciais que ficarão sem itens após a exclusão
  DELETE FROM public.pedidos_comerciais
   WHERE id IN (
     SELECT DISTINCT pedido_id
       FROM public.pedido_itens
      WHERE stock_item_id = p_stock_item_id
   )
   AND (
     SELECT COUNT(*) FROM public.pedido_itens pi2
      WHERE pi2.pedido_id = pedidos_comerciais.id
        AND pi2.stock_item_id != p_stock_item_id
   ) = 0;

  -- Deleta o stock_item (CASCADE remove pedido_itens e stock_movements)
  DELETE FROM public.stock_items WHERE id = p_stock_item_id;

  RETURN jsonb_build_object('ok', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_stock_item(uuid) TO authenticated;
