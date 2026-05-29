-- =============================================================================
-- FIX 1: Storage policies para o bucket "catalogs"
-- PROBLEMA: A migration 20260316 criou a tabela catalogs e as RLS da tabela,
-- mas NUNCA criou as políticas de storage (storage.objects) para o bucket.
-- Resultado: admins conseguiam inserir na tabela mas o upload do arquivo falhava
-- com "Unauthorized" porque não havia política INSERT no storage.objects.
-- =============================================================================

-- Garante que o bucket existe (ON CONFLICT é seguro para re-execução)
INSERT INTO storage.buckets (id, name, public)
VALUES ('catalogs', 'catalogs', false)
ON CONFLICT (id) DO NOTHING;

-- Remove políticas antigas se existirem (seguro re-executar)
DROP POLICY IF EXISTS "Authenticated users can read catalogs storage" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload catalogs" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete catalogs storage" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update catalogs storage" ON storage.objects;

-- Leitura: todos os autenticados aprovados podem baixar catálogos via URL assinada
CREATE POLICY "Authenticated users can read catalogs storage"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'catalogs');

-- Upload: apenas admins
CREATE POLICY "Admins can upload catalogs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'catalogs'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

-- Delete: apenas admins
CREATE POLICY "Admins can delete catalogs storage"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'catalogs'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

-- Update (necessário para alguns clients): apenas admins
CREATE POLICY "Admins can update catalogs storage"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'catalogs'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

-- =============================================================================
-- FIX 2: Políticas RLS da tabela catalogs usam has_role sem cast ::app_role
-- PROBLEMA: A migration 20260316 usa has_role(auth.uid(), 'admin') sem cast,
-- o que pode falhar em versões do PostgreSQL que não fazem coerção automática
-- de TEXT para app_role enum.
-- =============================================================================

DROP POLICY IF EXISTS "Admins can insert catalogs" ON public.catalogs;
DROP POLICY IF EXISTS "Admins can delete catalogs" ON public.catalogs;
DROP POLICY IF EXISTS "Admins can update catalogs" ON public.catalogs;

CREATE POLICY "Admins can insert catalogs"
  ON public.catalogs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete catalogs"
  ON public.catalogs FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update catalogs"
  ON public.catalogs FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- =============================================================================
-- FIX 3: Garantir que manuals storage também tem política UPDATE (alguns clients pedem)
-- =============================================================================
DROP POLICY IF EXISTS "Admins can update manuals storage" ON storage.objects;
CREATE POLICY "Admins can update manuals storage"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'manuals'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

-- =============================================================================
-- FIX 4: user_roles UNIQUE constraint — a migration original criou UNIQUE(user_id, role)
-- mas deveria ser UNIQUE(user_id) pois um usuário só pode ter UM papel.
-- Sem isso, o upsert em admin-create-user pode criar linhas duplicadas.
-- =============================================================================

-- Verifica se a constraint incorreta existe e corrige
DO $$
BEGIN
  -- Remove a constraint composta antiga se existir
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'user_roles'
      AND constraint_name = 'user_roles_user_id_role_key'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.user_roles DROP CONSTRAINT user_roles_user_id_role_key;
  END IF;

  -- Adiciona constraint simples em user_id se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'user_roles'
      AND constraint_name = 'user_roles_user_id_key'
      AND table_schema = 'public'
  ) THEN
    -- Remove duplicatas antes de adicionar constraint
    DELETE FROM public.user_roles ur1
    USING public.user_roles ur2
    WHERE ur1.id > ur2.id AND ur1.user_id = ur2.user_id;

    ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_key UNIQUE (user_id);
  END IF;
END $$;
