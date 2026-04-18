-- ============================================================
-- 1. Adiciona nome do usuário diretamente no movimento
--    (preserva histórico mesmo que o usuário troque o nome)
-- ============================================================
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS user_display_name text;

-- ============================================================
-- 2. Configurações de backup (uma linha por projeto)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.backup_configs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule     text NOT NULL DEFAULT 'mon_thu'
               CHECK (schedule IN ('mon_thu','tue_fri','wed_sat','mon_fri')),
  last_backup  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Garante que existe apenas 1 linha de config
CREATE UNIQUE INDEX IF NOT EXISTS backup_configs_single ON public.backup_configs ((true));

-- ============================================================
-- 3. Tabela de snapshots de backup do estoque
-- ============================================================
CREATE TABLE IF NOT EXISTS public.stock_backups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_name text,
  item_count   integer NOT NULL DEFAULT 0,
  payload      jsonb NOT NULL,          -- snapshot completo
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.backup_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_backups  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "backup_configs_admin" ON public.backup_configs;
DROP POLICY IF EXISTS "stock_backups_admin"  ON public.stock_backups;
DROP POLICY IF EXISTS "stock_backups_select" ON public.stock_backups;

CREATE POLICY "backup_configs_admin" ON public.backup_configs
  FOR ALL USING (public.is_admin_user());

CREATE POLICY "stock_backups_select" ON public.stock_backups
  FOR SELECT USING (public.is_approved_user());

CREATE POLICY "stock_backups_admin"  ON public.stock_backups
  FOR ALL USING (public.is_admin_user());

CREATE INDEX IF NOT EXISTS idx_stock_backups_created ON public.stock_backups(created_at DESC);
