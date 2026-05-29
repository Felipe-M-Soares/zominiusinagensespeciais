INSERT INTO storage.buckets (id, name, public) VALUES ('email-assets', 'email-assets', true);

drop policy if exists "Public read access for email assets" on storage.objects;
CREATE POLICY "Public read access for email assets" ON storage.objects FOR SELECT USING (bucket_id = 'email-assets');