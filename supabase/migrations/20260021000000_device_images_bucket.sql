-- =============================================================================
-- Bucket de imagens das peças (device-images)
-- Público para leitura (URLs usadas nos cards); escrita apenas para admins.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'device-images',
  'device-images',
  true,                          -- público: URLs funcionam sem token
  5242880,                       -- 5 MB por arquivo
  ARRAY['image/webp', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 5242880,
      allowed_mime_types = ARRAY['image/webp', 'image/png', 'image/jpeg'];

-- Leitura pública (sem autenticação) — necessário para <img src="..."> funcionar
DROP POLICY IF EXISTS "device_images_public_read" ON storage.objects;
CREATE POLICY "device_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'device-images');

-- Upload/substituição apenas para admins
DROP POLICY IF EXISTS "device_images_admin_insert" ON storage.objects;
CREATE POLICY "device_images_admin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'device-images' AND public.is_admin_user());

DROP POLICY IF EXISTS "device_images_admin_update" ON storage.objects;
CREATE POLICY "device_images_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'device-images' AND public.is_admin_user());

DROP POLICY IF EXISTS "device_images_admin_delete" ON storage.objects;
CREATE POLICY "device_images_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'device-images' AND public.is_admin_user());
