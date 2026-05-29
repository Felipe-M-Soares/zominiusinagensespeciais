-- ============================================================
-- Fix: excluir stock_item com cascata total + função RPC segura
-- ============================================================

-- 1. Garante CASCADE na FK pedido_itens → stock_items
ALTER TABLE public.pedido_itens
  DROP CONSTRAINT IF EXISTS pedido_itens_stock_item_id_fkey;

ALTER TABLE public.pedido_itens
  ADD CONSTRAINT pedido_itens_stock_item_id_fkey
    FOREIGN KEY (stock_item_id)
    REFERENCES public.stock_items(id)
    ON DELETE CASCADE;

-- 2. Garante CASCADE na FK stock_movements → stock_items
ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_stock_item_id_fkey;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_stock_item_id_fkey
    FOREIGN KEY (stock_item_id)
    REFERENCES public.stock_items(id)
    ON DELETE CASCADE;

-- 3. Função RPC para deletar stock_item com SECURITY DEFINER (bypass RLS)
--    Só admins podem chamar (verifica role na tabela profiles)
CREATE OR REPLACE FUNCTION public.delete_stock_item(p_stock_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  -- Verifica se quem chama é admin
  SELECT role INTO v_role
    FROM public.profiles
   WHERE user_id = auth.uid()
   LIMIT 1;

  IF v_role IS DISTINCT FROM 'admin' THEN
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

-- Permite que usuários autenticados chamem a função
GRANT EXECUTE ON FUNCTION public.delete_stock_item(uuid) TO authenticated;
