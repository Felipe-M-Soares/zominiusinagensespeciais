-- =============================================================================
-- FIX: Reverte policies incorretas e cria RPC SECURITY DEFINER para inserção
-- de stock_items de expedição/retrabalho
-- =============================================================================
--
-- As policies stock_items_insert_approved e stock_items_update_approved
-- criadas anteriormente causavam erro FK em stock_movements porque o WITH CHECK
-- bloqueava o INSERT do item de destino, fazendo o movement referenciar um
-- stock_item_id inexistente.
--
-- Solução correta: manter o RLS original (apenas admin escreve diretamente)
-- e expor uma RPC SECURITY DEFINER que cria o item de expedição/retrabalho
-- de forma segura e atômica, chamada pelo frontend no lugar do .insert() direto.
-- =============================================================================

-- Remove as policies problemáticas
DROP POLICY IF EXISTS "stock_items_insert_approved" ON public.stock_items;
DROP POLICY IF EXISTS "stock_items_update_approved" ON public.stock_items;

-- RPC: cria item de expedição para um device (idempotente)
CREATE OR REPLACE FUNCTION public.ensure_expedicao_item(
  p_device_id      uuid,
  p_min_quantity   integer DEFAULT 0,
  p_location       text    DEFAULT NULL,
  p_notes          text    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  -- Retorna existente ou insere novo com quantity=0
  INSERT INTO public.stock_items (device_id, quantity, min_quantity, location, notes, fase)
  VALUES (p_device_id, 0, COALESCE(p_min_quantity,0), p_location, p_notes, 'expedicao')
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_id FROM public.stock_items
  WHERE device_id = p_device_id AND fase = 'expedicao';

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_expedicao_item(uuid,integer,text,text) TO authenticated;

-- RPC: cria item de retrabalho para um device+lote (idempotente)
CREATE OR REPLACE FUNCTION public.ensure_retrabalho_item(
  p_device_id  uuid,
  p_lote       text,
  p_location   text DEFAULT NULL,
  p_notes      text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_notes text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  v_notes := 'lote:' || upper(p_lote) || COALESCE(' | ' || p_notes, '');

  -- Verifica se já existe item de retrabalho para este device+lote
  SELECT id INTO v_id FROM public.stock_items
  WHERE device_id = p_device_id AND fase = 'retrabalho'
    AND notes ILIKE '%lote:' || upper(p_lote) || '%'
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.stock_items (device_id, quantity, min_quantity, location, notes, fase)
    VALUES (p_device_id, 0, 0, p_location, v_notes, 'retrabalho')
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_retrabalho_item(uuid,text,text,text) TO authenticated;
