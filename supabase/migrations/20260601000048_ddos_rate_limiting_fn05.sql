CREATE OR REPLACE FUNCTION public.faturar_pedido_sefaz(
  p_pedido_id uuid, p_nf text, p_chave_acesso text, p_protocolo text,
  p_dh_autorizacao timestamptz, p_user_id uuid, p_user_name text,
  p_xml_nfe text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END; $$;
GRANT EXECUTE ON FUNCTION public.faturar_pedido_sefaz(uuid,text,text,text,timestamptz,uuid,text,text) TO authenticated;
