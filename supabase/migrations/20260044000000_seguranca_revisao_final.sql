-- =============================================================================
-- SEGURANÇA — Revisão final pós-auditoria
-- =============================================================================
-- Corrige funções SECURITY DEFINER antigas que ainda não tinham search_path fixo
-- e reduz exposição para anon. Não altera fluxo do app.

ALTER FUNCTION public.resolve_ncm_device_by_id(uuid) SET search_path = public;
ALTER FUNCTION public.get_total_stock_quantity() SET search_path = public;
ALTER FUNCTION public.get_devices_regularizacao_counts() SET search_path = public;

REVOKE ALL ON FUNCTION public.resolve_ncm_device_by_id(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_total_stock_quantity() FROM anon;
REVOKE ALL ON FUNCTION public.get_devices_regularizacao_counts() FROM anon;

GRANT EXECUTE ON FUNCTION public.resolve_ncm_device_by_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_total_stock_quantity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_devices_regularizacao_counts() TO authenticated;

-- =============================================================================
-- DEVOLUÇÃO / TROCA — RPCs de emissão/cancelamento
-- =============================================================================
-- A tabela notas_devolucao_troca foi criada em 20260012000000_financeiro.sql
-- (mesma migration onde o restante do recurso de devolução/troca vive). As
-- RPCs abaixo ficam aqui, e não lá, porque dependem de audit_log (criada em
-- 20260027000000_estoque.sql) e de check_rate_limit/rate_limit_log (criadas
-- em 20260029000000_seguranca.sql) — ambas posteriores ao arquivo financeiro.
-- Colocar essas duas funções em 20260012 quebraria uma instalação nova do
-- zero (a função falharia ao ser criada, pois as tabelas que ela referencia
-- ainda não existiriam nesse ponto da sequência de migrations).

-- ── Atualiza check_rate_limit com mais uma entrada (mesmo padrão já usado
-- em 20260029/20260041: CREATE OR REPLACE reafirma todas as entradas
-- anteriores e soma a nova, sem alterar nenhum limite existente) ────────────
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_action text,
  p_user_id uuid DEFAULT auth.uid()
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f10$
DECLARE
  v_count   integer;
  v_max     integer;
  v_window  integer; -- seconds
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;

  CASE p_action
    WHEN 'stock_movement_atomic'      THEN v_max := 60;  v_window := 60;
    WHEN 'reserve_stock'              THEN v_max := 20;  v_window := 60;
    WHEN 'cancel_pedido'              THEN v_max := 10;  v_window := 60;
    WHEN 'faturar_pedido_sefaz'       THEN v_max := 5;   v_window := 60;
    WHEN 'marcar_pedido_pronto'       THEN v_max := 30;  v_window := 60;
    WHEN 'import_devices'             THEN v_max := 3;   v_window := 300;
    WHEN 'enviar_feedback'            THEN v_max := 5;   v_window := 3600;
    WHEN 'registrar_devolucao_troca'  THEN v_max := 5;   v_window := 60;
    ELSE                                    v_max := 100; v_window := 60;
  END CASE;

  SELECT COUNT(*) INTO v_count
  FROM public.rate_limit_log
  WHERE user_id = p_user_id
    AND action  = p_action
    AND created_at > now() - (v_window || ' seconds')::interval;

  IF v_count >= v_max THEN RETURN false; END IF;

  INSERT INTO public.rate_limit_log (user_id, action) VALUES (p_user_id, p_action);
  RETURN true;
END; $f10$;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, uuid) TO authenticated;

-- ── RPC: registra o resultado (autorizada/rejeitada) da emissão ──────────────
CREATE OR REPLACE FUNCTION public.registrar_devolucao_troca(
  p_id              uuid,
  p_status          text,          -- 'autorizada' | 'rejeitada'
  p_status_msg      text,
  p_chave_acesso    text,
  p_protocolo       text,
  p_dh_autorizacao  timestamptz,
  p_xml_nfe         text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f11$
DECLARE
  v_role     text;
  v_uid      uuid := auth.uid();
  v_name     text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;

  SELECT role INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  IF v_role NOT IN ('admin','financeiro') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão: requer role admin ou financeiro');
  END IF;

  IF p_status NOT IN ('autorizada','rejeitada') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Status inválido');
  END IF;

  IF NOT public.check_rate_limit('registrar_devolucao_troca') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Muitas requisições. Aguarde 1 minuto.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.notas_devolucao_troca WHERE id = p_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Registro não encontrado');
  END IF;

  SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid;

  UPDATE public.notas_devolucao_troca SET
    status = p_status, status_msg = p_status_msg,
    chave_acesso = COALESCE(p_chave_acesso, chave_acesso),
    protocolo_sefaz = COALESCE(p_protocolo, protocolo_sefaz),
    dh_autorizacao = COALESCE(p_dh_autorizacao, dh_autorizacao),
    xml_nfe = COALESCE(p_xml_nfe, xml_nfe)
  WHERE id = p_id;

  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (v_uid, COALESCE(v_name, 'Desconhecido'),
    CASE WHEN p_status = 'autorizada' THEN 'emitir_nf_devolucao_troca' ELSE 'rejeitar_nf_devolucao_troca' END,
    'nota_devolucao_troca', p_id,
    jsonb_build_object('protocolo', p_protocolo, 'chave_acesso', p_chave_acesso));

  RETURN jsonb_build_object('ok', true);
END; $f11$;
GRANT EXECUTE ON FUNCTION public.registrar_devolucao_troca(uuid,text,text,text,text,timestamptz,text) TO authenticated;

-- ── RPC: cancelamento local do registro (não transmite evento de cancelamento
-- ao SEFAZ — mesma limitação que o restante do sistema hoje tem para NF-e de
-- venda) ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancelar_devolucao_troca(p_id uuid, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f12$
DECLARE
  v_role text;
  v_uid  uuid := auth.uid();
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  IF v_role NOT IN ('admin','financeiro') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão: requer role admin ou financeiro');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notas_devolucao_troca WHERE id = p_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Registro não encontrado');
  END IF;

  SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid;

  UPDATE public.notas_devolucao_troca
  SET status = 'cancelada', status_msg = COALESCE(p_motivo, status_msg)
  WHERE id = p_id;

  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (v_uid, COALESCE(v_name, 'Desconhecido'), 'cancelar_nf_devolucao_troca', 'nota_devolucao_troca', p_id,
    jsonb_build_object('motivo', p_motivo));

  RETURN jsonb_build_object('ok', true);
END; $f12$;
GRANT EXECUTE ON FUNCTION public.cancelar_devolucao_troca(uuid,text) TO authenticated;
