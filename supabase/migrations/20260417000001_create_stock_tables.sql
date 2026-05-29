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

DROP TRIGGER IF EXISTS trg_stock_items_updated_at ON public.stock_items;
CREATE TRIGGER trg_stock_items_updated_at
  BEFORE UPDATE ON public.stock_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_stock_items_updated_at();

-- RLS
ALTER TABLE public.stock_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- ── Helper: verifica se o usuário autenticado é admin ──────────────────────
-- Usa a tabela user_roles com enum app_role ('admin' | 'client')
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = 'admin'
  );
$$;

-- ── Helper: verifica se o usuário é aprovado e não bloqueado ───────────────
CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid()
      AND approved = true
  );
$$;

-- ── Políticas: stock_items ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "stock_items_select"      ON public.stock_items;
DROP POLICY IF EXISTS "stock_items_write_admin" ON public.stock_items;

-- Leitura: qualquer usuário aprovado
drop policy if exists "stock_items_select" on public.stock_items;
CREATE POLICY "stock_items_select" ON public.stock_items
  FOR SELECT USING (public.is_approved_user());

-- Escrita (insert/update/delete): apenas admins
drop policy if exists "stock_items_write_admin" on public.stock_items;
CREATE POLICY "stock_items_write_admin" ON public.stock_items
  FOR ALL USING (public.is_admin_user());

-- ── Políticas: stock_movements ─────────────────────────────────────────────

DROP POLICY IF EXISTS "stock_movements_select" ON public.stock_movements;
DROP POLICY IF EXISTS "stock_movements_insert" ON public.stock_movements;

-- Leitura: qualquer aprovado
drop policy if exists "stock_movements_select" on public.stock_movements;
CREATE POLICY "stock_movements_select" ON public.stock_movements
  FOR SELECT USING (public.is_approved_user());

-- Inserção: qualquer aprovado pode registrar movimentos
drop policy if exists "stock_movements_insert" on public.stock_movements;
CREATE POLICY "stock_movements_insert" ON public.stock_movements
  FOR INSERT WITH CHECK (public.is_approved_user());

-- ── Índices de performance ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_stock_items_device_id   ON public.stock_items(device_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_id ON public.stock_movements(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON public.stock_movements(created_at DESC);
