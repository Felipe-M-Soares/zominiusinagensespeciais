-- ============================================================
-- FIX: marcar_pedido_pronto — zera quantity_reserved corretamente
-- ============================================================
-- Ao marcar como pronto:
--   1. Deduz quantity (peças saem fisicamente do estoque)
--   2. Zera quantity_reserved recalculando do zero a partir dos
--      pedidos ainda ativos (pendente/separando) — evita divergência
--      acumulada de bugs anteriores
--   3. Registra movimento de saída
--   4. Marca pedido como pronto
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

  -- Para cada item do pedido: deduz estoque e registra saída
  FOR v_item IN
    SELECT pi.stock_item_id, pi.quantidade, pi.lote,
           cl.nome        AS cliente_nome,
           pc.vendedora_nome
    FROM public.pedido_itens pi
    JOIN public.pedidos_comerciais pc ON pc.id = pi.pedido_id
    JOIN public.clientes cl            ON cl.id = pc.cliente_id
    WHERE pi.pedido_id = p_pedido_id
  LOOP
    -- Resolve item de expedição (caso stock_item não seja da fase expedicao)
    SELECT si2.id INTO v_exp_item_id
    FROM public.stock_items si1
    JOIN public.stock_items si2
      ON si2.device_id = si1.device_id AND si2.fase = 'expedicao'
    WHERE si1.id = v_item.stock_item_id AND si1.fase != 'expedicao'
    LIMIT 1;

    IF v_exp_item_id IS NULL THEN
      v_exp_item_id := v_item.stock_item_id;
    END IF;

    -- Deduz quantidade física do estoque
    UPDATE public.stock_items
    SET quantity   = GREATEST(0, quantity - v_item.quantidade),
        updated_at = now()
    WHERE id = v_exp_item_id;

    -- Recalcula quantity_reserved a partir dos pedidos ainda ativos (pendente/separando)
    -- Ignora o pedido atual (p_pedido_id) pois está sendo concluído agora
    UPDATE public.stock_items si
    SET quantity_reserved = COALESCE((
      SELECT SUM(pi2.quantidade)
      FROM public.pedido_itens pi2
      JOIN public.pedidos_comerciais pc2 ON pc2.id = pi2.pedido_id
      WHERE pi2.stock_item_id = v_exp_item_id
        AND pc2.status IN ('pendente', 'separando')
        AND pc2.id != p_pedido_id
    ), 0)
    WHERE si.id = v_exp_item_id;

    -- Registra movimento de saída
    INSERT INTO public.stock_movements(
      stock_item_id, type, quantity, lote, reason, user_display_name
    ) VALUES (
      v_exp_item_id,
      'saida',
      v_item.quantidade,
      v_item.lote,
      'Pedido comercial — cliente: ' || v_item.cliente_nome || ' (separação concluída)',
      COALESCE(v_item.vendedora_nome, p_user_name, 'Estoque')
    );
  END LOOP;

  -- Marca pedido como pronto
  UPDATE public.pedidos_comerciais
  SET status       = 'pronto',
      separado_por = auth.uid(),
      separado_em  = now()
  WHERE id = p_pedido_id AND status = 'separando';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado ou status inválido');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;
