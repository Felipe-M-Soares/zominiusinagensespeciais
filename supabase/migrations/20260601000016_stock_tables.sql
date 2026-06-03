-- =============================================================================
-- 008: Estoque — stock_items, stock_movements, backup, recebimento
-- =============================================================================

-- ── stock_items ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id         uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  quantity          integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  quantity_reserved integer NOT NULL DEFAULT 0,
  min_quantity      integer NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  location          text,
  notes             text,
  fase              text NOT NULL DEFAULT 'intermediaria'
                    CHECK (fase IN ('intermediaria','expedicao','retrabalho')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Constraint única: apenas 1 linha por device em intermediaria e expedicao
CREATE UNIQUE INDEX IF NOT EXISTS stock_items_device_intermediaria_unique
  ON public.stock_items (device_id) WHERE fase = 'intermediaria';

CREATE UNIQUE INDEX IF NOT EXISTS stock_items_device_expedicao_unique
  ON public.stock_items (device_id) WHERE fase = 'expedicao';

ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_stock_items_updated_at ON public.stock_items;
CREATE TRIGGER trg_stock_items_updated_at
  BEFORE UPDATE ON public.stock_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── stock_movements ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id     uuid NOT NULL REFERENCES public.stock_items(id) ON DELETE CASCADE,
  type              text NOT NULL CHECK (type IN ('entrada','saida')),
  quantity          integer NOT NULL CHECK (quantity > 0),
  reason            text,
  lote              text,
  user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_display_name text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- ── backup_configs ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.backup_configs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule    text NOT NULL DEFAULT 'mon_thu'
              CHECK (schedule IN ('mon_thu','tue_fri','wed_sat','mon_fri')),
  last_backup timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS backup_configs_single ON public.backup_configs ((true));
ALTER TABLE public.backup_configs ENABLE ROW LEVEL SECURITY;

-- ── stock_backups ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_backups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_name text,
  item_count   integer NOT NULL DEFAULT 0,
  payload      jsonb NOT NULL DEFAULT '{}',
  file_path    text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_backups ENABLE ROW LEVEL SECURITY;

-- ── recebimento de materiais ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recebimento_materiais (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote              text NOT NULL,
  quantity          integer NOT NULL CHECK (quantity > 0),
  descricao         text NOT NULL,
  fornecedor        text,
  status            text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','retirado')),
  user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_display_name text,
  retirado_por      text,
  retirado_em       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.recebimento_materiais ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_recebimento_updated_at ON public.recebimento_materiais;
CREATE TRIGGER trg_recebimento_updated_at
  BEFORE UPDATE ON public.recebimento_materiais
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "stock_items_select"      ON public.stock_items;
DROP POLICY IF EXISTS "stock_items_write_admin" ON public.stock_items;
CREATE POLICY "stock_items_select"      ON public.stock_items FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "stock_items_write_admin" ON public.stock_items FOR ALL    TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS "stock_movements_select"      ON public.stock_movements;
DROP POLICY IF EXISTS "stock_movements_insert"      ON public.stock_movements;
DROP POLICY IF EXISTS "stock_movements_write_admin" ON public.stock_movements;
CREATE POLICY "stock_movements_select"      ON public.stock_movements FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "stock_movements_insert"      ON public.stock_movements FOR INSERT TO authenticated WITH CHECK (public.is_approved_user() AND (user_id IS NULL OR user_id = auth.uid()));
CREATE POLICY "stock_movements_write_admin" ON public.stock_movements FOR ALL    TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS "backup_configs_admin" ON public.backup_configs;
CREATE POLICY "backup_configs_admin" ON public.backup_configs FOR ALL TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS "stock_backups_select"      ON public.stock_backups;
DROP POLICY IF EXISTS "stock_backups_write_admin" ON public.stock_backups;
CREATE POLICY "stock_backups_select"      ON public.stock_backups FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "stock_backups_write_admin" ON public.stock_backups FOR ALL    TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS "recebimento_select" ON public.recebimento_materiais;
DROP POLICY IF EXISTS "recebimento_insert" ON public.recebimento_materiais;
DROP POLICY IF EXISTS "recebimento_update" ON public.recebimento_materiais;
DROP POLICY IF EXISTS "recebimento_delete" ON public.recebimento_materiais;
CREATE POLICY "recebimento_select" ON public.recebimento_materiais FOR SELECT USING (public.is_approved_user());
CREATE POLICY "recebimento_insert" ON public.recebimento_materiais FOR INSERT WITH CHECK (public.is_approved_user());
CREATE POLICY "recebimento_update" ON public.recebimento_materiais FOR UPDATE USING (public.is_approved_user());
CREATE POLICY "recebimento_delete" ON public.recebimento_materiais FOR DELETE USING (public.is_admin_user());

-- ── Índices ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_stock_items_device_id   ON public.stock_items(device_id);
CREATE INDEX IF NOT EXISTS idx_stock_items_fase        ON public.stock_items(fase);
CREATE INDEX IF NOT EXISTS idx_stock_items_fase_reserved ON public.stock_items(fase, quantity_reserved);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_id ON public.stock_movements(stock_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_lote    ON public.stock_movements(lote) WHERE lote IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_movements_lote_trgm ON public.stock_movements USING GIN (lote gin_trgm_ops) WHERE lote IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recebimento_status      ON public.recebimento_materiais(status);
CREATE INDEX IF NOT EXISTS idx_recebimento_lote        ON public.recebimento_materiais(lote);
