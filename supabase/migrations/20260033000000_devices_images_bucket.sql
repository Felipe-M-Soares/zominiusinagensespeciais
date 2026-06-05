-- =============================================================================
-- 033: Bucket público de imagens dos componentes
-- =============================================================================
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
