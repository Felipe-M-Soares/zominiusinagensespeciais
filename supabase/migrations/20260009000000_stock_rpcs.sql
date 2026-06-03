-- =============================================================================
-- 009: RPCs de estoque (movimentação atômica, reserva, sync)
-- =============================================================================

-- ── increment_stock_quantity ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_stock_quantity(p_item_id uuid, p_qty integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.stock_items SET quantity = quantity + p_qty, updated_at = now() WHERE id = p_item_id;
$$;

-- ── reserve_stock ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserve_stock(p_item_id uuid, p_qty integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_updated integer;
BEGIN
  UPDATE public.stock_items
  SET quantity_reserved = quantity_reserved + p_qty
  WHERE id = p_item_id AND (quantity - quantity_reserved) >= p_qty;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'Estoque insuficiente ou item não encontrado'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── stock_movement_atomic ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stock_movement_atomic(
  p_item_id uuid, p_type text, p_qty integer,
  p_reason text, p_lote text, p_user_id uuid, p_user_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new_qty integer;
BEGIN
  IF p_type = 'saida' THEN
    UPDATE public.stock_items SET quantity = quantity - p_qty, updated_at = now()
    WHERE id = p_item_id AND quantity >= p_qty RETURNING quantity INTO v_new_qty;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Estoque insuficiente'); END IF;
  ELSE
    UPDATE public.stock_items SET quantity = quantity + p_qty, updated_at = now()
    WHERE id = p_item_id RETURNING quantity INTO v_new_qty;
  END IF;
  INSERT INTO public.stock_movements(stock_item_id, type, quantity, reason, lote, user_id, user_display_name)
  VALUES (p_item_id, p_type, p_qty, p_reason, p_lote, p_user_id, p_user_name);
  RETURN jsonb_build_object('ok', true, 'new_quantity', v_new_qty);
END;
$$;

-- ── cancel_movement ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_movement(p_movement_id uuid, p_stock_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_movement public.stock_movements%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;
  SELECT * INTO v_movement FROM public.stock_movements WHERE id = p_movement_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Movimento não encontrado'); END IF;
  IF v_movement.type = 'entrada' THEN
    UPDATE public.stock_items SET quantity = GREATEST(0, quantity - v_movement.quantity) WHERE id = p_stock_item_id;
  ELSE
    UPDATE public.stock_items SET quantity = quantity + v_movement.quantity WHERE id = p_stock_item_id;
  END IF;
  DELETE FROM public.stock_movements WHERE id = p_movement_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── delete_stock_item ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_stock_item(p_stock_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role public.app_role;
BEGIN
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
  IF v_role IS DISTINCT FROM 'admin'::public.app_role THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Apenas administradores podem excluir peças.');
  END IF;
  DELETE FROM public.pedidos_comerciais
  WHERE id IN (SELECT DISTINCT pedido_id FROM public.pedido_itens WHERE stock_item_id = p_stock_item_id)
    AND (SELECT COUNT(*) FROM public.pedido_itens pi2 WHERE pi2.pedido_id = pedidos_comerciais.id AND pi2.stock_item_id != p_stock_item_id) = 0;
  DELETE FROM public.stock_items WHERE id = p_stock_item_id;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- ── admin_clear_history ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_clear_history()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores podem apagar o histórico';
  END IF;
  DELETE FROM public.pedido_itens;
  DELETE FROM public.pedidos_comerciais;
  DELETE FROM public.stock_movements;
  UPDATE public.stock_items SET quantity = 0, quantity_reserved = 0;
END;
$$;

-- ── sync_stock_items_from_devices ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_stock_items_from_devices()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inserted_count integer;
BEGIN
  INSERT INTO public.stock_items (device_id, quantity, min_quantity, fase)
  SELECT d.id, 0, 0, 'intermediaria' FROM public.devices d
  WHERE NOT EXISTS (SELECT 1 FROM public.stock_items si WHERE si.device_id = d.id);
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN jsonb_build_object('inserted', inserted_count);
END;
$$;

-- ── get_lotes_intermediario ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_lotes_intermediario()
RETURNS TABLE (stock_item_id uuid, lote text, saldo integer, model text, reference text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT si.id, upper(sm.lote), SUM(CASE sm.type WHEN 'entrada' THEN sm.quantity WHEN 'saida' THEN -sm.quantity ELSE 0 END)::integer,
    d.model, d.reference
  FROM public.stock_items si
  JOIN public.devices d ON d.id = si.device_id
  JOIN public.stock_movements sm ON sm.stock_item_id = si.id
  WHERE si.fase = 'intermediaria' AND sm.lote IS NOT NULL
    AND trim(lower(sm.lote)) NOT IN ('a-definir','a definir','sem lote')
    AND (sm.reason IS NULL OR sm.reason NOT IN (
      'Rollback — falha ao criar item de retrabalho',
      'Rollback — falha ao criar item de expedição',
      'Rollback — falha ao registrar entrada na expedição'))
  GROUP BY si.id, upper(sm.lote), d.model, d.reference
  HAVING SUM(CASE sm.type WHEN 'entrada' THEN sm.quantity WHEN 'saida' THEN -sm.quantity ELSE 0 END) > 0
  ORDER BY d.model, upper(sm.lote);
$$;

GRANT EXECUTE ON FUNCTION public.increment_stock_quantity TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_stock_item(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_stock_items_from_devices() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lotes_intermediario() TO authenticated;
