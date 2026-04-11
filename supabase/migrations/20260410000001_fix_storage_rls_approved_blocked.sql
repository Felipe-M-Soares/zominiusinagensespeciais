-- =============================================================================
-- SEC-CRIT: Storage RLS não verificava `approved` nem `blocked`.
--
-- VULNERABILIDADE:
--   As políticas de leitura nos buckets 'manuals' e 'catalogs' usavam apenas:
--     TO authenticated USING (bucket_id = 'manuals')
--   Isso significa que qualquer usuário autenticado — incluindo contas com
--   approved=false (pendentes) ou blocked=true — podia baixar arquivos
--   diretamente via URL assinada ou API do Supabase Storage,
--   bypassando completamente a lógica de aprovação da aplicação.
--
-- IMPACTO:
--   Usuário recém-cadastrado (ainda pendente) ou bloqueado por admin podia
--   chamar diretamente:
--     supabase.storage.from('manuals').download('path/to/file.pdf')
--   e obter o arquivo sem restrição.
--
-- CORREÇÃO:
--   Adiciona sub-query de aprovação (AND NOT blocked) no USING das políticas
--   de leitura de storage, alinhando com as políticas RLS das tabelas de dados.
-- =============================================================================

-- ─── manuals bucket ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can read manuals" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read manuals" ON storage.objects;

CREATE POLICY "Approved users can read manuals storage"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'manuals'
    AND (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE user_id = auth.uid()
          AND approved = true
          AND blocked = false
      )
      OR public.has_role(auth.uid(), 'admin'::app_role)
    )
  );

-- ─── catalogs bucket ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can read catalogs storage" ON storage.objects;

CREATE POLICY "Approved users can read catalogs storage"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'catalogs'
    AND (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE user_id = auth.uid()
          AND approved = true
          AND blocked = false
      )
      OR public.has_role(auth.uid(), 'admin'::app_role)
    )
  );

-- ─── Alinha também as políticas das tabelas de dados ─────────────────────────
-- As tabelas devices, manuals, contacts, catalogs verificam approved=true
-- mas não blocked=false. Um usuário com approved=true AND blocked=true
-- (estado anômalo — o app nunca chega aqui, mas não há invariante no DB)
-- ainda poderia ler dados. Adicionamos AND blocked=false como defesa em profundidade.

DROP POLICY IF EXISTS "Approved users can view devices" ON public.devices;
CREATE POLICY "Approved users can view devices" ON public.devices
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid()
        AND approved = true
        AND blocked = false
    )
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Approved users can view contacts" ON public.contacts;
CREATE POLICY "Approved users can view contacts" ON public.contacts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid()
        AND approved = true
        AND blocked = false
    )
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Approved users can view manuals" ON public.manuals;
CREATE POLICY "Approved users can view manuals" ON public.manuals
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid()
        AND approved = true
        AND blocked = false
    )
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Approved users can view catalogs" ON public.catalogs;
CREATE POLICY "Approved users can view catalogs" ON public.catalogs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid()
        AND approved = true
        AND blocked = false
    )
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

-- Atualiza o índice composto para cobrir o novo campo blocked
-- (o índice anterior era (user_id, approved) — agora o planner
--  precisa do blocked também para uma cobertura eficiente)
DROP INDEX IF EXISTS profiles_user_id_approved_idx;
CREATE INDEX IF NOT EXISTS profiles_user_id_approved_blocked_idx
  ON public.profiles (user_id, approved, blocked);

ANALYZE public.profiles;
