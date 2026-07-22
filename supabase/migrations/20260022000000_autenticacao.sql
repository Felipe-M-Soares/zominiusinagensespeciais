-- =============================================================================
-- AUTENTICAÇÃO — Funções admin (criar/resetar/excluir usuário), guards de segurança, seed
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 20260006000000_admin_functions.sql
-- ─────────────────────────────────────────────────────────────────────────────

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
    WHEN p_role IN ('admin','estoque','qualidade','comercial','financeiro','producao') THEN p_role
    ELSE 'estoque'
  END;
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
$f01$;

CREATE OR REPLACE FUNCTION public.admin_reset_password(
  p_target_user_id uuid,
  p_new_password   text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $f02$
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
$f02$;

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_target_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f03$
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
$f03$;

REVOKE ALL ON FUNCTION public.admin_create_user   FROM anon;
REVOKE ALL ON FUNCTION public.admin_reset_password FROM anon;
REVOKE ALL ON FUNCTION public.admin_delete_user   FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_create_user   TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_password TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user   TO authenticated;

-- Conta admin padrão movida para migration 022_seed_admin_account.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260016000000_security_rpc_guards.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- SEG-02: 7 funções sem verificação explícita de autenticação

-- ── increment_stock_quantity ──────────────────────────────────────────────────
-- Requer: usuário autenticado (qualquer role pode registrar movimentos)
DROP FUNCTION IF EXISTS public.increment_stock_quantity(uuid, integer);
CREATE OR REPLACE FUNCTION public.increment_stock_quantity(
  p_item_id uuid, p_qty integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f01$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  UPDATE public.stock_items
  SET quantity = quantity + p_qty, updated_at = now()
  WHERE id = p_item_id;
END; $f01$;
GRANT EXECUTE ON FUNCTION public.increment_stock_quantity(uuid, integer) TO authenticated;

-- ── reserve_stock ─────────────────────────────────────────────────────────────
-- Requer: usuário autenticado (vendedora/admin criam pedidos)
DROP FUNCTION IF EXISTS public.reserve_stock(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.reserve_stock(
  p_pedido_id uuid,
  p_items jsonb  -- [{stock_item_id, quantidade}]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f02$
DECLARE v_item jsonb; v_id uuid; v_qty integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_id  := (v_item->>'stock_item_id')::uuid;
    v_qty := (v_item->>'quantidade')::integer;
    UPDATE public.stock_items
    SET quantity_reserved = LEAST(quantity, quantity_reserved + v_qty), updated_at = now()
    WHERE id = v_id;
  END LOOP;
  RETURN jsonb_build_object('ok', true);
END; $f02$;
GRANT EXECUTE ON FUNCTION public.reserve_stock(uuid, jsonb) TO authenticated;

-- ── stock_movement_atomic ─────────────────────────────────────────────────────
-- Requer: usuário autenticado
DROP FUNCTION IF EXISTS public.stock_movement_atomic(uuid, text, integer, text, text, uuid, text);
CREATE OR REPLACE FUNCTION public.stock_movement_atomic(
  p_item_id   uuid,
  p_type      text,
  p_qty       integer,
  p_reason    text,
  p_lote      text,
  p_user_id   uuid,
  p_user_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f03$
DECLARE v_current integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;
  IF p_type NOT IN ('entrada','saida') THEN RETURN jsonb_build_object('ok', false, 'error', 'Tipo inválido'); END IF;
  IF p_qty <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'Quantidade deve ser > 0'); END IF;

  SELECT quantity INTO v_current FROM public.stock_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado'); END IF;

  IF p_type = 'saida' AND v_current < p_qty THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Estoque insuficiente: ' || v_current || ' disponível, ' || p_qty || ' solicitado');
  END IF;

  UPDATE public.stock_items
  SET quantity = CASE WHEN p_type = 'entrada' THEN quantity + p_qty ELSE GREATEST(0, quantity - p_qty) END,
      updated_at = now()
  WHERE id = p_item_id;

  INSERT INTO public.stock_movements (stock_item_id, type, quantity, reason, lote, user_id, user_display_name)
  VALUES (p_item_id, p_type, p_qty, p_reason, p_lote, p_user_id, p_user_name);

  RETURN jsonb_build_object('ok', true);
END; $f03$;
GRANT EXECUTE ON FUNCTION public.stock_movement_atomic(uuid,text,integer,text,text,uuid,text) TO authenticated;

-- ── cancel_pedido ─────────────────────────────────────────────────────────────
-- Requer: autenticado + admin OU vendedora dona do pedido
DROP FUNCTION IF EXISTS public.cancel_pedido(uuid);
CREATE OR REPLACE FUNCTION public.cancel_pedido(p_pedido_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f04$
DECLARE v_vendedora_id uuid; v_status text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;

  SELECT vendedora_id, status INTO v_vendedora_id, v_status
  FROM public.pedidos_comerciais WHERE id = p_pedido_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado'); END IF;
  IF v_status = 'cancelado' THEN RETURN jsonb_build_object('ok', true); END IF; -- idempotente
  IF v_status IN ('faturado','enviado') THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido já faturado não pode ser cancelado'); END IF;

  -- Admin pode cancelar qualquer pedido; vendedora só o seu
  IF NOT public.is_admin_user() AND v_vendedora_id != auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão para cancelar este pedido');
  END IF;

  UPDATE public.stock_items si
  SET quantity_reserved = GREATEST(0, si.quantity_reserved - pi.quantidade_reservada)
  FROM public.pedido_itens pi
  WHERE pi.pedido_id = p_pedido_id AND pi.stock_item_id = si.id;

  UPDATE public.pedidos_comerciais SET status = 'cancelado' WHERE id = p_pedido_id;
  RETURN jsonb_build_object('ok', true);
END; $f04$;
GRANT EXECUTE ON FUNCTION public.cancel_pedido(uuid) TO authenticated;

-- ── faturar_pedido (versão antiga sem SEFAZ) ─────────────────────────────────
-- Requer: admin ou financeiro
DROP FUNCTION IF EXISTS public.faturar_pedido(uuid, text, uuid, text);
CREATE OR REPLACE FUNCTION public.faturar_pedido(
  p_pedido_id uuid, p_nf text, p_user_id uuid, p_user_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f05$
DECLARE v_status text; v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;

  SELECT role INTO v_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
  IF v_role NOT IN ('admin','financeiro') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão: requer role admin ou financeiro');
  END IF;

  SELECT status INTO v_status FROM public.pedidos_comerciais WHERE id = p_pedido_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado'); END IF;
  IF v_status != 'pronto' THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido deve estar pronto para ser faturado'); END IF;

  UPDATE public.pedidos_comerciais
  SET status='enviado', nota_fiscal=p_nf, nf_criada_por=p_user_id, nf_criada_em=now(), enviado_em=now()
  WHERE id = p_pedido_id;

  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (p_user_id, p_user_name, 'faturar_pedido', 'pedido_comercial', p_pedido_id,
    jsonb_build_object('nota_fiscal', p_nf));

  RETURN jsonb_build_object('ok', true);
END; $f05$;
GRANT EXECUTE ON FUNCTION public.faturar_pedido(uuid,text,uuid,text) TO authenticated;

-- ── sync_stock_items_from_devices ─────────────────────────────────────────────
-- Requer: admin only
DROP FUNCTION IF EXISTS public.sync_stock_items_from_devices();
CREATE OR REPLACE FUNCTION public.sync_stock_items_from_devices()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f06$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'Requer role admin'; END IF;

  INSERT INTO public.stock_items (device_id, quantity, min_quantity, fase)
  SELECT d.id, 0, 0, 'intermediaria'
  FROM public.devices d
  WHERE NOT EXISTS (
    SELECT 1 FROM public.stock_items si
    WHERE si.device_id = d.id AND si.fase = 'intermediaria'
  )
  ON CONFLICT DO NOTHING;
END; $f06$;
GRANT EXECUTE ON FUNCTION public.sync_stock_items_from_devices() TO authenticated;

-- ── get_lotes_intermediario ───────────────────────────────────────────────────
-- Requer: autenticado (leitura, qualquer role)
-- Convertido para plpgsql para permitir guard auth.uid() antes da query
DROP FUNCTION IF EXISTS public.get_lotes_intermediario(uuid);
CREATE OR REPLACE FUNCTION public.get_lotes_intermediario(p_stock_item_id uuid)
RETURNS TABLE(lote text, saldo integer, last_movement timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $f07$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;  -- SEG-02: rejeita não autenticados

  RETURN QUERY
    SELECT
      sm.lote,
      SUM(CASE WHEN sm.type='entrada' THEN sm.quantity ELSE -sm.quantity END)::integer AS saldo,
      MAX(sm.created_at) AS last_movement
    FROM public.stock_movements sm
    WHERE sm.stock_item_id = p_stock_item_id
      AND sm.lote IS NOT NULL
    GROUP BY sm.lote
    HAVING SUM(CASE WHEN sm.type='entrada' THEN sm.quantity ELSE -sm.quantity END) > 0
    ORDER BY last_movement DESC;
END;
$f07$;
GRANT EXECUTE ON FUNCTION public.get_lotes_intermediario(uuid) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 20260022000000_seed_admin_account.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- A conta admin genérica foi removida por segurança.
-- Para criar um admin: use o painel do Supabase (Authentication → Users)
-- ou crie via SQL com a função admin_create_user() logado como admin existente.

-- Migration intencionalmente vazia. Mantida para não quebrar o histórico.
SELECT 1;
