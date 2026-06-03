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
