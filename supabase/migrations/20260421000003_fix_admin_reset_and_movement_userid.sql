-- =============================================================================
-- FIX 1: admin_reset_password — impede que Admin A redefina a senha de Admin B
--
-- PROBLEMA: A função não verificava o papel do usuário-alvo. Um admin podia
-- redefinir a senha de outro admin, facilitando tomada de conta (lateral movement).
-- O controle estava apenas na UI (JavaScript), que pode ser contornado via
-- chamada direta à função RPC.
--
-- CORREÇÃO: Adiciona verificação: se o alvo for admin e não for o próprio
-- chamador, rejeita a operação.
-- =============================================================================
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
  v_caller_id    uuid := auth.uid();
  v_caller_role  text;
  v_target_role  text;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Não autenticado.');
  END IF;

  SELECT role INTO v_caller_role
    FROM public.user_roles WHERE user_id = v_caller_id;

  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('error', 'Apenas administradores podem alterar senhas.');
  END IF;

  -- FIX: impede reset de senha entre admins (lateral movement)
  SELECT role INTO v_target_role
    FROM public.user_roles WHERE user_id = p_target_user_id;

  IF v_target_role = 'admin' AND p_target_user_id != v_caller_id THEN
    RETURN jsonb_build_object('error', 'Não é permitido redefinir a senha de outro administrador.');
  END IF;

  IF length(p_new_password) < 8 THEN
    RETURN jsonb_build_object('error', 'Senha deve ter no mínimo 8 caracteres.');
  END IF;
  IF length(p_new_password) > 72 THEN
    RETURN jsonb_build_object('error', 'Senha deve ter no máximo 72 caracteres.');
  END IF;

  UPDATE auth.users
     SET encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
         updated_at          = now()
   WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Usuário não encontrado.');
  END IF;

  UPDATE public.profiles
     SET must_change_password = true
   WHERE user_id = p_target_user_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- =============================================================================
-- FIX 2: admin_delete_user — impede que Admin A exclua Admin B
--
-- MESMO PADRÃO: a função original só impedia auto-exclusão. Um admin podia
-- excluir outro admin via chamada direta ao RPC, contornando a UI.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_delete_user(
  p_target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id    uuid := auth.uid();
  v_caller_role  text;
  v_target_role  text;
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

  -- FIX: impede exclusão de outro admin
  SELECT role INTO v_target_role
    FROM public.user_roles WHERE user_id = p_target_user_id;

  IF v_target_role = 'admin' THEN
    RETURN jsonb_build_object('error', 'Não é permitido excluir a conta de outro administrador.');
  END IF;

  DELETE FROM auth.users WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Usuário não encontrado.');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- =============================================================================
-- FIX 3: stock_movements INSERT — impede falsificação de user_id
--
-- PROBLEMA: A policy de INSERT verificava apenas is_approved_user(), mas não
-- restringia o campo user_id. Um usuário aprovado podia inserir movimentos
-- atribuídos a outro user_id, corrompendo o histórico de auditoria.
-- user_display_name também era enviado pelo cliente sem validação.
--
-- CORREÇÃO: WITH CHECK agora garante que user_id seja NULL ou igual a auth.uid().
-- (NULL é aceito pois é o valor padrão quando o usuário não tem ID resolvido.)
-- =============================================================================
DROP POLICY IF EXISTS "stock_movements_insert" ON public.stock_movements;

CREATE POLICY "stock_movements_insert" ON public.stock_movements
  FOR INSERT WITH CHECK (
    public.is_approved_user()
    AND (user_id IS NULL OR user_id = auth.uid())
  );
