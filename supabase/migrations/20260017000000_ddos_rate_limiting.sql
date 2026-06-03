-- =============================================================================
-- 017: Proteção DDoS — Rate limiting server-side por usuário
-- SEG-07: limita chamadas críticas no banco sem depender de middleware externo
-- =============================================================================

-- ── Tabela de rate limit (sliding window) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limit_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action      text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_user_action_created
  ON public.rate_limit_log (user_id, action, created_at DESC);

-- Limpa entradas > 5 min automaticamente via trigger
DROP TRIGGER IF EXISTS trg_cleanup_rate_limit ON public.rate_limit_log;
DROP FUNCTION IF EXISTS public.cleanup_rate_limit_log();
CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f01$
BEGIN
  DELETE FROM public.rate_limit_log
  WHERE created_at < now() - interval '5 minutes';
  RETURN NULL;
END; $f01$;

DROP TRIGGER IF EXISTS trg_cleanup_rate_limit ON public.rate_limit_log;
CREATE TRIGGER trg_cleanup_rate_limit
  AFTER INSERT ON public.rate_limit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.cleanup_rate_limit_log();

-- RLS: usuário só lê seus próprios registros; INSERT aberto para authenticated
ALTER TABLE public.rate_limit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rate_limit_self" ON public.rate_limit_log;
CREATE POLICY "rate_limit_self" ON public.rate_limit_log
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "rate_limit_insert" ON public.rate_limit_log;
CREATE POLICY "rate_limit_insert" ON public.rate_limit_log
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- ── Função check_rate_limit ───────────────────────────────────────────────────
-- Retorna TRUE se dentro do limite, FALSE se excedeu.
-- Limites configurados por ação (max_calls em window_seconds):
--   stock_movement_atomic : 60 req/60s
--   reserve_stock         : 20 req/60s
--   cancel_pedido         : 10 req/60s
--   faturar_pedido_sefaz  : 5  req/60s
DROP FUNCTION IF EXISTS public.check_rate_limit(text, uuid);
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_action text,
  p_user_id uuid DEFAULT auth.uid()
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f02$
DECLARE
  v_count   integer;
  v_max     integer;
  v_window  integer; -- seconds
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;

  -- Configuração por ação
  CASE p_action
    WHEN 'stock_movement_atomic'  THEN v_max := 60;  v_window := 60;
    WHEN 'reserve_stock'          THEN v_max := 20;  v_window := 60;
    WHEN 'cancel_pedido'          THEN v_max := 10;  v_window := 60;
    WHEN 'faturar_pedido_sefaz'   THEN v_max := 5;   v_window := 60;
    WHEN 'marcar_pedido_pronto'   THEN v_max := 30;  v_window := 60;
    WHEN 'import_devices'         THEN v_max := 3;   v_window := 300;
    ELSE                               v_max := 100; v_window := 60;
  END CASE;

  SELECT COUNT(*) INTO v_count
  FROM public.rate_limit_log
  WHERE user_id = p_user_id
    AND action  = p_action
    AND created_at > now() - (v_window || ' seconds')::interval;

  IF v_count >= v_max THEN RETURN false; END IF;

  -- Registra a chamada atual
  INSERT INTO public.rate_limit_log (user_id, action) VALUES (p_user_id, p_action);
  RETURN true;
END; $f02$;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, uuid) TO authenticated;

-- ── Adiciona check_rate_limit nas RPCs críticas ───────────────────────────────

-- stock_movement_atomic com rate limit
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
  IF NOT public.check_rate_limit('stock_movement_atomic') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Muitas requisições. Aguarde alguns segundos.');
  END IF;

  IF p_type NOT IN ('entrada','saida') THEN RETURN jsonb_build_object('ok', false, 'error', 'Tipo inválido'); END IF;
  IF p_qty <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'Quantidade deve ser > 0'); END IF;

  SELECT quantity INTO v_current FROM public.stock_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado'); END IF;
  IF p_type = 'saida' AND v_current < p_qty THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Estoque insuficiente: ' || v_current || ' disponível');
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

-- cancel_pedido com rate limit
DROP FUNCTION IF EXISTS public.cancel_pedido(uuid);
CREATE OR REPLACE FUNCTION public.cancel_pedido(p_pedido_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f04$
DECLARE v_vendedora_id uuid; v_status text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;
  IF NOT public.check_rate_limit('cancel_pedido') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Muitas requisições. Aguarde alguns segundos.');
  END IF;

  SELECT vendedora_id, status INTO v_vendedora_id, v_status
  FROM public.pedidos_comerciais WHERE id = p_pedido_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado'); END IF;
  IF v_status = 'cancelado' THEN RETURN jsonb_build_object('ok', true); END IF;
  IF v_status IN ('faturado','enviado') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido já faturado não pode ser cancelado');
  END IF;
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

-- faturar_pedido_sefaz com rate limit (redefine a versão da migration 015)
DROP FUNCTION IF EXISTS public.faturar_pedido_sefaz(uuid, text, text, text, timestamptz, uuid, text, text);
CREATE OR REPLACE FUNCTION public.faturar_pedido_sefaz(
  p_pedido_id uuid, p_nf text, p_chave_acesso text, p_protocolo text,
  p_dh_autorizacao timestamptz, p_user_id uuid, p_user_name text,
  p_xml_nfe text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f05$
DECLARE v_status text; v_nf_existente text; v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;

  -- Somente admin ou financeiro
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
  IF v_role NOT IN ('admin','financeiro') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão: requer role admin ou financeiro');
  END IF;

  IF NOT public.check_rate_limit('faturar_pedido_sefaz') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Muitas requisições de faturamento. Aguarde 1 minuto.');
  END IF;

  SELECT status, nota_fiscal INTO v_status, v_nf_existente
  FROM public.pedidos_comerciais WHERE id = p_pedido_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado'); END IF;
  IF v_nf_existente = p_nf THEN RETURN jsonb_build_object('ok', true, 'already_faturado', true); END IF;
  IF v_status != 'pronto' THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'Pedido deve estar no status "pronto" para ser faturado. Status atual: ' || v_status);
  END IF;

  UPDATE public.pedidos_comerciais SET
    status='enviado', nota_fiscal=p_nf, chave_acesso_nfe=p_chave_acesso,
    protocolo_sefaz=p_protocolo, dh_autorizacao_nfe=p_dh_autorizacao,
    nf_criada_por=p_user_id, nf_criada_em=now(), enviado_em=now(), xml_nfe=p_xml_nfe
  WHERE id = p_pedido_id;

  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (p_user_id, p_user_name, 'faturar_nf', 'pedido_comercial', p_pedido_id,
    jsonb_build_object('nota_fiscal', p_nf, 'protocolo', p_protocolo));

  RETURN jsonb_build_object('ok', true);
END; $f05$;
GRANT EXECUTE ON FUNCTION public.faturar_pedido_sefaz(uuid,text,text,text,timestamptz,uuid,text,text) TO authenticated;

