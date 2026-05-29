-- Move desconto do pedido_itens para pedidos_comerciais (1 desconto por pedido).
-- Remove a coluna antiga em pedido_itens se existir, adiciona em pedidos_comerciais.
ALTER TABLE public.pedido_itens
  DROP COLUMN IF EXISTS desconto_pct;

ALTER TABLE public.pedidos_comerciais
  ADD COLUMN IF NOT EXISTS desconto_pct integer NOT NULL DEFAULT 0
  CONSTRAINT pedidos_comerciais_desconto_pct_check CHECK (desconto_pct >= 0 AND desconto_pct <= 100);

COMMENT ON COLUMN public.pedidos_comerciais.desconto_pct IS
  'Desconto em % aplicado a todos os itens deste pedido (0-100, multiplo de 5).';
