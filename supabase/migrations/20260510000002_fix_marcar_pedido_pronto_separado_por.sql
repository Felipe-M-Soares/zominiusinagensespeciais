-- ============================================================
-- FIX: marcar_pedido_pronto — separado_por é uuid, não text
-- ============================================================
-- A migration 20260509000002 reescreveu a função com
-- separado_por = p_user_name (text), mas a coluna é uuid.
-- Corrige usando auth.uid() diretamente (já disponível pois
-- a função é SECURITY DEFINER e valida auth.uid() no início).
-- ============================================================

CREATE OR REPLACE FUNCTION public.marcar_pedido_pronto(
  p_pedido_id  uuid,
  p_user_name  text
) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item        RECORD;
  v_exp_item_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado');
  END IF;

  -- Deduz estoque e libera reservas para cada item do pedido
  FOR v_item IN
    SELECT pi.stock_item_id, pi.quantidade, pi.lote, pi.pedido_id,
           pc.cliente_nome, pc.vendedora_nome
    FROM public.pedido_itens pi
    JOIN public.pedidos_comerciais pc ON pc.id = pi.pedido_id
    WHERE pi.pedido_id = p_pedido_id
  LOOP
    -- Resolve o item de expedição (caso o stock_item não seja da fase expedicao)
    SELECT si2.id INTO v_exp_item_id
    FROM public.stock_items si1
    JOIN public.stock_items si2
      ON si2.device_id = si1.device_id AND si2.fase = 'expedicao'
    WHERE si1.id = v_item.stock_item_id AND si1.fase != 'expedicao'
    LIMIT 1;

    IF v_exp_item_id IS NULL THEN
      v_exp_item_id := v_item.stock_item_id;
    END IF;

    -- Deduz quantidade e libera reserva atomicamente
    UPDATE public.stock_items
    SET
      quantity          = GREATEST(0, quantity - v_item.quantidade),
      quantity_reserved = GREATEST(0, quantity_reserved - v_item.quantidade),
      updated_at        = now()
    WHERE id = v_exp_item_id;

    -- Registra movimento de saída
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

  -- Marca pedido como pronto — usa auth.uid() (uuid) para separado_por
  UPDATE public.pedidos_comerciais
  SET
    status       = 'pronto',
    separado_por = auth.uid(),
    separado_em  = now()
  WHERE id = p_pedido_id AND status = 'separando';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado ou status inválido');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;
