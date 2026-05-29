-- =============================================================================
-- 011: RPCs de pedidos — reserva, cancelamento, separação, faturamento
-- =============================================================================

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

-- ── marcar_pedido_pronto ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.marcar_pedido_pronto(p_pedido_id uuid, p_user_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pedido      RECORD;
  v_ls          RECORD;
  v_item        RECORD;
  v_exp_item_id uuid;
  v_cliente     text;
  v_vendedora   text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;

  SELECT pc.id, pc.status, pc.lotes_separados, cl.nome AS cliente_nome, pc.vendedora_nome
  INTO v_pedido
  FROM public.pedidos_comerciais pc JOIN public.clientes cl ON cl.id = pc.cliente_id
  WHERE pc.id = p_pedido_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado'); END IF;
  IF v_pedido.status != 'separando' THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido não está em separação'); END IF;

  v_cliente   := COALESCE(v_pedido.cliente_nome, 'Cliente');
  v_vendedora := COALESCE(v_pedido.vendedora_nome, p_user_name, 'Estoque');

  IF v_pedido.lotes_separados IS NOT NULL AND jsonb_array_length(v_pedido.lotes_separados) > 0 THEN
    FOR v_ls IN
      SELECT (elem->>'stock_item_id')::uuid AS stock_item_id,
             (elem->>'lote')                AS lote,
             (elem->>'quantidade')::int     AS quantidade
      FROM jsonb_array_elements(v_pedido.lotes_separados) AS elem
    LOOP
      SELECT si2.id INTO v_exp_item_id FROM public.stock_items si1
      JOIN public.stock_items si2 ON si2.device_id = si1.device_id AND si2.fase = 'expedicao'
      WHERE si1.id = v_ls.stock_item_id AND si1.fase != 'expedicao' LIMIT 1;
      IF v_exp_item_id IS NULL THEN v_exp_item_id := v_ls.stock_item_id; END IF;

      UPDATE public.stock_items SET quantity = GREATEST(0, quantity - v_ls.quantidade), updated_at = now() WHERE id = v_exp_item_id;
      UPDATE public.stock_items si SET quantity_reserved = COALESCE((
        SELECT SUM(pi2.quantidade) FROM public.pedido_itens pi2
        JOIN public.pedidos_comerciais pc2 ON pc2.id = pi2.pedido_id
        WHERE pi2.stock_item_id = v_exp_item_id AND pc2.status IN ('pendente','separando') AND pc2.id != p_pedido_id
      ), 0) WHERE si.id = v_exp_item_id;

      INSERT INTO public.stock_movements(stock_item_id, type, quantity, lote, reason, user_display_name)
      VALUES (v_exp_item_id, 'saida', v_ls.quantidade, v_ls.lote,
        'Pedido comercial — cliente: ' || v_cliente || ' (lote: ' || COALESCE(v_ls.lote,'—') || ')', v_vendedora);
    END LOOP;
  ELSE
    FOR v_item IN SELECT pi.stock_item_id, pi.quantidade, pi.lote FROM public.pedido_itens pi WHERE pi.pedido_id = p_pedido_id
    LOOP
      SELECT si2.id INTO v_exp_item_id FROM public.stock_items si1
      JOIN public.stock_items si2 ON si2.device_id = si1.device_id AND si2.fase = 'expedicao'
      WHERE si1.id = v_item.stock_item_id AND si1.fase != 'expedicao' LIMIT 1;
      IF v_exp_item_id IS NULL THEN v_exp_item_id := v_item.stock_item_id; END IF;

      UPDATE public.stock_items SET quantity = GREATEST(0, quantity - v_item.quantidade), updated_at = now() WHERE id = v_exp_item_id;
      UPDATE public.stock_items si SET quantity_reserved = COALESCE((
        SELECT SUM(pi2.quantidade) FROM public.pedido_itens pi2
        JOIN public.pedidos_comerciais pc2 ON pc2.id = pi2.pedido_id
        WHERE pi2.stock_item_id = v_exp_item_id AND pc2.status IN ('pendente','separando') AND pc2.id != p_pedido_id
      ), 0) WHERE si.id = v_exp_item_id;

      INSERT INTO public.stock_movements(stock_item_id, type, quantity, lote, reason, user_display_name)
      VALUES (v_exp_item_id, 'saida', v_item.quantidade, v_item.lote,
        'Pedido comercial — cliente: ' || v_cliente || ' (separação concluída)', v_vendedora);
    END LOOP;
  END IF;

  UPDATE public.pedidos_comerciais
  SET status = 'pronto', separado_por = auth.uid(), separado_em = now()
  WHERE id = p_pedido_id AND status = 'separando';

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado ou status inválido'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

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

-- ── faturar_pedido_sefaz ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.faturar_pedido_sefaz(uuid,text,text,text,timestamptz,uuid,text);
DROP FUNCTION IF EXISTS public.faturar_pedido_sefaz(uuid,text,text,text,timestamptz,uuid,text,text);

CREATE OR REPLACE FUNCTION public.faturar_pedido_sefaz(
  p_pedido_id uuid, p_nf text, p_chave_acesso text, p_protocolo text,
  p_dh_autorizacao timestamptz, p_user_id uuid, p_user_name text, p_xml_nfe text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item RECORD;
BEGIN
  UPDATE public.pedidos_comerciais SET
    status='faturado', nota_fiscal=p_nf, chave_acesso_nfe=p_chave_acesso,
    protocolo_sefaz=p_protocolo, dh_autorizacao_nfe=p_dh_autorizacao,
    nf_criada_por=p_user_id, nf_criada_em=now(), enviado_em=now(), xml_nfe=p_xml_nfe
  WHERE id=p_pedido_id AND status='pronto';
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Pedido não encontrado ou status inválido'); END IF;

  FOR v_item IN SELECT pi.stock_item_id, pi.quantidade, pi.lote FROM public.pedido_itens pi WHERE pi.pedido_id=p_pedido_id
  LOOP
    UPDATE public.stock_items SET quantity=GREATEST(0,quantity-v_item.quantidade), quantity_reserved=GREATEST(0,quantity_reserved-v_item.quantidade) WHERE id=v_item.stock_item_id;
    INSERT INTO public.stock_movements(stock_item_id,type,quantity,reason,lote,user_id,user_display_name)
    VALUES(v_item.stock_item_id,'saida',v_item.quantidade,'SEFAZ '||p_nf||' | Prot: '||p_protocolo,v_item.lote,p_user_id,p_user_name);
  END LOOP;
  RETURN jsonb_build_object('ok',true,'nf',p_nf);
END;
$$;
GRANT EXECUTE ON FUNCTION public.faturar_pedido_sefaz(uuid,text,text,text,timestamptz,uuid,text,text) TO authenticated;
