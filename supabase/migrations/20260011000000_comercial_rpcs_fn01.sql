-- ── cancel_pedido ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_pedido(p_pedido_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.stock_items si
  SET quantity_reserved = GREATEST(0, si.quantity_reserved - pi.quantidade_reservada)
  FROM public.pedido_itens pi
  WHERE pi.pedido_id = p_pedido_id AND pi.stock_item_id = si.id;

  UPDATE public.pedidos_comerciais SET status = 'cancelado' WHERE id = p_pedido_id;
  RETURN jsonb_build_object('success', true);
END;
$$;
