CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_action text,
  p_user_id uuid DEFAULT auth.uid()
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count   integer;
  v_max     integer;
  v_window  integer; -- seconds
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;

  -- Configuração por ação
  CASE p_action
    WHEN 'stock_movement_atomic'  THEN v_max := 60;  v_window := 60;
    WHEN 'reserve_stock'          THEN v_max := 20;  v_window := 60;
    WHEN 'cancel_pedido'          THEN v_max := 10;  v_window := 60;
    WHEN 'faturar_pedido_sefaz'   THEN v_max := 5;   v_window := 60;
    WHEN 'marcar_pedido_pronto'   THEN v_max := 30;  v_window := 60;
    WHEN 'import_devices'         THEN v_max := 3;   v_window := 300;
    ELSE                               v_max := 100; v_window := 60;
  END CASE;

  SELECT COUNT(*) INTO v_count
  FROM public.rate_limit_log
  WHERE user_id = p_user_id
    AND action  = p_action
    AND created_at > now() - (v_window || ' seconds')::interval;

  IF v_count >= v_max THEN RETURN false; END IF;

  -- Registra a chamada atual
  INSERT INTO public.rate_limit_log (user_id, action) VALUES (p_user_id, p_action);
  RETURN true;
END; $$;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, uuid) TO authenticated;
