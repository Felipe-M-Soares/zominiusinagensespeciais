BEGIN;
-- =============================================================================
-- 006: Funções administrativas (criar/resetar/excluir usuários)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_login        text,
  p_password     text,
  p_display_name text,
  p_role         text DEFAULT 'funcionario'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_caller_id   uuid := auth.uid();
  v_caller_role text;
  v_clean_login text;
  v_email       text;
  v_new_uid     uuid;
  v_valid_role  text;
BEGIN
  IF v_caller_id IS NULL THEN RETURN jsonb_build_object('error', 'Não autenticado.'); END IF;
  SELECT role INTO v_caller_role FROM public.user_roles WHERE user_id = v_caller_id;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN RETURN jsonb_build_object('error', 'Apenas administradores podem criar usuários.'); END IF;

  v_clean_login := regexp_replace(lower(trim(p_login)), '[^a-z0-9._\-]', '', 'g');
  IF length(v_clean_login) < 2 THEN RETURN jsonb_build_object('error', 'Login inválido.'); END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(login) = v_clean_login) THEN RETURN jsonb_build_object('error', 'Login já em uso.'); END IF;
  IF length(p_password) < 8 THEN RETURN jsonb_build_object('error', 'Senha deve ter no mínimo 8 caracteres.'); END IF;
  IF length(p_password) > 72 THEN RETURN jsonb_build_object('error', 'Senha deve ter no máximo 72 caracteres.'); END IF;
  IF length(trim(p_display_name)) < 2 THEN RETURN jsonb_build_object('error', 'Nome inválido.'); END IF;

  v_valid_role := CASE WHEN p_role = 'admin' THEN 'admin' WHEN p_role = 'vendedora' THEN 'vendedora' WHEN p_role = 'financeiro' THEN 'financeiro' ELSE 'funcionario' END;
  v_email := v_clean_login || '@interno.conceptus';

  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data, aud, role,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    jsonb_build_object('display_name', trim(p_display_name)),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    'authenticated', 'authenticated', now(), now(), '', '', '', ''
  ) RETURNING id INTO v_new_uid;

  INSERT INTO public.profiles (user_id, display_name, email, login, approved, must_change_password)
  VALUES (v_new_uid, trim(p_display_name), v_email, v_clean_login, true, true)
  ON CONFLICT (user_id) DO UPDATE SET
    display_name = EXCLUDED.display_name, login = EXCLUDED.login,
    approved = true, must_change_password = true;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_new_uid, v_valid_role::public.app_role)
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

  RETURN jsonb_build_object('success', true, 'user_id', v_new_uid::text, 'login', v_clean_login);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reset_password(
  p_target_user_id uuid,
  p_new_password   text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_caller_id   uuid := auth.uid();
  v_caller_role text;
  v_target_role text;
BEGIN
  IF v_caller_id IS NULL THEN RETURN jsonb_build_object('error', 'Não autenticado.'); END IF;
  SELECT role INTO v_caller_role FROM public.user_roles WHERE user_id = v_caller_id;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN RETURN jsonb_build_object('error', 'Apenas admins podem alterar senhas.'); END IF;
  SELECT role INTO v_target_role FROM public.user_roles WHERE user_id = p_target_user_id;
  IF v_target_role = 'admin' AND p_target_user_id != v_caller_id THEN RETURN jsonb_build_object('error', 'Não é permitido redefinir senha de outro administrador.'); END IF;
  IF length(p_new_password) < 8 THEN RETURN jsonb_build_object('error', 'Senha deve ter no mínimo 8 caracteres.'); END IF;

  UPDATE auth.users SET encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')), updated_at = now() WHERE id = p_target_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Usuário não encontrado.'); END IF;
  UPDATE public.profiles SET must_change_password = true WHERE user_id = p_target_user_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_target_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_id   uuid := auth.uid();
  v_caller_role text;
  v_target_role text;
BEGIN
  IF v_caller_id IS NULL THEN RETURN jsonb_build_object('error', 'Não autenticado.'); END IF;
  SELECT role INTO v_caller_role FROM public.user_roles WHERE user_id = v_caller_id;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN RETURN jsonb_build_object('error', 'Apenas admins podem excluir contas.'); END IF;
  IF p_target_user_id = v_caller_id THEN RETURN jsonb_build_object('error', 'Você não pode excluir sua própria conta.'); END IF;
  SELECT role INTO v_target_role FROM public.user_roles WHERE user_id = p_target_user_id;
  IF v_target_role = 'admin' THEN RETURN jsonb_build_object('error', 'Não é permitido excluir outro administrador.'); END IF;
  DELETE FROM auth.users WHERE id = p_target_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Usuário não encontrado.'); END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_user   FROM anon;
REVOKE ALL ON FUNCTION public.admin_reset_password FROM anon;
REVOKE ALL ON FUNCTION public.admin_delete_user   FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_create_user   TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_password TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user   TO authenticated;

-- Conta admin padrão
DO $admin$
DECLARE
  v_uid  uuid;
  v_email text := 'admin@interno.conceptus';
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = v_email LIMIT 1;
  IF v_uid IS NOT NULL THEN RAISE NOTICE 'Admin já existe: %', v_uid; RETURN; END IF;

  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data, aud, role,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000', v_email,
    extensions.crypt('Admin@2024', extensions.gen_salt('bf')), now(),
    jsonb_build_object('display_name', 'Administrador'),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    'authenticated', 'authenticated', now(), now(), '', '', '', ''
  ) RETURNING id INTO v_uid;

  INSERT INTO public.profiles (user_id, display_name, email, login, approved, must_change_password)
  VALUES (v_uid, 'Administrador', v_email, 'admin', true, false)
  ON CONFLICT (user_id) DO UPDATE SET display_name='Administrador', login='admin', approved=true, must_change_password=false;

  INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'admin')
  ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
END;
$admin$;

COMMIT;
