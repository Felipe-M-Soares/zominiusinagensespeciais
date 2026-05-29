-- ─────────────────────────────────────────────────────────────────────────────
-- Migração: Fluxo Intermediária → Expedição
-- Adiciona coluna `fase` à tabela stock_items para separar peças
-- desenbaladas (intermediaria) de peças embaladas prontas para venda (expedicao).
-- ─────────────────────────────────────────────────────────────────────────────

-- Garante que stock_items existe (cria caso não exista)
CREATE TABLE IF NOT EXISTS public.stock_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    min_quantity INTEGER NOT NULL DEFAULT 0,
    location TEXT,
    notes TEXT,
    fase TEXT NOT NULL DEFAULT 'intermediaria'
        CHECK (fase IN ('intermediaria', 'expedicao')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Garante que stock_movements existe
CREATE TABLE IF NOT EXISTS public.stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_item_id UUID REFERENCES public.stock_items(id) ON DELETE CASCADE NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('entrada', 'saida')),
    quantity INTEGER NOT NULL,
    reason TEXT,
    lote TEXT,
    user_id UUID,
    user_display_name TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Se a coluna `fase` ainda não existe na tabela (caso a tabela já existisse),
-- adiciona agora com valor padrão 'intermediaria'.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'stock_items'
          AND column_name = 'fase'
    ) THEN
        ALTER TABLE public.stock_items
            ADD COLUMN fase TEXT NOT NULL DEFAULT 'intermediaria'
                CHECK (fase IN ('intermediaria', 'expedicao'));
    END IF;
END;
$$;

-- Remove constraint antiga de unicidade apenas por device_id (se existir)
-- para dar lugar à nova que combina device_id + fase
DO $$
DECLARE
    c TEXT;
BEGIN
    SELECT constraint_name INTO c
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'stock_items'
      AND constraint_type = 'UNIQUE'
      AND constraint_name LIKE '%device_id%'
      AND constraint_name NOT LIKE '%fase%';
    IF c IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.stock_items DROP CONSTRAINT %I', c);
    END IF;
END;
$$;

-- Nova constraint única: cada device pode ter até uma linha por fase
ALTER TABLE public.stock_items
    DROP CONSTRAINT IF EXISTS stock_items_device_id_fase_key;

ALTER TABLE public.stock_items
    ADD CONSTRAINT stock_items_device_id_fase_key UNIQUE (device_id, fase);

-- Trigger de updated_at para stock_items (caso não exista)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'update_stock_items_updated_at'
    ) THEN
        CREATE TRIGGER update_stock_items_updated_at
            BEFORE UPDATE ON public.stock_items
            FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
    END IF;
END;
$$;

-- RLS
ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- Políticas de stock_items
DROP POLICY IF EXISTS "Authenticated users can view stock_items" ON public.stock_items;
CREATE POLICY "Authenticated users can view stock_items"
    ON public.stock_items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can manage stock_items" ON public.stock_items;
CREATE POLICY "Admins can manage stock_items"
    ON public.stock_items FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated users can manage stock_items" ON public.stock_items;
CREATE POLICY "Authenticated users can manage stock_items"
    ON public.stock_items FOR ALL TO authenticated USING (true);

-- Políticas de stock_movements
DROP POLICY IF EXISTS "Authenticated users can view stock_movements" ON public.stock_movements;
CREATE POLICY "Authenticated users can view stock_movements"
    ON public.stock_movements FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage stock_movements" ON public.stock_movements;
CREATE POLICY "Authenticated users can manage stock_movements"
    ON public.stock_movements FOR ALL TO authenticated USING (true);

-- Tabelas de backup (caso não existam)
CREATE TABLE IF NOT EXISTS public.backup_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule TEXT NOT NULL DEFAULT 'mon_fri',
    last_backup TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stock_backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by UUID,
    created_name TEXT,
    item_count INTEGER NOT NULL DEFAULT 0,
    payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.backup_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage backup_configs" ON public.backup_configs;
CREATE POLICY "Authenticated users can manage backup_configs"
    ON public.backup_configs FOR ALL TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage stock_backups" ON public.stock_backups;
CREATE POLICY "Authenticated users can manage stock_backups"
    ON public.stock_backups FOR ALL TO authenticated USING (true);
