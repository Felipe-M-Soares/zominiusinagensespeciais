-- =============================================================================
-- CORREÇÃO: estoque da expedição não voltava ao cancelar pedido / remover peça
-- =============================================================================
--
-- Fluxo do bug relatado:
--   1. Vendedora cria pedido → peça fica RESERVADA (quantity_reserved).
--   2. Estoque separa o pedido (marcar_pedido_pronto) → a quantidade física
--      É DEBITADA da peça na fase "expedição" (stock_items.quantity) e um
--      snapshot de quais lotes/quantidades foram usados fica salvo em
--      pedidos_comerciais.lotes_separados. Isso é o "separado" mencionado.
--   3. Estoque devolve o pedido pro comercial pra correção (RetornarPedidoModal
--      → status = 'retorno'). A peça CONTINUA separada/debitada da expedição —
--      isso está certo, o pedido ainda pode ser concluído.
--   4. Se a vendedora então CANCELA o pedido inteiro OU remove só uma peça
--      dele, o app só liberava a RESERVA (quantity_reserved) — a quantidade
--      que já tinha sido fisicamente debitada da expedição no passo 2 nunca
--      voltava. Resultado: a peça "sumia" da contagem da expedição pra
--      sempre, mesmo a venda nunca tendo se concretizado.
--
-- Correção: tanto cancel_pedido quanto a remoção de um item individual agora
-- devolvem a quantidade física pra expedição (a partir do snapshot
-- lotes_separados) e registram o movimento de entrada correspondente, além
-- de continuar liberando a reserva normalmente.

-- ── cancel_pedido — devolve TODA a separação (se houver) ao cancelar ─────────
CREATE OR REPLACE FUNCTION public.cancel_pedido(p_pedido_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f04$
DECLARE
  v_vendedora_id     uuid;
  v_status           text;
  v_lotes_separados  jsonb;
  v_elem             jsonb;
  v_qtd              integer;
  v_uid              uuid := auth.uid();
  v_name             text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;
  IF NOT public.check_rate_limit('cancel_pedido') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Muitas requisições. Aguarde alguns segundos.');
  END IF;

  SELECT vendedora_id, status, lotes_separados
  INTO v_vendedora_id, v_status, v_lotes_separados
  FROM public.pedidos_comerciais WHERE id = p_pedido_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado'); END IF;
  IF v_status = 'cancelado' THEN RETURN jsonb_build_object('ok', true); END IF;
  IF v_status IN ('faturado','enviado') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido já faturado não pode ser cancelado');
  END IF;
  IF NOT public.is_admin_user() AND v_vendedora_id != v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão para cancelar este pedido');
  END IF;

  -- Libera reserva "normal" — cobre itens que ainda não passaram por separação.
  UPDATE public.stock_items si
  SET quantity_reserved = GREATEST(0, si.quantity_reserved - pi.quantidade_reservada)
  FROM public.pedido_itens pi
  WHERE pi.pedido_id = p_pedido_id AND pi.stock_item_id = si.id;

  -- Devolve fisicamente o que já tinha sido separado (debitado da expedição).
  IF v_lotes_separados IS NOT NULL AND jsonb_array_length(v_lotes_separados) > 0 THEN
    SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid;
    FOR v_elem IN SELECT * FROM jsonb_array_elements(v_lotes_separados)
    LOOP
      v_qtd := COALESCE((v_elem->>'quantidade')::int, 0);
      IF v_qtd <= 0 OR (v_elem->>'stock_item_id') IS NULL THEN CONTINUE; END IF;

      UPDATE public.stock_items
      SET quantity = quantity + v_qtd, updated_at = now()
      WHERE id = (v_elem->>'stock_item_id')::uuid;

      INSERT INTO public.stock_movements(stock_item_id, type, quantity, lote, reason, user_id, user_display_name)
      VALUES ((v_elem->>'stock_item_id')::uuid, 'entrada', v_qtd, (v_elem->>'lote'),
        'Pedido cancelado — devolução da separação para a expedição', v_uid, COALESCE(v_name, 'Desconhecido'));
    END LOOP;
  END IF;

  UPDATE public.pedidos_comerciais SET status = 'cancelado', lotes_separados = NULL WHERE id = p_pedido_id;
  RETURN jsonb_build_object('ok', true);
END; $f04$;
GRANT EXECUTE ON FUNCTION public.cancel_pedido(uuid) TO authenticated;

-- ── remove_pedido_item — remove UMA peça do pedido, devolvendo reserva E,
--    se aplicável, a parte já separada dela na expedição ────────────────────
-- Substitui o fluxo anterior do frontend (DELETE direto em pedido_itens +
-- RPC release_item_reservation em duas chamadas separadas, sem tocar em
-- lotes_separados) por uma única operação atômica e auditada.
CREATE OR REPLACE FUNCTION public.remove_pedido_item(p_pedido_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_rpi$
DECLARE
  v_item          RECORD;
  v_elem          jsonb;
  v_restante      jsonb := '[]'::jsonb;
  v_qtd           integer;
  v_achou_separado boolean := false;
  v_uid           uuid := auth.uid();
  v_name          text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;
  IF NOT public.check_rate_limit('remove_pedido_item') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Muitas requisições. Aguarde alguns segundos.');
  END IF;

  SELECT
    pi.id, pi.pedido_id, pi.stock_item_id, pi.quantidade, pi.quantidade_reservada,
    pc.vendedora_id, pc.status, pc.lotes_separados
  INTO v_item
  FROM public.pedido_itens pi
  JOIN public.pedidos_comerciais pc ON pc.id = pi.pedido_id
  WHERE pi.id = p_pedido_item_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado'); END IF;
  IF v_item.status IN ('faturado','enviado','cancelado') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido já faturado/cancelado — não é possível remover itens.');
  END IF;
  IF NOT public.is_admin_user() AND v_item.vendedora_id != v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão para editar este pedido');
  END IF;
  IF (SELECT COUNT(*) FROM public.pedido_itens WHERE pedido_id = v_item.pedido_id) <= 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'O pedido precisa ter ao menos 1 peça.');
  END IF;

  -- Libera a reserva "normal" do item (mesmo comportamento de release_item_reservation).
  UPDATE public.stock_items
  SET quantity_reserved = GREATEST(0, quantity_reserved - v_item.quantidade_reservada)
  WHERE id = v_item.stock_item_id;

  -- Se essa peça específica já tinha sido separada (snapshot marcado com o
  -- pedido_item_id dela em lotes_separados), devolve a quantidade física pra
  -- expedição e tira essa entrada do snapshot — as demais entradas (de
  -- outras peças do mesmo pedido) continuam intactas.
  IF v_item.lotes_separados IS NOT NULL AND jsonb_array_length(v_item.lotes_separados) > 0 THEN
    SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid;
    FOR v_elem IN SELECT * FROM jsonb_array_elements(v_item.lotes_separados)
    LOOP
      IF (v_elem->>'pedido_item_id')::uuid = p_pedido_item_id THEN
        v_achou_separado := true;
        v_qtd := COALESCE((v_elem->>'quantidade')::int, 0);
        IF v_qtd > 0 AND (v_elem->>'stock_item_id') IS NOT NULL THEN
          UPDATE public.stock_items
          SET quantity = quantity + v_qtd, updated_at = now()
          WHERE id = (v_elem->>'stock_item_id')::uuid;

          INSERT INTO public.stock_movements(stock_item_id, type, quantity, lote, reason, user_id, user_display_name)
          VALUES ((v_elem->>'stock_item_id')::uuid, 'entrada', v_qtd, (v_elem->>'lote'),
            'Peça removida do pedido antes do faturamento — devolução da separação', v_uid, COALESCE(v_name, 'Desconhecido'));
        END IF;
      ELSE
        v_restante := v_restante || jsonb_build_array(v_elem);
      END IF;
    END LOOP;

    IF v_achou_separado THEN
      UPDATE public.pedidos_comerciais SET lotes_separados = v_restante WHERE id = v_item.pedido_id;
    END IF;
  END IF;

  DELETE FROM public.pedido_itens WHERE id = p_pedido_item_id;

  RETURN jsonb_build_object('ok', true);
END;
$f_rpi$;
GRANT EXECUTE ON FUNCTION public.remove_pedido_item(uuid) TO authenticated;
