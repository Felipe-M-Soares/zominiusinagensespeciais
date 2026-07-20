-- =============================================================================
-- SEGURANÇA FINAL — RLS mais restrita sem quebrar os fluxos existentes
-- =============================================================================
-- Objetivo:
-- 1) remover policies abertas com USING/WITH CHECK (true);
-- 2) manter os fluxos atuais entre Comercial, Estoque e Financeiro;
-- 3) garantir role Processos também no banco;
-- 4) restringir backup/restauração e auditoria a usuários corretos.

-- Role do novo módulo Processos no enum do banco.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'app_role' AND e.enumlabel = 'processos'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'processos';
  END IF;
END $$;

-- Função auxiliar para reduzir duplicação nas policies.
CREATE OR REPLACE FUNCTION public.has_any_role(_roles public.app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = (select auth.uid())
      AND ur.role = ANY(_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.has_any_role(public.app_role[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_any_role(public.app_role[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Financeiro: só financeiro/admin veem tudo; criador vê o próprio lançamento.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "financeiro_lanc_select" ON public.financeiro_lancamentos;
CREATE POLICY "financeiro_lanc_select" ON public.financeiro_lancamentos
  FOR SELECT TO authenticated
  USING (
    created_by = (select auth.uid())
    OR public.has_any_role(ARRAY['admin','financeiro']::public.app_role[])
  );

DROP POLICY IF EXISTS "financeiro_lanc_insert" ON public.financeiro_lancamentos;
CREATE POLICY "financeiro_lanc_insert" ON public.financeiro_lancamentos
  FOR INSERT TO authenticated
  WITH CHECK (
    (created_by = (select auth.uid()) AND public.has_any_role(ARRAY['admin','financeiro','comercial']::public.app_role[]))
    OR public.has_any_role(ARRAY['admin','financeiro']::public.app_role[])
  );

DROP POLICY IF EXISTS "financeiro_lanc_update" ON public.financeiro_lancamentos;
CREATE POLICY "financeiro_lanc_update" ON public.financeiro_lancamentos
  FOR UPDATE TO authenticated
  USING (
    created_by = (select auth.uid())
    OR public.has_any_role(ARRAY['admin','financeiro']::public.app_role[])
  )
  WITH CHECK (
    created_by = (select auth.uid())
    OR public.has_any_role(ARRAY['admin','financeiro']::public.app_role[])
  );

DROP POLICY IF EXISTS "financeiro_lanc_delete" ON public.financeiro_lancamentos;
CREATE POLICY "financeiro_lanc_delete" ON public.financeiro_lancamentos
  FOR DELETE TO authenticated
  USING (public.has_any_role(ARRAY['admin','financeiro']::public.app_role[]));

-- Sequência fiscal: leitura restrita a quem emite/consulta NF.
DROP POLICY IF EXISTS "nfe_seq_select" ON public.nfe_sequencia;
CREATE POLICY "nfe_seq_select" ON public.nfe_sequencia
  FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['admin','financeiro']::public.app_role[]));

-- ─────────────────────────────────────────────────────────────────────────────
-- Comercial/Estoque/Financeiro: mantém os fluxos de pedido, mas sem abertura total.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "pedidos_insert" ON public.pedidos_comerciais;
CREATE POLICY "pedidos_insert" ON public.pedidos_comerciais
  FOR INSERT TO authenticated
  WITH CHECK (
    vendedora_id = (select auth.uid())
    OR public.has_any_role(ARRAY['admin','comercial']::public.app_role[])
  );

DROP POLICY IF EXISTS "pedidos_update" ON public.pedidos_comerciais;
CREATE POLICY "pedidos_update" ON public.pedidos_comerciais
  FOR UPDATE TO authenticated
  USING (
    vendedora_id = (select auth.uid())
    OR public.has_any_role(ARRAY['admin','comercial','estoque','financeiro']::public.app_role[])
  )
  WITH CHECK (
    vendedora_id = (select auth.uid())
    OR public.has_any_role(ARRAY['admin','comercial','estoque','financeiro']::public.app_role[])
  );

DROP POLICY IF EXISTS "pedido_itens_insert" ON public.pedido_itens;
CREATE POLICY "pedido_itens_insert" ON public.pedido_itens
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pedidos_comerciais pc
      WHERE pc.id = pedido_id
        AND (
          pc.vendedora_id = (select auth.uid())
          OR public.has_any_role(ARRAY['admin','comercial','estoque','financeiro']::public.app_role[])
        )
    )
  );

DROP POLICY IF EXISTS "pedido_itens_update" ON public.pedido_itens;
CREATE POLICY "pedido_itens_update" ON public.pedido_itens
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pedidos_comerciais pc
      WHERE pc.id = pedido_id
        AND (
          pc.vendedora_id = (select auth.uid())
          OR public.has_any_role(ARRAY['admin','comercial','estoque','financeiro']::public.app_role[])
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pedidos_comerciais pc
      WHERE pc.id = pedido_id
        AND (
          pc.vendedora_id = (select auth.uid())
          OR public.has_any_role(ARRAY['admin','comercial','estoque','financeiro']::public.app_role[])
        )
    )
  );

-- Notificações: o próprio usuário pode criar para si; módulos autorizados podem
-- criar notificações para outros usuários quando o fluxo exige isso.
DROP POLICY IF EXISTS "notif_insert" ON public.notificacoes;
CREATE POLICY "notif_insert" ON public.notificacoes
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    OR public.has_any_role(ARRAY['admin','comercial','estoque','financeiro']::public.app_role[])
  );

-- Auditoria: usuário autenticado só grava log próprio; admin/funções do banco continuam permitidos.
DROP POLICY IF EXISTS "audit_log_insert" ON public.audit_log;
CREATE POLICY "audit_log_insert" ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    OR public.has_any_role(ARRAY['admin']::public.app_role[])
  );

-- Contas/backup do sistema: policies defensivas caso as tabelas existam no banco.
DO $$
BEGIN
  IF to_regclass('public.stock_backups') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "stock_backups_admin_only" ON public.stock_backups';
    EXECUTE 'CREATE POLICY "stock_backups_admin_only" ON public.stock_backups FOR ALL TO authenticated USING (public.has_any_role(ARRAY[''admin'']::public.app_role[])) WITH CHECK (public.has_any_role(ARRAY[''admin'']::public.app_role[]))';
  END IF;

  IF to_regclass('public.backups_estoque') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "backups_estoque_admin_only" ON public.backups_estoque';
    EXECUTE 'CREATE POLICY "backups_estoque_admin_only" ON public.backups_estoque FOR ALL TO authenticated USING (public.has_any_role(ARRAY[''admin'']::public.app_role[])) WITH CHECK (public.has_any_role(ARRAY[''admin'']::public.app_role[]))';
  END IF;
END $$;

-- Admin create user também aceita a nova role Processos.
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_login        text,
  p_password     text,
  p_display_name text,
  p_role         text DEFAULT 'estoque'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $f01$
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

  v_valid_role := CASE
    WHEN p_role IN ('admin','estoque','qualidade','comercial','financeiro','producao','processos') THEN p_role
    ELSE 'estoque'
  END;
  v_email := v_clean_login || '@interno.zomini';

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
$f01$;

REVOKE ALL ON FUNCTION public.admin_create_user(text,text,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text,text,text,text) TO authenticated;
