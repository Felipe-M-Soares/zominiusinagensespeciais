-- =============================================================================
-- STORAGE — Buckets: email-assets, manuals, backups, devices-images, certificados
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 20260005000000_storage_buckets_and_policies.sql
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public) VALUES ('email-assets', 'email-assets', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('manuals',      'manuals',      false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('catalogs',     'catalogs',     false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('stock-backups','stock-backups',false) ON CONFLICT (id) DO NOTHING;

-- email-assets
DROP POLICY IF EXISTS "email_assets_public_read" ON storage.objects;
CREATE POLICY "email_assets_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'email-assets');

-- manuals
DROP POLICY IF EXISTS "manuals_approved_read" ON storage.objects;
CREATE POLICY "manuals_approved_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'manuals' AND (public.is_approved_user() OR public.is_admin_user()));

DROP POLICY IF EXISTS "manuals_admin_insert" ON storage.objects;
CREATE POLICY "manuals_admin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'manuals' AND public.is_admin_user());

DROP POLICY IF EXISTS "manuals_admin_update" ON storage.objects;
CREATE POLICY "manuals_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'manuals' AND public.is_admin_user());

DROP POLICY IF EXISTS "manuals_admin_delete" ON storage.objects;
CREATE POLICY "manuals_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'manuals' AND public.is_admin_user());

-- catalogs
DROP POLICY IF EXISTS "catalogs_approved_read" ON storage.objects;
CREATE POLICY "catalogs_approved_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'catalogs' AND (public.is_approved_user() OR public.is_admin_user()));

DROP POLICY IF EXISTS "catalogs_admin_insert" ON storage.objects;
CREATE POLICY "catalogs_admin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'catalogs' AND public.is_admin_user());

DROP POLICY IF EXISTS "catalogs_admin_update" ON storage.objects;
CREATE POLICY "catalogs_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'catalogs' AND public.is_admin_user());

DROP POLICY IF EXISTS "catalogs_admin_delete" ON storage.objects;
CREATE POLICY "catalogs_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'catalogs' AND public.is_admin_user());

-- stock-backups
DROP POLICY IF EXISTS "backups_admin_all" ON storage.objects;
CREATE POLICY "backups_admin_all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'stock-backups' AND public.is_admin_user());

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260033000000_devices_images_bucket.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- As imagens são nomeadas pela REFERÊNCIA do device (ex: "CCAHC 09.webp")
-- O bucket é público pois as imagens são conteúdo de produto, sem dados sensíveis.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'devices-images',
  'devices-images',
  true,                                          -- público: qualquer um pode LER
  5242880,                                       -- máx 5MB por imagem
  ARRAY['image/webp','image/jpeg','image/png','image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public            = true,
  file_size_limit   = 5242880,
  allowed_mime_types = ARRAY['image/webp','image/jpeg','image/png','image/gif'];

-- Leitura pública (sem autenticação — imagens de produto)
DROP POLICY IF EXISTS "devices_img_public_read" ON storage.objects;
CREATE POLICY "devices_img_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'devices-images');

-- Upload apenas admin
DROP POLICY IF EXISTS "devices_img_admin_insert" ON storage.objects;
CREATE POLICY "devices_img_admin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'devices-images' AND public.is_admin_user());

-- Update apenas admin
DROP POLICY IF EXISTS "devices_img_admin_update" ON storage.objects;
CREATE POLICY "devices_img_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'devices-images' AND public.is_admin_user());

-- Delete apenas admin
DROP POLICY IF EXISTS "devices_img_admin_delete" ON storage.objects;
CREATE POLICY "devices_img_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'devices-images' AND public.is_admin_user());
