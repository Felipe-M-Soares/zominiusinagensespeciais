-- FIX: Garantir que o bucket manuals está configurado corretamente para downloads
-- O bucket precisa estar como público OU ter políticas RLS corretas
-- Atualiza para garantir que usuários autenticados possam fazer download via URL assinada

-- Garante que a política de leitura existe para autenticados
DROP POLICY IF EXISTS "Anyone can read manuals" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read manuals" ON storage.objects;

CREATE POLICY "Authenticated users can read manuals"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'manuals');

-- Garante política para catalogs também (se existir)
DROP POLICY IF EXISTS "Authenticated users can read catalogs storage" ON storage.objects;

CREATE POLICY "Authenticated users can read catalogs storage"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'catalogs');

-- Cria bucket catalogs se não existir
INSERT INTO storage.buckets (id, name, public)
VALUES ('catalogs', 'catalogs', false)
ON CONFLICT (id) DO NOTHING;
