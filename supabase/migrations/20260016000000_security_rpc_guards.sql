-- =============================================================================
-- 016: Segurança — guards auth.uid() em todas as RPCs SECURITY DEFINER
-- SEG-02: 7 funções sem verificação explícita de autenticação
-- =============================================================================

-- ── increment_stock_quantity ──────────────────────────────────────────────────
-- Requer: usuário autenticado (qualquer role pode registrar movimentos)
CREATE OR REPLACE FUNCTION public.increment_stock_quantity(
  p_item_id uuid, p_qty integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  UPDATE public.stock_items
  SET quantity = quantity + p_qty, updated_at = now()
  WHERE id = p_item_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.increment_stock_quantity(uuid, integer) TO authenticated;

-- ── reserve_stock ─────────────────────────────────────────────────────────────
-- Requer: usuário autenticado (vendedora/admin criam pedidos)
DROP FUNCTION IF EXISTS public.reserve_stock(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.reserve_stock(
  p_pedido_id uuid,
  p_items jsonb  -- [{stock_item_id, quantidade}]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END; $$;
GRANT EXECUTE ON FUNCTION public.reserve_stock(uuid, jsonb) TO authenticated;

-- ── stock_movement_atomic ─────────────────────────────────────────────────────
-- Requer: usuário autenticado
CREATE OR REPLACE FUNCTION public.stock_movement_atomic(
  p_item_id   uuid,
  p_type      text,
  p_qty       integer,
  p_reason    text,
  p_lote      text,
  p_user_id   uuid,
  p_user_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END; $$;
GRANT EXECUTE ON FUNCTION public.stock_movement_atomic(uuid,text,integer,text,text,uuid,text) TO authenticated;

-- ── cancel_pedido ─────────────────────────────────────────────────────────────
-- Requer: autenticado + admin OU vendedora dona do pedido
CREATE OR REPLACE FUNCTION public.cancel_pedido(p_pedido_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END; $$;
GRANT EXECUTE ON FUNCTION public.cancel_pedido(uuid) TO authenticated;

-- ── faturar_pedido (versão antiga sem SEFAZ) ─────────────────────────────────
-- Requer: admin ou financeiro
CREATE OR REPLACE FUNCTION public.faturar_pedido(
  p_pedido_id uuid, p_nf text, p_user_id uuid, p_user_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END; $$;
GRANT EXECUTE ON FUNCTION public.faturar_pedido(uuid,text,uuid,text) TO authenticated;

-- ── sync_stock_items_from_devices ─────────────────────────────────────────────
-- Requer: admin only
CREATE OR REPLACE FUNCTION public.sync_stock_items_from_devices()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END; $$;
GRANT EXECUTE ON FUNCTION public.sync_stock_items_from_devices() TO authenticated;

-- ── get_lotes_intermediario ───────────────────────────────────────────────────
-- Requer: autenticado (leitura, qualquer role)
CREATE OR REPLACE FUNCTION public.get_lotes_intermediario(p_stock_item_id uuid)
RETURNS TABLE(lote text, saldo integer, last_movement timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    sm.lote,
    SUM(CASE WHEN sm.type='entrada' THEN sm.quantity ELSE -sm.quantity END)::integer AS saldo,
    MAX(sm.created_at) AS last_movement
  FROM public.stock_movements sm
  WHERE sm.stock_item_id = p_stock_item_id
    AND sm.lote IS NOT NULL
    AND auth.uid() IS NOT NULL  -- SEG-02: rejeita chamadas não autenticadas
  GROUP BY sm.lote
  HAVING SUM(CASE WHEN sm.type='entrada' THEN sm.quantity ELSE -sm.quantity END) > 0
  ORDER BY last_movement DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_lotes_intermediario(uuid) TO authenticated;

ANALYZE public.stock_items;
ANALYZE public.pedidos_comerciais;
