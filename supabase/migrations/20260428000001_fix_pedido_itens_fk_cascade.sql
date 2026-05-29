-- Corrige FK de stock_item_id em pedido_itens:
-- Muda de ON DELETE RESTRICT → ON DELETE CASCADE
-- Assim ao excluir um stock_item, os itens do pedido vinculados são removidos automaticamente.

ALTER TABLE public.pedido_itens
  DROP CONSTRAINT IF EXISTS pedido_itens_stock_item_id_fkey;

ALTER TABLE public.pedido_itens
  ADD CONSTRAINT pedido_itens_stock_item_id_fkey
    FOREIGN KEY (stock_item_id)
    REFERENCES public.stock_items(id)
    ON DELETE CASCADE;
