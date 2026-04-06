-- =============================================================================
-- PERFORMANCE & SECURITY: Índices para otimizar RLS e buscas frequentes
-- =============================================================================

-- ─── 1. Índice composto (user_id, approved) em profiles ───────────────────────
-- PROBLEMA: a política RLS em devices/contacts/manuals/catalogs executa esta
-- subquery para CADA linha avaliada:
--   EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND approved = true)
-- Sem índice composto, isso é um seq-scan em profiles a cada acesso.
-- Com o índice, a subquery torna-se um Index Scan em O(log n).
CREATE INDEX IF NOT EXISTS profiles_user_id_approved_idx
  ON public.profiles (user_id, approved);

-- ─── 2. Índice em user_roles(user_id) ────────────────────────────────────────
-- has_role() faz SELECT FROM user_roles WHERE user_id = _user_id.
-- Com ~100s de usuários isso já é um lookup frequente em cada RLS check.
CREATE INDEX IF NOT EXISTS user_roles_user_id_idx
  ON public.user_roles (user_id);

-- ─── 3. Índice em devices(model) ─────────────────────────────────────────────
-- A ordenação padrão de todos os selects de devices é ORDER BY model.
-- Sem índice, cada query paginated faz um sort completo.
CREATE INDEX IF NOT EXISTS devices_model_idx
  ON public.devices (model);

-- ─── 4. Índice GIN para buscas fulltext em devices ───────────────────────────
-- As buscas ILIKE '%termo%' em múltiplos campos (model, reference, udi_di, etc.)
-- são atualmente seq-scans. Um índice GIN com pg_trgm acelera drasticamente
-- buscas por substring sem alterar a lógica da query.
-- Nota: requer a extensão pg_trgm (disponível por padrão no Supabase).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS devices_model_trgm_idx
  ON public.devices USING GIN (model gin_trgm_ops);

CREATE INDEX IF NOT EXISTS devices_reference_trgm_idx
  ON public.devices USING GIN (reference gin_trgm_ops);

CREATE INDEX IF NOT EXISTS devices_udi_di_trgm_idx
  ON public.devices USING GIN (udi_di gin_trgm_ops);

CREATE INDEX IF NOT EXISTS devices_brand_name_trgm_idx
  ON public.devices USING GIN (brand_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS devices_internal_code_trgm_idx
  ON public.devices USING GIN (internal_code gin_trgm_ops);

-- ─── 5. Índice em profiles(email) ─────────────────────────────────────────────
-- Login com Google cria perfil via trigger; buscas por email ocorrem no admin panel.
CREATE INDEX IF NOT EXISTS profiles_email_idx
  ON public.profiles (email);

-- ─── 6. Estatísticas: atualiza o planner após criação dos índices ─────────────
ANALYZE public.profiles;
ANALYZE public.user_roles;
ANALYZE public.devices;
