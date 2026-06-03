-- =============================================================================
-- 025: Performance — substituir auth.uid() por (select auth.uid()) em todas as RLS
-- Evita re-avaliação da função por linha (Supabase Security Advisor warnings)
-- =============================================================================

-- ── devices ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "devices_admin_update" ON public.devices;
CREATE POLICY "devices_admin_update" ON public.devices
  FOR UPDATE TO authenticated
  USING (public.is_admin_user() OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = (select auth.uid()) AND role IN ('admin', 'financeiro')
  ));

-- ── stock_movements ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "stock_movements_insert" ON public.stock_movements;
CREATE POLICY "stock_movements_insert" ON public.stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_user() AND (user_id IS NULL OR user_id = (select auth.uid())));

-- ── clientes ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "clientes_select" ON public.clientes;
CREATE POLICY "clientes_select" ON public.clientes FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role IN ('admin','comercial','estoque','financeiro'))
  OR (select auth.uid()) = created_by
);

DROP POLICY IF EXISTS "clientes_insert" ON public.clientes;
CREATE POLICY "clientes_insert" ON public.clientes
  FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = created_by);

DROP POLICY IF EXISTS "clientes_update" ON public.clientes;
CREATE POLICY "clientes_update" ON public.clientes FOR UPDATE TO authenticated USING (
  (select auth.uid()) = created_by OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role = 'admin')
);

DROP POLICY IF EXISTS "clientes_delete" ON public.clientes;
CREATE POLICY "clientes_delete" ON public.clientes FOR DELETE TO authenticated USING (
  (select auth.uid()) = created_by OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role = 'admin')
);

-- ── pedidos_comerciais ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "pedidos_select" ON public.pedidos_comerciais;
CREATE POLICY "pedidos_select" ON public.pedidos_comerciais FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role IN ('admin','comercial','estoque','financeiro'))
  OR vendedora_id = (select auth.uid())
);

DROP POLICY IF EXISTS "pedidos_delete" ON public.pedidos_comerciais;
CREATE POLICY "pedidos_delete" ON public.pedidos_comerciais FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role = 'admin')
);

-- ── pedido_itens ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "pedido_itens_select" ON public.pedido_itens;
CREATE POLICY "pedido_itens_select" ON public.pedido_itens FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.pedidos_comerciais pc WHERE pc.id = pedido_id AND (
    pc.vendedora_id = (select auth.uid()) OR
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role IN ('admin','comercial','estoque','financeiro'))
  ))
);

DROP POLICY IF EXISTS "pedido_itens_delete" ON public.pedido_itens;
CREATE POLICY "pedido_itens_delete" ON public.pedido_itens FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role = 'admin')
);

-- ── notificacoes ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "notif_select" ON public.notificacoes;
CREATE POLICY "notif_select" ON public.notificacoes
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "notif_update" ON public.notificacoes;
CREATE POLICY "notif_update" ON public.notificacoes
  FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id);

-- ── producao ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "apon_update" ON apontamentos_producao;
CREATE POLICY "apon_update" ON apontamentos_producao
  FOR UPDATE USING ((select auth.uid()) = user_id OR public.get_my_role() IN ('admin','producao'));

DROP POLICY IF EXISTS "par_update" ON paradas_producao;
CREATE POLICY "par_update" ON paradas_producao
  FOR UPDATE USING ((select auth.uid()) = user_id OR public.get_my_role() IN ('admin','producao'));

DROP POLICY IF EXISTS "ref_update" ON refugos_producao;
CREATE POLICY "ref_update" ON refugos_producao
  FOR UPDATE USING ((select auth.uid()) = user_id OR public.get_my_role() IN ('admin','producao'));

-- Policies que usam auth.uid() IS NOT NULL → trocar por autenticação via role
DROP POLICY IF EXISTS "maq_select"  ON maquinas_producao;
DROP POLICY IF EXISTS "prod_select" ON produtos_producao;
DROP POLICY IF EXISTS "apon_select" ON apontamentos_producao;
DROP POLICY IF EXISTS "apon_insert" ON apontamentos_producao;
DROP POLICY IF EXISTS "op_select"   ON ordens_planejamento;
DROP POLICY IF EXISTS "op_insert"   ON ordens_planejamento;
DROP POLICY IF EXISTS "op_update"   ON ordens_planejamento;
DROP POLICY IF EXISTS "par_select"  ON paradas_producao;
DROP POLICY IF EXISTS "par_insert"  ON paradas_producao;
DROP POLICY IF EXISTS "ref_select"  ON refugos_producao;
DROP POLICY IF EXISTS "ref_insert"  ON refugos_producao;
DROP POLICY IF EXISTS "mp_select"   ON materias_primas_producao;
DROP POLICY IF EXISTS "mp_update"   ON materias_primas_producao;
DROP POLICY IF EXISTS "mov_select"  ON movimentos_mp_producao;
DROP POLICY IF EXISTS "mov_insert"  ON movimentos_mp_producao;

CREATE POLICY "maq_select"  ON maquinas_producao     FOR SELECT USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "prod_select" ON produtos_producao      FOR SELECT USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "apon_select" ON apontamentos_producao  FOR SELECT USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "apon_insert" ON apontamentos_producao  FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);
CREATE POLICY "op_select"   ON ordens_planejamento    FOR SELECT USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "op_insert"   ON ordens_planejamento    FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);
CREATE POLICY "op_update"   ON ordens_planejamento    FOR UPDATE USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "par_select"  ON paradas_producao       FOR SELECT USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "par_insert"  ON paradas_producao       FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);
CREATE POLICY "ref_select"  ON refugos_producao       FOR SELECT USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "ref_insert"  ON refugos_producao       FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);
CREATE POLICY "mp_select"   ON materias_primas_producao  FOR SELECT USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "mp_update"   ON materias_primas_producao  FOR UPDATE USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "mov_select"  ON movimentos_mp_producao FOR SELECT USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "mov_insert"  ON movimentos_mp_producao FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);
