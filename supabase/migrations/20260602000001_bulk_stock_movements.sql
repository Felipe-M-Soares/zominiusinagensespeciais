-- =============================================================================
-- FIX: Importação em bulk para contornar rate limit do stock_movement_atomic
-- =============================================================================
-- O stock_movement_atomic tem limite de 60 req/60s. Uma importação de 5000+
-- linhas disparava uma chamada por linha e estourava o limite, silenciosamente
-- descartando a maioria das movimentações.
--
-- Esta função recebe um array JSON com todas as movimentações de uma vez e
-- processa em uma única transação, sem rate limit.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.bulk_stock_movements(
  p_movements jsonb,   -- array de {stock_item_id, type, quantity, reason, lote, user_id, user_name}
  p_user_id   uuid,
  p_user_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_elem      jsonb;
  v_item_id   uuid;
  v_type      text;
  v_qty       integer;
  v_reason    text;
  v_lote      text;
  v_current   integer;
  v_ok        integer := 0;
  v_errors    jsonb   := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado');
  END IF;

  IF jsonb_array_length(p_movements) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'inserted', 0);
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_movements)
  LOOP
    v_item_id := (v_elem->>'stock_item_id')::uuid;
    v_type    := v_elem->>'type';
    v_qty     := (v_elem->>'quantity')::integer;
    v_reason  := v_elem->>'reason';
    v_lote    := v_elem->>'lote';

    IF v_type NOT IN ('entrada','saida') THEN
      v_errors := v_errors || jsonb_build_object('item_id', v_item_id, 'error', 'Tipo inválido');
      CONTINUE;
    END IF;
    IF v_qty <= 0 THEN
      v_errors := v_errors || jsonb_build_object('item_id', v_item_id, 'error', 'Quantidade <= 0');
      CONTINUE;
    END IF;

    SELECT quantity INTO v_current FROM public.stock_items WHERE id = v_item_id FOR UPDATE;
    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_object('item_id', v_item_id, 'error', 'Item não encontrado');
      CONTINUE;
    END IF;

    IF v_type = 'saida' AND v_current < v_qty THEN
      v_errors := v_errors || jsonb_build_object('item_id', v_item_id, 'error',
        'Estoque insuficiente: ' || v_current || ' disponível');
      CONTINUE;
    END IF;

    UPDATE public.stock_items
    SET quantity = CASE
          WHEN v_type = 'entrada' THEN quantity + v_qty
          ELSE GREATEST(0, quantity - v_qty)
        END,
        updated_at = now()
    WHERE id = v_item_id;

    INSERT INTO public.stock_movements (stock_item_id, type, quantity, reason, lote, user_id, user_display_name)
    VALUES (v_item_id, v_type, v_qty, v_reason, v_lote, p_user_id, p_user_name);

    v_ok := v_ok + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'inserted', v_ok, 'errors', v_errors);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_stock_movements(jsonb, uuid, text) TO authenticated;
