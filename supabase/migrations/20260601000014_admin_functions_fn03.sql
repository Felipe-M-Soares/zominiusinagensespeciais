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
GRANT EXECUTE ON FUNCTION public.admin_delete_user   TO authenticated;
