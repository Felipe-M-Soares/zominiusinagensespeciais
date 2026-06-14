-- =============================================================================
-- FIX: RLS stock_items — permite que usuários aprovados criem itens de expedição
-- e retrabalho via as funções transferToExpedicao / transferToRetrabalho
-- =============================================================================
--
-- PROBLEMA:
--   A policy "stock_items_write_admin" só permite que admins escrevam em stock_items.
--   As funções transferToExpedicao, transferToRetrabalho e transferRetrabalhoToExpedicao
--   fazem INSERT direto em stock_items via frontend (supabase.from("stock_items").insert())
--   para criar os itens de expedição/retrabalho quando ainda não existem.
--   Isso falha silenciosamente para usuários com role "estoque" — a peça não vai
--   para o retrabalho nem move do intermediário, exatamente o bug reportado.
--
-- SOLUÇÃO:
--   Adicionar policy de INSERT para usuários aprovados criando itens nas fases
--   expedicao e retrabalho. A policy inclui verificação de que:
--     1. O usuário está autenticado e aprovado
--     2. A fase é 'expedicao' ou 'retrabalho' (não pode criar intermediária via transfer)
--     3. A quantidade inicial é 0 (padrão das transferências — o movimento é feito
--        separadamente via stock_movement_atomic com SECURITY DEFINER)
--
-- =============================================================================

-- ── 1. Policy de INSERT para approved users (expedicao + retrabalho) ───────────
DROP POLICY IF EXISTS "stock_items_insert_approved" ON public.stock_items;
CREATE POLICY "stock_items_insert_approved" ON public.stock_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_approved_user()
    AND fase IN ('expedicao', 'retrabalho')
    AND quantity = 0               -- só insere com qty=0; o movimento é atômico no DB
    AND quantity_reserved = 0
  );

-- ── 2. Policy de UPDATE para approved users (fase intermediaria/expedicao) ─────
-- Permite que upsertStockItem atualize location, notes e min_quantity
-- sem precisar ser admin (usado pelo usuário de estoque ao editar um item)
DROP POLICY IF EXISTS "stock_items_update_approved" ON public.stock_items;
CREATE POLICY "stock_items_update_approved" ON public.stock_items
  FOR UPDATE TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (
    public.is_approved_user()
    -- Não pode alterar quantity ou quantity_reserved diretamente —
    -- essas colunas só mudam via stock_movement_atomic (SECURITY DEFINER)
    AND quantity          = (SELECT quantity          FROM public.stock_items WHERE id = stock_items.id)
    AND quantity_reserved = (SELECT quantity_reserved FROM public.stock_items WHERE id = stock_items.id)
  );

-- ── 3. Garante que admin ainda tem acesso total (mantém policy existente) ───────
-- A policy "stock_items_write_admin" já existe da migration 20260027.
-- Não precisamos recriar — apenas garantir que a nova INSERT policy não conflita.
-- Em PostgreSQL, policies de INSERT se somam com OR — a mais permissiva prevalece.

-- ── 4. Comentários de documentação ────────────────────────────────────────────
COMMENT ON TABLE public.stock_items IS
  'Estoque por fase: intermediaria, expedicao, retrabalho.
   Escrita: admins têm acesso total; usuarios aprovados podem INSERT expedicao/retrabalho
   (criados com qty=0 pelas funções de transferência) e UPDATE de metadados.
   Quantidades só mudam via stock_movement_atomic (SECURITY DEFINER).';
