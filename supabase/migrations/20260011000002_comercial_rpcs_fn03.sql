-- ── faturar_pedido ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.faturar_pedido(p_pedido_id uuid, p_nf text, p_user_id uuid, p_user_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item RECORD;
BEGIN
  UPDATE public.pedidos_comerciais SET status='faturado', nota_fiscal=p_nf, faturado_em=now()
  WHERE id=p_pedido_id AND status='pronto';
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Pedido não encontrado ou status inválido'); END IF;

  FOR v_item IN SELECT pi.stock_item_id, pi.quantidade, pi.lote FROM public.pedido_itens pi WHERE pi.pedido_id=p_pedido_id
  LOOP
    UPDATE public.stock_items SET quantity=GREATEST(0,quantity-v_item.quantidade), quantity_reserved=GREATEST(0,quantity_reserved-v_item.quantidade) WHERE id=v_item.stock_item_id;
    INSERT INTO public.stock_movements(stock_item_id,type,quantity,reason,lote,user_id,user_display_name)
    VALUES(v_item.stock_item_id,'saida',v_item.quantidade,'NF '||p_nf,v_item.lote,p_user_id,p_user_name);
  END LOOP;
  RETURN jsonb_build_object('ok',true);
END;
$$;
