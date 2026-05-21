-- ============================================================
-- FIX: Adiciona 'retrabalho' ao CHECK constraint da coluna fase
-- A constraint original só permite 'intermediaria' e 'expedicao',
-- mas o código usa fase='retrabalho' para itens em retrabalho.
-- Isso causava falha silenciosa no INSERT e lotes inconsistentes.
-- ============================================================

-- 1. Remove o CHECK constraint antigo (inline na coluna)
ALTER TABLE public.stock_items
  DROP CONSTRAINT IF EXISTS stock_items_fase_check;

-- 2. Adiciona novo CHECK incluindo 'retrabalho'
ALTER TABLE public.stock_items
  ADD CONSTRAINT stock_items_fase_check
  CHECK (fase IN ('intermediaria', 'expedicao', 'retrabalho'));
