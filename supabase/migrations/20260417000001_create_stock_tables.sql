-- ============================================================
-- Controle de Estoque de Peças
-- ============================================================

-- Tabela principal: item em estoque (vinculado a um device)
CREATE TABLE IF NOT EXISTS public.stock_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id     uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  quantity      integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  min_quantity  integer NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  location      text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id)
);

-- Tabela de movimentos: entrada e saída
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id  uuid NOT NULL REFERENCES public.stock_items(id) ON DELETE CASCADE,
  type           text NOT NULL CHECK (type IN ('entrada', 'saida')),
  quantity       integer NOT NULL CHECK (quantity > 0),
  reason         text,
  user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Trigger: atualiza updated_at em stock_items
CREATE OR REPLACE FUNCTION public.touch_stock_items_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stock_items_updated_at
  BEFORE UPDATE ON public.stock_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_stock_items_updated_at();

-- RLS
ALTER TABLE public.stock_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- Políticas: usuários aprovados leem; admins escrevem
-- (reusa a lógica de approved/blocked do sistema existente)

-- stock_items: leitura para aprovados
CREATE POLICY "stock_items_select" ON public.stock_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND approved = true AND (blocked IS NULL OR blocked = false)
    )
  );

-- stock_items: insert/update/delete para admins
CREATE POLICY "stock_items_write_admin" ON public.stock_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_admin = true AND approved = true
    )
  );

-- stock_movements: leitura para aprovados
CREATE POLICY "stock_movements_select" ON public.stock_movements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND approved = true AND (blocked IS NULL OR blocked = false)
    )
  );

-- stock_movements: qualquer aprovado pode registrar movimentos
CREATE POLICY "stock_movements_insert" ON public.stock_movements
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND approved = true AND (blocked IS NULL OR blocked = false)
    )
  );

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_stock_items_device_id    ON public.stock_items(device_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_id  ON public.stock_movements(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created  ON public.stock_movements(created_at DESC);
