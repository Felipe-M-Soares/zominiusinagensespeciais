-- =============================================================================
-- SEG-DEFINER-01: Adiciona SET search_path em todas as funções SECURITY DEFINER
-- sem search_path explícito.
--
-- Funções SECURITY DEFINER sem SET search_path são vulneráveis a privilege
-- escalation: um atacante com permissão CREATE pode criar objetos com o mesmo
-- nome em schemas com precedência maior, fazendo a função executar código
-- arbitrário com os privilégios do owner (postgres).
--
-- Referência: https://www.postgresql.org/docs/current/sql-createfunction.html
-- CWE-1321 / CVE pattern: search_path injection in SECURITY DEFINER functions
-- =============================================================================

-- ── reserve_stock ─────────────────────────────────────────────────────────────
-- Versão final (jsonb) — já definida em 20260509000001; apenas adiciona search_path
CREATE OR REPLACE FUNCTION public.reserve_stock(p_item_id uuid, p_qty integer)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.stock_items
  SET quantity_reserved = quantity_reserved + p_qty
  WHERE id = p_item_id
    AND (quantity - quantity_reserved) >= p_qty;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Estoque insuficiente ou item não encontrado');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── admin_clear_history ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_clear_history()
RETURNS void LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores podem apagar o histórico';
  END IF;

  DELETE FROM public.pedido_itens;
  DELETE FROM public.pedidos_comerciais;
  DELETE FROM public.stock_movements;
  UPDATE public.stock_items
    SET quantity = 0, quantity_reserved = 0;
END;
$$;

-- ── cancel_movement ───────────────────────────────────────────────────────────
-- Redeclara com search_path (preserva lógica exata da migration anterior)
CREATE OR REPLACE FUNCTION public.cancel_movement(p_movement_id uuid, p_stock_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movement public.stock_movements%ROWTYPE;
  v_updated  integer;
BEGIN
  -- Verifica autenticação
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado');
  END IF;

  -- Busca o movimento
  SELECT * INTO v_movement FROM public.stock_movements WHERE id = p_movement_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Movimento não encontrado');
  END IF;

  -- Reverte o estoque de forma atômica
  IF v_movement.type = 'entrada' THEN
    UPDATE public.stock_items
    SET quantity = GREATEST(0, quantity - v_movement.quantity)
    WHERE id = p_stock_item_id;
  ELSIF v_movement.type = 'saida' THEN
    UPDATE public.stock_items
    SET quantity = quantity + v_movement.quantity
    WHERE id = p_stock_item_id;
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Remove o movimento
  DELETE FROM public.stock_movements WHERE id = p_movement_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── marcar_pedido_pronto ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.marcar_pedido_pronto(
  p_pedido_id  uuid,
  p_user_name  text
) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado');
  END IF;

  UPDATE public.pedidos_comerciais
  SET status = 'pronto', separado_por = p_user_name, separado_em = now()
  WHERE id = p_pedido_id AND status = 'separando';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado ou status inválido');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── faturar_pedido ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.faturar_pedido(
  p_pedido_id  uuid,
  p_nf         text,
  p_user_id    uuid,
  p_user_name  text
) RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
BEGIN
  UPDATE public.pedidos_comerciais
  SET status = 'faturado', nota_fiscal = p_nf, faturado_em = now()
  WHERE id = p_pedido_id AND status = 'pronto';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Pedido não encontrado ou status inválido');
  END IF;

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

    INSERT INTO public.stock_movements(stock_item_id, type, quantity, reason, lote, user_id, user_display_name)
    VALUES (
      v_item.stock_item_id,
      'saida',
      v_item.quantidade,
      'NF ' || p_nf,
      v_item.lote,
      p_user_id,
      p_user_name
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;
