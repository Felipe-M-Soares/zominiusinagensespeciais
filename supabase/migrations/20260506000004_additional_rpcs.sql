-- cancel_movement: atomic version that avoids read-modify-write race
CREATE OR REPLACE FUNCTION public.cancel_movement(p_movement_id uuid, p_stock_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_type     text;
  v_quantity integer;
  v_new_qty  integer;
BEGIN
  -- Lock the movement row
  SELECT type, quantity INTO v_type, v_quantity
  FROM public.stock_movements
  WHERE id = p_movement_id AND stock_item_id = p_stock_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Movimento não encontrado ou não pertence a este item.');
  END IF;

  -- Update stock atomically
  IF v_type = 'entrada' THEN
    UPDATE public.stock_items
      SET quantity = GREATEST(0, quantity - v_quantity), updated_at = now()
      WHERE id = p_stock_item_id AND quantity >= v_quantity
      RETURNING quantity INTO v_new_qty;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Não é possível cancelar: estoque ficaria negativo.');
    END IF;
  ELSE
    UPDATE public.stock_items
      SET quantity = quantity + v_quantity, updated_at = now()
      WHERE id = p_stock_item_id
      RETURNING quantity INTO v_new_qty;
  END IF;

  -- Delete the movement
  DELETE FROM public.stock_movements WHERE id = p_movement_id;

  RETURN jsonb_build_object('ok', true, 'new_quantity', v_new_qty);
END;$$;

-- marcar_pronto: atomic pedido fulfillment (deduct stock + release reservation in one tx)
CREATE OR REPLACE FUNCTION public.marcar_pedido_pronto(
  p_pedido_id    uuid,
  p_user_name    text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_item RECORD;
  v_exp_item_id uuid;
BEGIN
  FOR v_item IN
    SELECT pi.stock_item_id, pi.quantidade, pi.lote, pi.pedido_id,
           pc.cliente_nome, pc.vendedora_nome
    FROM public.pedido_itens pi
    JOIN public.pedidos_comerciais pc ON pc.id = pi.pedido_id
    WHERE pi.pedido_id = p_pedido_id
  LOOP
    -- Resolve expedicao item (handle case where stock_item is not in expedicao fase)
    SELECT si2.id INTO v_exp_item_id
    FROM public.stock_items si1
    JOIN public.stock_items si2 ON si2.device_id = si1.device_id AND si2.fase = 'expedicao'
    WHERE si1.id = v_item.stock_item_id AND si1.fase != 'expedicao'
    LIMIT 1;

    IF v_exp_item_id IS NULL THEN
      v_exp_item_id := v_item.stock_item_id;
    END IF;

    -- Deduct quantity and release reservation atomically
    UPDATE public.stock_items
    SET
      quantity          = GREATEST(0, quantity - v_item.quantidade),
      quantity_reserved = GREATEST(0, quantity_reserved - v_item.quantidade),
      updated_at        = now()
    WHERE id = v_exp_item_id;

    -- Record movement
    INSERT INTO public.stock_movements(stock_item_id, type, quantity, lote, reason, user_display_name)
    VALUES (
      v_exp_item_id,
      'saida',
      v_item.quantidade,
      v_item.lote,
      'Pedido comercial — cliente: ' || v_item.cliente_nome || ' (separação concluída)',
      COALESCE(v_item.vendedora_nome, p_user_name, 'Estoque')
    );
  END LOOP;

  -- Mark pedido as pronto
  UPDATE public.pedidos_comerciais SET status = 'pronto' WHERE id = p_pedido_id;

  RETURN jsonb_build_object('ok', true);
END;$$;

-- RPC security: ensure atomic RPCs check caller is authenticated
-- (SECURITY DEFINER runs as owner, but we still gate on auth.uid())
CREATE OR REPLACE FUNCTION public.reserve_stock(p_item_id uuid, p_qty integer)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.stock_items
  SET quantity_reserved = quantity_reserved + p_qty
  WHERE id = p_item_id
    AND (quantity - quantity_reserved) >= p_qty
    AND auth.uid() IS NOT NULL;
$$;

-- CRÍTICO: reserve_stock retornava void — se WHERE falhasse (estoque insuficiente),
-- o RPC "sucedia" silenciosamente sem reservar nada e sem retornar erro.
-- Corrigido para retornar jsonb com ok/error.
CREATE OR REPLACE FUNCTION public.reserve_stock(p_item_id uuid, p_qty integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_rows integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'Não autenticado');
  END IF;

  UPDATE public.stock_items
  SET quantity_reserved = quantity_reserved + p_qty
  WHERE id = p_item_id
    AND (quantity - quantity_reserved) >= p_qty;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object('error', 'Estoque insuficiente ou item não encontrado');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;$$;
