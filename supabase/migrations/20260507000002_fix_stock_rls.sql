-- =============================================================================
-- NOVO-SEG-01 FIX: Restaura RLS granular em stock_items, stock_movements,
-- backup_configs e stock_backups.
--
-- A migration 20260422000000_add_fase_estoque.sql sobrescreveu as políticas
-- seguras criadas em 20260417000001 com "FOR ALL USING (true)", permitindo
-- que qualquer usuário autenticado deletasse itens de estoque diretamente,
-- bypassando o RPC protegido delete_stock_item.
-- =============================================================================

-- ── stock_items ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can manage stock_items" ON public.stock_items;
DROP POLICY IF EXISTS "Admins can manage stock_items"              ON public.stock_items;
DROP POLICY IF EXISTS "stock_items_select"                         ON public.stock_items;
DROP POLICY IF EXISTS "stock_items_write_admin"                    ON public.stock_items;

-- Leitura: qualquer usuário aprovado e não bloqueado
CREATE POLICY "stock_items_select" ON public.stock_items
  FOR SELECT TO authenticated
  USING (public.is_approved_user());

-- Escrita (INSERT/UPDATE/DELETE): apenas admins
-- Funcionários usam RPCs SECURITY DEFINER que operam com privilégio elevado
CREATE POLICY "stock_items_write_admin" ON public.stock_items
  FOR ALL TO authenticated
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

-- ── stock_movements ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can manage stock_movements" ON public.stock_movements;
DROP POLICY IF EXISTS "Authenticated users can view stock_movements"   ON public.stock_movements;
DROP POLICY IF EXISTS "stock_movements_select"                         ON public.stock_movements;
DROP POLICY IF EXISTS "stock_movements_insert"                         ON public.stock_movements;

-- Leitura: qualquer usuário aprovado
CREATE POLICY "stock_movements_select" ON public.stock_movements
  FOR SELECT TO authenticated
  USING (public.is_approved_user());

-- Inserção via RPCs (SECURITY DEFINER bypassa RLS — esta policy cobre
-- inserções diretas legítimas como fallback)
CREATE POLICY "stock_movements_insert" ON public.stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_user());

-- Update/Delete: apenas admins (histórico não deve ser alterado por usuários comuns)
CREATE POLICY "stock_movements_write_admin" ON public.stock_movements
  FOR ALL TO authenticated
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

-- ── backup_configs ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can manage backup_configs" ON public.backup_configs;

CREATE POLICY "backup_configs_admin" ON public.backup_configs
  FOR ALL TO authenticated
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

-- ── stock_backups ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can manage stock_backups" ON public.stock_backups;

-- Leitura: qualquer aprovado pode ver backups
CREATE POLICY "stock_backups_select" ON public.stock_backups
  FOR SELECT TO authenticated
  USING (public.is_approved_user());

-- Escrita: apenas admins criam/deletam backups
CREATE POLICY "stock_backups_write_admin" ON public.stock_backups
  FOR ALL TO authenticated
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());
