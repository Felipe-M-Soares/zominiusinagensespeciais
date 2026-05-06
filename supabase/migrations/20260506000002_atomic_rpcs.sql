-- SEG-01 / BUG-12: Atomic stock reservation RPC (replaces read-modify-write in both modals)
CREATE OR REPLACE FUNCTION public.reserve_stock(p_item_id uuid, p_qty integer)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.stock_items
  SET quantity_reserved = quantity_reserved + p_qty
  WHERE id = p_item_id
    AND (quantity - quantity_reserved) >= p_qty;
$$;

-- BUG-01: Atomic stock movement RPC (replaces race-condition prone registerMovement)
CREATE OR REPLACE FUNCTION public.stock_movement_atomic(
  p_item_id uuid,
  p_type text,
  p_qty integer,
  p_reason text,
  p_lote text,
  p_user_id uuid,
  p_user_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_new_qty integer;
BEGIN
  IF p_type = 'saida' THEN
    UPDATE public.stock_items
      SET quantity = quantity - p_qty, updated_at = now()
    WHERE id = p_item_id AND quantity >= p_qty
    RETURNING quantity INTO v_new_qty;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Estoque insuficiente');
    END IF;
  ELSE
    UPDATE public.stock_items
      SET quantity = quantity + p_qty, updated_at = now()
    WHERE id = p_item_id
    RETURNING quantity INTO v_new_qty;
  END IF;

  INSERT INTO public.stock_movements(stock_item_id, type, quantity, reason, lote, user_id, user_display_name)
  VALUES (p_item_id, p_type, p_qty, p_reason, p_lote, p_user_id, p_user_name);

  RETURN jsonb_build_object('ok', true, 'new_quantity', v_new_qty);
END;$$;

-- BUG-05: Atomic pedido cancellation RPC
CREATE OR REPLACE FUNCTION public.cancel_pedido(p_pedido_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Release reserved quantities atomically
  UPDATE public.stock_items si
  SET quantity_reserved = GREATEST(0, si.quantity_reserved - pi.quantidade_reservada)
  FROM public.pedido_itens pi
  WHERE pi.pedido_id = p_pedido_id
    AND pi.stock_item_id = si.id;

  -- Cancel the order
  UPDATE public.pedidos_comerciais
  SET status = 'cancelado'
  WHERE id = p_pedido_id;

  RETURN jsonb_build_object('success', true);
END;$$;

-- PERF-06: Add performance indexes on commercial tables
CREATE INDEX IF NOT EXISTS idx_pedidos_status
  ON public.pedidos_comerciais(status);

CREATE INDEX IF NOT EXISTS idx_pedidos_vendedora
  ON public.pedidos_comerciais(vendedora_id);

CREATE INDEX IF NOT EXISTS idx_pedidos_cliente
  ON public.pedidos_comerciais(cliente_id);

CREATE INDEX IF NOT EXISTS idx_pedidos_created
  ON public.pedidos_comerciais(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido
  ON public.pedido_itens(pedido_id);

CREATE INDEX IF NOT EXISTS idx_pedido_itens_stock_item
  ON public.pedido_itens(stock_item_id);
