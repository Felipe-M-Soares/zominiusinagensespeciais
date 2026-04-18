-- ============================================================
-- PASSO 1: Ativa a extensão pgcrypto (necessária para crypt/gen_salt)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- Funções SQL que substituem todas as Edge Functions do admin
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique Run
-- ============================================================

-- ── 1. admin_create_user ──────────────────────────────────────────────────
-- Cria usuário por login (sem email), com senha segura e role definida.
-- Só pode ser chamada por quem tem role = 'admin' na tabela user_roles.

CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_login        text,
  p_password     text,
  p_display_name text,
  p_role         text DEFAULT 'client'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER          -- roda como o dono da função (postgres) com acesso à auth schema
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id   uuid := auth.uid();
  v_caller_role text;
  v_clean_login text;
  v_email       text;
  v_new_uid     uuid;
  v_valid_role  text;
BEGIN
  -- 1. Verifica que o chamador existe e é admin
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Não autenticado.');
  END IF;

  SELECT role INTO v_caller_role
    FROM public.user_roles
   WHERE user_id = v_caller_id;

  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('error', 'Apenas administradores podem criar usuários.');
  END IF;

  -- 2. Valida e limpa o login
  v_clean_login := lower(trim(p_login));
  v_clean_login := regexp_replace(v_clean_login, '[^a-z0-9._\-]', '', 'g');

  IF length(v_clean_login) < 2 THEN
    RETURN jsonb_build_object('error', 'Login inválido (mínimo 2 caracteres; use letras, números, ponto, hífen ou underscore).');
  END IF;

  -- 3. Verifica unicidade do login
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(login) = v_clean_login) THEN
    RETURN jsonb_build_object('error', 'Este login já está em uso.');
  END IF;

  -- 4. Valida senha
  IF length(p_password) < 8 THEN
    RETURN jsonb_build_object('error', 'Senha deve ter no mínimo 8 caracteres.');
  END IF;
  IF length(p_password) > 72 THEN
    RETURN jsonb_build_object('error', 'Senha deve ter no máximo 72 caracteres.');
  END IF;

  -- 5. Valida nome
  IF length(trim(p_display_name)) < 2 THEN
    RETURN jsonb_build_object('error', 'Nome inválido (mínimo 2 caracteres).');
  END IF;

  -- 6. Define role válido
  v_valid_role := CASE WHEN p_role = 'admin' THEN 'admin' ELSE 'client' END; -- cast happens at insert

  -- 7. Gera email interno
  v_email := v_clean_login || '@interno.conceptus';

  -- 8. Cria o usuário na tabela auth.users (acesso via SECURITY DEFINER)
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
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(),
    jsonb_build_object('display_name', trim(p_display_name)),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    'authenticated',
    'authenticated',
    now(),
    now(),
    '', '', '', ''
  )
  RETURNING id INTO v_new_uid;

  -- 9. Perfil — upsert para tolerar trigger que pode já ter inserido
  INSERT INTO public.profiles (
    user_id, display_name, email, login, approved, must_change_password
  ) VALUES (
    v_new_uid,
    trim(p_display_name),
    v_email,
    v_clean_login,
    true,
    true           -- usuário define senha no 1º login
  )
  ON CONFLICT (user_id) DO UPDATE SET
    display_name        = EXCLUDED.display_name,
    login               = EXCLUDED.login,
    approved            = true,
    must_change_password = true;

  -- 10. Role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_new_uid, v_valid_role::public.app_role)
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_new_uid::text,
    'login',   v_clean_login
  );
END;
$$;


-- ── 2. admin_reset_password ───────────────────────────────────────────────
-- Redefine a senha de qualquer usuário. Só admins podem chamar.

CREATE OR REPLACE FUNCTION public.admin_reset_password(
  p_target_user_id  uuid,
  p_new_password    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id   uuid := auth.uid();
  v_caller_role text;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Não autenticado.');
  END IF;

  SELECT role INTO v_caller_role
    FROM public.user_roles WHERE user_id = v_caller_id;

  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('error', 'Apenas administradores podem alterar senhas.');
  END IF;

  IF length(p_new_password) < 8 THEN
    RETURN jsonb_build_object('error', 'Senha deve ter no mínimo 8 caracteres.');
  END IF;
  IF length(p_new_password) > 72 THEN
    RETURN jsonb_build_object('error', 'Senha deve ter no máximo 72 caracteres.');
  END IF;

  -- Atualiza senha diretamente em auth.users
  UPDATE auth.users
     SET encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
         updated_at          = now()
   WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Usuário não encontrado.');
  END IF;

  -- Força redefinição no próximo login
  UPDATE public.profiles
     SET must_change_password = true
   WHERE user_id = p_target_user_id;

  RETURN jsonb_build_object('success', true);
END;
$$;


-- ── 3. admin_delete_user ─────────────────────────────────────────────────
-- Exclui completamente um usuário. Só admins podem chamar.
-- Impede que o admin se exclua.

CREATE OR REPLACE FUNCTION public.admin_delete_user(
  p_target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   uuid := auth.uid();
  v_caller_role text;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Não autenticado.');
  END IF;

  SELECT role INTO v_caller_role
    FROM public.user_roles WHERE user_id = v_caller_id;

  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('error', 'Apenas administradores podem excluir contas.');
  END IF;

  IF p_target_user_id = v_caller_id THEN
    RETURN jsonb_build_object('error', 'Você não pode excluir sua própria conta.');
  END IF;

  -- Remove da tabela auth.users (profiles/roles são deletados em cascata via FK)
  DELETE FROM auth.users WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Usuário não encontrado.');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;


-- ── 4. Garante que somente admins chamam estas funções via RPC ────────────
-- SECURITY DEFINER já garante isso internamente, mas revogamos EXECUTE
-- do role anon para segurança extra.

REVOKE ALL ON FUNCTION public.admin_create_user   FROM anon;
REVOKE ALL ON FUNCTION public.admin_reset_password FROM anon;
REVOKE ALL ON FUNCTION public.admin_delete_user   FROM anon;

GRANT EXECUTE ON FUNCTION public.admin_create_user   TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_password TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user   TO authenticated;
