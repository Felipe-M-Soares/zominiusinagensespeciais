-- Atualiza faturar_pedido_sefaz para aceitar e salvar o xml_nfe da NF autorizada.
-- Mantém compatibilidade: p_xml_nfe é opcional (default NULL).
CREATE OR REPLACE FUNCTION public.faturar_pedido_sefaz(
  p_pedido_id      uuid,
  p_nf             text,
  p_chave_acesso   text,
  p_protocolo      text,
  p_dh_autorizacao timestamptz,
  p_user_id        uuid,
  p_user_name      text,
  p_xml_nfe        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
BEGIN
  UPDATE public.pedidos_comerciais
  SET
    status              = 'faturado',
    nota_fiscal         = p_nf,
    chave_acesso_nfe    = p_chave_acesso,
    protocolo_sefaz     = p_protocolo,
    dh_autorizacao_nfe  = p_dh_autorizacao,
    nf_criada_por       = p_user_id,
    nf_criada_em        = now(),
    enviado_em          = now(),
    xml_nfe             = p_xml_nfe
  WHERE id = p_pedido_id AND status = 'pronto';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Pedido não encontrado ou status inválido');
  END IF;

  -- Baixa estoque atomicamente
  FOR v_item IN
    SELECT pi.stock_item_id, pi.quantidade, pi.lote
    FROM public.pedido_itens pi
    WHERE pi.pedido_id = p_pedido_id
  LOOP
    UPDATE public.stock_items
    SET
      quantity          = GREATEST(0, quantity - v_item.quantidade),
      quantity_reserved = GREATEST(0, quantity_reserved - v_item.quantidade)
    WHERE id = v_item.stock_item_id;

    INSERT INTO public.stock_movements (
      stock_item_id, type, quantity, reason, user_id, user_display_name, lote
    ) VALUES (
      v_item.stock_item_id,
      'saida',
      v_item.quantidade,
      'Saída via NF ' || p_nf || ' — Pedido ' || p_pedido_id::text,
      p_user_id,
      p_user_name,
      v_item.lote
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'nf', p_nf);
END;
$$;

GRANT EXECUTE ON FUNCTION public.faturar_pedido_sefaz TO authenticated;
