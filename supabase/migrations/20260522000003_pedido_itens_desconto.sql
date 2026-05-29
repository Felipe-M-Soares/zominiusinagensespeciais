-- Adiciona coluna de desconto por item do pedido (0–100%, múltiplo de 5)
ALTER TABLE public.pedido_itens
  ADD COLUMN IF NOT EXISTS desconto_pct integer NOT NULL DEFAULT 0
  CONSTRAINT pedido_itens_desconto_pct_check CHECK (desconto_pct >= 0 AND desconto_pct <= 100);

COMMENT ON COLUMN public.pedido_itens.desconto_pct IS
  'Desconto em % aplicado a este item (0–100, múltiplo de 5). Visível no financeiro.';
