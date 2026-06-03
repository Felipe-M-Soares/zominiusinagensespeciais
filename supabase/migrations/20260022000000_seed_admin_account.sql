-- =============================================================================
-- 022: Seed — conta de administrador inicial
-- =============================================================================
-- Cria a conta admin padrão se não existir.
-- Login: admin
-- Senha: Admin@2024  ← MUDE NO PRIMEIRO LOGIN (must_change_password = true)
-- Email interno: admin@interno.conceptus
--
-- Para trocar a senha: faça login e acesse Configurações > Alterar Senha,
-- ou use admin_reset_password() via SQL após a migration.
-- =============================================================================

DO $admin$
DECLARE
  v_uid  uuid;
  v_email text := 'admin@interno.conceptus';
BEGIN
  -- Não recria se já existir
  SELECT id INTO v_uid FROM auth.users WHERE email = v_email LIMIT 1;
  IF v_uid IS NOT NULL THEN
    RAISE NOTICE 'Admin já existe (id: %)', v_uid;
    -- Garante que o role seja admin mesmo que a conta já exista
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_uid, 'admin')
    ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
    RETURN;
  END IF;

  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data, aud, role,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) VALUES (
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000000',
    v_email,
    extensions.crypt('Admin@2024', extensions.gen_salt('bf')),
    now(),
    jsonb_build_object('display_name', 'Administrador'),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    'authenticated', 'authenticated',
    now(), now(), '', '', '', ''
  ) RETURNING id INTO v_uid;

  INSERT INTO public.profiles (user_id, display_name, email, login, approved, must_change_password)
  VALUES (v_uid, 'Administrador', v_email, 'admin', true, true)
  ON CONFLICT (user_id) DO UPDATE
    SET display_name = 'Administrador',
        login = 'admin',
        approved = true,
        must_change_password = true;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_uid, 'admin')
  ON CONFLICT (user_id) DO UPDATE SET role = 'admin';

  RAISE NOTICE 'Admin criado com sucesso (id: %)', v_uid;
END;
$admin$;
