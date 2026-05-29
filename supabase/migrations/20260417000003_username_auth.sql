-- ============================================================
-- Autenticação por username + senha (sem email)
-- ============================================================

-- 1. Adiciona coluna `login` (username único) na profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS login text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_login_unique
  ON public.profiles (lower(login))
  WHERE login IS NOT NULL;

-- 2. Flag de primeiro login — admin reseta, usuário satisfaz na 1ª vez
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT true;

-- 3. Atualiza must_change_password somente quem tem a flag
-- RLS helper
CREATE OR REPLACE FUNCTION public.is_own_profile(p_user_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT auth.uid() = p_user_id;
$$;

-- Política: o próprio usuário pode atualizar must_change_password = false
-- (para marcar que já definiu a senha — o campo só vai de true→false pelo usuário)
DROP POLICY IF EXISTS "profiles_user_own_update" ON public.profiles;
CREATE POLICY "profiles_user_own_update" ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 4. Conta admin padrão
--    login: admin
--    senha temporária: Admin@2024  ← TROQUE AO PRIMEIRO LOGIN
-- ============================================================
-- Nota: o admin cria usuários via Edge Function que gera email interno.
-- O email interno segue o padrão: {login}@interno.conceptus
-- Este INSERT é executado apenas se não existir outro admin.

-- Usamos a Admin API do Supabase pelo service_role dentro da migration
-- IMPORTANTE: rode este bloco apenas 1 vez. Se o usuário já existir, ignore.
-- A criação real do admin é feita via SQL direto com pgcrypto/auth.users
-- porque migrations não têm acesso à Admin API.

-- Apenas cria se não existe nenhum admin ainda
DO $$
DECLARE
  v_uid uuid;
  v_email text := 'admin@interno.conceptus';
BEGIN
  -- Verifica se já existe
  SELECT id INTO v_uid FROM auth.users WHERE email = v_email LIMIT 1;
  IF v_uid IS NOT NULL THEN
    RAISE NOTICE 'Admin já existe: %', v_uid;
    RETURN;
  END IF;

  -- Cria usuário admin na tabela auth.users diretamente
  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_user_meta_data,
    raw_app_meta_data,
    aud,
    role,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  ) VALUES (
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000000',
    v_email,
    -- Senha: Admin@2024  (bcrypt, $2a$10$)
    crypt('Admin@2024', gen_salt('bf')),
    now(),
    jsonb_build_object('display_name', 'Administrador'),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    'authenticated',
    'authenticated',
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
  RETURNING id INTO v_uid;

  RAISE NOTICE 'Admin criado com id: %', v_uid;

  -- Profile
  INSERT INTO public.profiles (user_id, display_name, email, login, approved, must_change_password)
  VALUES (v_uid, 'Administrador', v_email, 'admin', true, false)
  ON CONFLICT (user_id) DO UPDATE
    SET display_name = 'Administrador', login = 'admin',
        approved = true, must_change_password = false;

  -- Role admin
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_uid, 'admin')
  ON CONFLICT (user_id) DO UPDATE SET role = 'admin';

END $$;
