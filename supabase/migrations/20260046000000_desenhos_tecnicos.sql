-- =============================================================================
-- DESENHOS TÉCNICOS — PDFs de desenho técnico por peça (visualização + impressão
-- direto no card do componente, sem opção de download).
-- =============================================================================

-- ── 1. Coluna de vínculo em devices ──────────────────────────────────────────
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS desenho_tecnico_path text;

-- ── 2. Bucket privado (mesmo padrão de 'manuals': leitura por usuário aprovado,
--       escrita só admin) ───────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('desenhos-tecnicos', 'desenhos-tecnicos', false, 52428800, ARRAY['application/pdf'])
  ON CONFLICT (id) DO UPDATE SET
    file_size_limit = 52428800,
    allowed_mime_types = ARRAY['application/pdf'];

DROP POLICY IF EXISTS "desenhos_tecnicos_approved_read" ON storage.objects;
CREATE POLICY "desenhos_tecnicos_approved_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'desenhos-tecnicos' AND (public.is_approved_user() OR public.is_admin_user()));

DROP POLICY IF EXISTS "desenhos_tecnicos_admin_insert" ON storage.objects;
CREATE POLICY "desenhos_tecnicos_admin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'desenhos-tecnicos' AND public.is_admin_user());

DROP POLICY IF EXISTS "desenhos_tecnicos_admin_update" ON storage.objects;
CREATE POLICY "desenhos_tecnicos_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'desenhos-tecnicos' AND public.is_admin_user());

DROP POLICY IF EXISTS "desenhos_tecnicos_admin_delete" ON storage.objects;
CREATE POLICY "desenhos_tecnicos_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'desenhos-tecnicos' AND public.is_admin_user());
