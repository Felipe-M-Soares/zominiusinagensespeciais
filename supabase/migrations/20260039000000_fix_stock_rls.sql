-- =============================================================================
-- FIX: Remove policies incorretas que causavam FK error em stock_movements
-- =============================================================================

-- Remove as policies que quebraram o estoque
DROP POLICY IF EXISTS "stock_items_insert_approved" ON public.stock_items;
DROP POLICY IF EXISTS "stock_items_update_approved" ON public.stock_items;

-- Remove RPCs desnecessárias criadas anteriormente
DROP FUNCTION IF EXISTS public.ensure_expedicao_item(uuid,integer,text,text);
DROP FUNCTION IF EXISTS public.ensure_retrabalho_item(uuid,text,text,text);

-- Política correta: usuários aprovados podem inserir itens de expedição e retrabalho
-- (criados com quantity=0 pelas funções de transferência do frontend)
-- Não restringe por quantity pois o upsert pode passar valores diferentes
DROP POLICY IF EXISTS "stock_items_transfer_insert" ON public.stock_items;
CREATE POLICY "stock_items_transfer_insert" ON public.stock_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_approved_user()
    AND fase IN ('expedicao', 'retrabalho')
  );
