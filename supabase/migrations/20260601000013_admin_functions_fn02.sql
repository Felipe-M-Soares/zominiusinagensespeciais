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
GRANT EXECUTE ON FUNCTION public.admin_reset_password TO authenticated;
