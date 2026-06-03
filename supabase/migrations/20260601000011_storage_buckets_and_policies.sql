-- =============================================================================
-- 005: Buckets de storage e políticas
-- =============================================================================

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
