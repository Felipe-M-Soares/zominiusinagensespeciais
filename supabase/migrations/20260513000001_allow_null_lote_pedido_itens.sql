-- Permite lote NULL em pedido_itens.
-- O lote é definido pelo estoque no momento da separação (FIFO).
-- Pedidos criados pela área comercial não têm lote no momento da criação.
ALTER TABLE public.pedido_itens
  ALTER COLUMN lote DROP NOT NULL;
