-- PERF-03: Add file_path column to stock_backups for Storage-based backups
ALTER TABLE public.stock_backups
  ADD COLUMN IF NOT EXISTS file_path text;

-- Create the storage bucket for backups (run once; idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('stock-backups', 'stock-backups', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: only admins can read/write backups
CREATE POLICY "admin_backups_all" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'stock-backups'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- PERF-02: Atomic faturar_pedido RPC
-- Replaces multi-step read-update in Financeiro.tsx with a single DB transaction
CREATE OR REPLACE FUNCTION public.faturar_pedido(
  p_pedido_id      uuid,
  p_nf             text,
  p_user_id        uuid,
  p_user_name      text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_item RECORD;
BEGIN
  -- 1. Mark pedido as faturado
  UPDATE public.pedidos_comerciais
  SET status = 'faturado', nota_fiscal = p_nf, faturado_em = now()
  WHERE id = p_pedido_id AND status = 'pronto';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Pedido não encontrado ou status inválido');
  END IF;

  -- 2. For each item: deduct stock + release reservation atomically
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
END;$$;
