-- ============================================================
-- FIX: Permite múltiplos itens de retrabalho por device (um por lote)
-- ============================================================
-- O problema: a constraint UNIQUE(device_id, fase) impede criar mais de
-- um stock_item de retrabalho por device. Mas o código cria um item
-- separado por lote dentro da fase retrabalho. O segundo lote enviado
-- viola a constraint e retorna erro no desktop.
--
-- Solução: substituir a constraint por um índice parcial que aplica
-- UNIQUE(device_id, fase) apenas para 'intermediaria' e 'expedicao',
-- liberando a fase 'retrabalho' para ter múltiplas linhas (uma por lote).
-- ============================================================

-- 1. Remove a constraint genérica atual
ALTER TABLE public.stock_items
  DROP CONSTRAINT IF EXISTS stock_items_device_id_fase_key;

-- 2. Unique parcial: intermediaria → apenas 1 por device
CREATE UNIQUE INDEX IF NOT EXISTS stock_items_device_intermediaria_unique
  ON public.stock_items (device_id)
  WHERE fase = 'intermediaria';

-- 3. Unique parcial: expedicao → apenas 1 por device
CREATE UNIQUE INDEX IF NOT EXISTS stock_items_device_expedicao_unique
  ON public.stock_items (device_id)
  WHERE fase = 'expedicao';

-- 4. Retrabalho: sem constraint única — múltiplos itens permitidos por device
--    A unicidade dentro do retrabalho é garantida pela lógica da aplicação
--    (busca por notes ILIKE 'lote:X%' antes de criar).
