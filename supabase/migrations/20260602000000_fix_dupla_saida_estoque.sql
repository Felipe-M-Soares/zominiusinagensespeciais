-- =============================================================================
-- FIX: Dupla saída de estoque ao confirmar pedido
-- =============================================================================
-- Problema: marcar_pedido_pronto JÁ desconta quantity do estoque.
-- faturar_pedido_sefaz e faturar_pedido descontavam de novo, zerando
-- o estoque incorretamente.
--
-- Correção: faturar_pedido_sefaz e faturar_pedido NÃO alteram quantity.
-- Apenas zeram quantity_reserved (o pedido saiu de 'pronto' → entregue)
-- e registram o movimento para auditoria.
-- =============================================================================

-- ── faturar_pedido_sefaz (versão corrigida) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.faturar_pedido_sefaz(
  p_pedido_id uuid, p_nf text, p_chave_acesso text, p_protocolo text,
  p_dh_autorizacao timestamptz, p_user_id uuid, p_user_name text,
  p_xml_nfe text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item   RECORD;
  v_status text;
  v_nf_existente text;
BEGIN
  SELECT status, nota_fiscal INTO v_status, v_nf_existente
  FROM public.pedidos_comerciais WHERE id = p_pedido_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado');
  END IF;

  -- Idempotência: já faturado com a mesma NF → retorna sucesso sem reprocessar
  IF v_nf_existente = p_nf THEN
    RETURN jsonb_build_object('ok', true, 'already_faturado', true);
  END IF;

  -- Apenas pedidos 'pronto' podem ser faturados
  IF v_status NOT IN ('pronto') THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'Pedido deve estar no status "pronto" para ser faturado. Status atual: ' || v_status);
  END IF;

  UPDATE public.pedidos_comerciais SET
    status            = 'enviado',
    nota_fiscal       = p_nf,
    chave_acesso_nfe  = p_chave_acesso,
    protocolo_sefaz   = p_protocolo,
    dh_autorizacao_nfe = p_dh_autorizacao,
    nf_criada_por     = p_user_id,
    nf_criada_em      = now(),
    enviado_em        = now(),
    xml_nfe           = p_xml_nfe
  WHERE id = p_pedido_id;

  -- Apenas libera a reserva — o estoque (quantity) JÁ foi descontado
  -- pelo marcar_pedido_pronto. Não desconta de novo.
  FOR v_item IN
    SELECT pi.stock_item_id, pi.quantidade, pi.lote
    FROM public.pedido_itens pi
    WHERE pi.pedido_id = p_pedido_id
  LOOP
    UPDATE public.stock_items SET
      quantity_reserved = GREATEST(0, quantity_reserved - v_item.quantidade)
    WHERE id = v_item.stock_item_id;

    -- Movimento de auditoria (marcado como faturamento, sem afetar saldo)
    INSERT INTO public.stock_movements(stock_item_id, type, quantity, reason, lote, user_id, user_display_name)
    VALUES(
      v_item.stock_item_id, 'saida_nf', v_item.quantidade,
      'NF-e ' || p_nf || ' | Prot: ' || p_protocolo,
      v_item.lote, p_user_id, p_user_name
    );
  END LOOP;

  -- Registra na auditoria
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (p_user_id, p_user_name, 'faturar_nf', 'pedido_comercial', p_pedido_id,
    jsonb_build_object('nota_fiscal', p_nf, 'protocolo', p_protocolo));

  RETURN jsonb_build_object('ok', true, 'nf', p_nf);
END;
$$;

GRANT EXECUTE ON FUNCTION public.faturar_pedido_sefaz(uuid,text,text,text,timestamptz,uuid,text,text) TO authenticated;

-- ── faturar_pedido (versão corrigida — mesmo princípio) ───────────────────────
CREATE OR REPLACE FUNCTION public.faturar_pedido(
  p_pedido_id uuid, p_nf text, p_user_id uuid, p_user_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item RECORD;
BEGIN
  UPDATE public.pedidos_comerciais SET
    status = 'faturado', nota_fiscal = p_nf, faturado_em = now()
  WHERE id = p_pedido_id AND status = 'pronto';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Pedido não encontrado ou status inválido');
  END IF;

  FOR v_item IN
    SELECT pi.stock_item_id, pi.quantidade, pi.lote
    FROM public.pedido_itens pi
    WHERE pi.pedido_id = p_pedido_id
  LOOP
    -- Apenas libera reserva — quantity já foi descontado pelo marcar_pedido_pronto
    UPDATE public.stock_items SET
      quantity_reserved = GREATEST(0, quantity_reserved - v_item.quantidade)
    WHERE id = v_item.stock_item_id;

    INSERT INTO public.stock_movements(stock_item_id, type, quantity, reason, lote, user_id, user_display_name)
    VALUES(v_item.stock_item_id, 'saida_nf', v_item.quantidade, 'NF ' || p_nf,
           v_item.lote, p_user_id, p_user_name);
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.faturar_pedido(uuid,text,uuid,text) TO authenticated;
