-- ── admin_clear_history ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_clear_history()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores podem apagar o histórico';
  END IF;
  DELETE FROM public.pedido_itens;
  DELETE FROM public.pedidos_comerciais;
  DELETE FROM public.stock_movements;
  UPDATE public.stock_items SET quantity = 0, quantity_reserved = 0;
END;
$$;
