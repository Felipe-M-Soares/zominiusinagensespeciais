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
