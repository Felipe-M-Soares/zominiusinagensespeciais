-- Adiciona coluna lote nos movimentos de estoque
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS lote text;

-- Índice para buscas por lote
CREATE INDEX IF NOT EXISTS idx_stock_movements_lote
  ON public.stock_movements (lote)
  WHERE lote IS NOT NULL;
