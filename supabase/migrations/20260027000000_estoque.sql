-- =============================================================================
-- ESTOQUE — Tabelas, RPCs, índices, performance (stock_items, movements, backup, recebimento)
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 20260007000000_performance_indexes.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS profiles_user_id_approved_blocked_idx ON public.profiles (user_id, approved, blocked);
CREATE INDEX IF NOT EXISTS profiles_email_idx   ON public.profiles (email);
CREATE INDEX IF NOT EXISTS profiles_login_idx   ON public.profiles (login) WHERE login IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_roles_user_id_idx ON public.user_roles (user_id);
CREATE INDEX IF NOT EXISTS devices_model_idx    ON public.devices (model);
CREATE INDEX IF NOT EXISTS devices_model_trgm_idx     ON public.devices USING GIN (model gin_trgm_ops);
CREATE INDEX IF NOT EXISTS devices_reference_trgm_idx ON public.devices USING GIN (reference gin_trgm_ops);
CREATE INDEX IF NOT EXISTS devices_udi_di_trgm_idx    ON public.devices USING GIN (udi_di gin_trgm_ops);
CREATE INDEX IF NOT EXISTS devices_brand_name_trgm_idx   ON public.devices USING GIN (brand_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS devices_internal_code_trgm_idx ON public.devices USING GIN (internal_code gin_trgm_ops);

ANALYZE public.profiles;
ANALYZE public.user_roles;
ANALYZE public.devices;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260008000000_stock_tables.sql
-- ─────────────────────────────────────────────────────────────────────────────

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

-- ── FK pedido_itens → stock_items (adicionada aqui pois stock_items é criada nesta migration) ──
ALTER TABLE public.pedido_itens
  DROP CONSTRAINT IF EXISTS pedido_itens_stock_item_id_fkey;
ALTER TABLE public.pedido_itens
  ADD CONSTRAINT pedido_itens_stock_item_id_fkey
  FOREIGN KEY (stock_item_id) REFERENCES public.stock_items(id) ON DELETE CASCADE;

-- ── pedido_itens.valor_unitario (coluna usada em dashboard_gerencial e trigger financeiro) ──
ALTER TABLE public.pedido_itens
  ADD COLUMN IF NOT EXISTS valor_unitario numeric(12,4) NOT NULL DEFAULT 0;

-- ── pedido_comentarios: corrige FK user_id ON DELETE SET NULL → CASCADE ───────
-- NOT NULL + SET NULL é impossível; quando usuário é deletado, apaga seus comentários
ALTER TABLE public.pedido_comentarios
  DROP CONSTRAINT IF EXISTS pedido_comentarios_user_id_fkey;
ALTER TABLE public.pedido_comentarios
  ADD CONSTRAINT pedido_comentarios_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

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
DROP POLICY IF EXISTS "stock_items_write_admin" ON public.stock_items;
CREATE POLICY "stock_items_write_admin" ON public.stock_items FOR ALL    TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS "stock_movements_select"      ON public.stock_movements;
DROP POLICY IF EXISTS "stock_movements_insert"      ON public.stock_movements;
DROP POLICY IF EXISTS "stock_movements_write_admin" ON public.stock_movements;
CREATE POLICY "stock_movements_select"      ON public.stock_movements FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "stock_movements_insert"      ON public.stock_movements FOR INSERT TO authenticated WITH CHECK (public.is_approved_user() AND (user_id IS NULL OR user_id = auth.uid()));
DROP POLICY IF EXISTS "stock_movements_write_admin" ON public.stock_movements;
CREATE POLICY "stock_movements_write_admin" ON public.stock_movements FOR ALL    TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS "backup_configs_admin" ON public.backup_configs;
CREATE POLICY "backup_configs_admin" ON public.backup_configs FOR ALL TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS "stock_backups_select"      ON public.stock_backups;
DROP POLICY IF EXISTS "stock_backups_write_admin" ON public.stock_backups;
CREATE POLICY "stock_backups_select"      ON public.stock_backups FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS "stock_backups_write_admin" ON public.stock_backups;
CREATE POLICY "stock_backups_write_admin" ON public.stock_backups FOR ALL    TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS "recebimento_select" ON public.recebimento_materiais;
DROP POLICY IF EXISTS "recebimento_insert" ON public.recebimento_materiais;
DROP POLICY IF EXISTS "recebimento_update" ON public.recebimento_materiais;
DROP POLICY IF EXISTS "recebimento_delete" ON public.recebimento_materiais;
DROP POLICY IF EXISTS "recebimento_select" ON public.recebimento_materiais;
CREATE POLICY "recebimento_select" ON public.recebimento_materiais FOR SELECT USING (public.is_approved_user());
DROP POLICY IF EXISTS "recebimento_insert" ON public.recebimento_materiais;
CREATE POLICY "recebimento_insert" ON public.recebimento_materiais FOR INSERT WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS "recebimento_update" ON public.recebimento_materiais;
CREATE POLICY "recebimento_update" ON public.recebimento_materiais FOR UPDATE USING (public.is_approved_user());
DROP POLICY IF EXISTS "recebimento_delete" ON public.recebimento_materiais;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260009000000_stock_rpcs.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── increment_stock_quantity ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_stock_quantity(p_item_id uuid, p_qty integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f01$
  UPDATE public.stock_items SET quantity = quantity + p_qty, updated_at = now() WHERE id = p_item_id;
$f01$;
GRANT EXECUTE ON FUNCTION public.increment_stock_quantity TO authenticated;

-- ── reserve_stock ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserve_stock(p_item_id uuid, p_qty integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f02$
DECLARE v_updated integer;
BEGIN
  UPDATE public.stock_items
  SET quantity_reserved = quantity_reserved + p_qty
  WHERE id = p_item_id AND (quantity - quantity_reserved) >= p_qty;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'Estoque insuficiente ou item não encontrado'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$f02$;

-- ── stock_movement_atomic ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stock_movement_atomic(
  p_item_id uuid, p_type text, p_qty integer,
  p_reason text, p_lote text, p_user_id uuid, p_user_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f03$
DECLARE v_new_qty integer;
BEGIN
  IF p_type = 'saida' THEN
    UPDATE public.stock_items SET quantity = quantity - p_qty, updated_at = now()
    WHERE id = p_item_id AND quantity >= p_qty RETURNING quantity INTO v_new_qty;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Estoque insuficiente'); END IF;
  ELSE
    UPDATE public.stock_items SET quantity = quantity + p_qty, updated_at = now()
    WHERE id = p_item_id RETURNING quantity INTO v_new_qty;
  END IF;
  INSERT INTO public.stock_movements(stock_item_id, type, quantity, reason, lote, user_id, user_display_name)
  VALUES (p_item_id, p_type, p_qty, p_reason, p_lote, p_user_id, p_user_name);
  RETURN jsonb_build_object('ok', true, 'new_quantity', v_new_qty);
END;
$f03$;

-- ── cancel_movement ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_movement(p_movement_id uuid, p_stock_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f04$
DECLARE v_movement public.stock_movements%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;
  SELECT * INTO v_movement FROM public.stock_movements WHERE id = p_movement_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Movimento não encontrado'); END IF;
  IF v_movement.type = 'entrada' THEN
    UPDATE public.stock_items SET quantity = GREATEST(0, quantity - v_movement.quantity) WHERE id = p_stock_item_id;
  ELSE
    UPDATE public.stock_items SET quantity = quantity + v_movement.quantity WHERE id = p_stock_item_id;
  END IF;
  DELETE FROM public.stock_movements WHERE id = p_movement_id;
  RETURN jsonb_build_object('ok', true);
END;
$f04$;

-- ── delete_stock_item ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_stock_item(p_stock_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f05$
DECLARE v_role public.app_role;
BEGIN
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
  IF v_role IS DISTINCT FROM 'admin'::public.app_role THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Apenas administradores podem excluir peças.');
  END IF;
  DELETE FROM public.pedidos_comerciais
  WHERE id IN (SELECT DISTINCT pedido_id FROM public.pedido_itens WHERE stock_item_id = p_stock_item_id)
    AND (SELECT COUNT(*) FROM public.pedido_itens pi2 WHERE pi2.pedido_id = pedidos_comerciais.id AND pi2.stock_item_id != p_stock_item_id) = 0;
  DELETE FROM public.stock_items WHERE id = p_stock_item_id;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$f05$;
GRANT EXECUTE ON FUNCTION public.delete_stock_item(uuid) TO authenticated;

-- ── admin_clear_history ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_clear_history()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f06$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores podem apagar o histórico';
  END IF;
  -- Zera apenas reservas; quantidades e peças cadastradas são mantidas intactas
  UPDATE public.stock_items SET quantity_reserved = 0;
  DELETE FROM public.pedidos_comerciais; -- CASCADE apaga pedido_itens, comentários, rastreabilidade
  DELETE FROM public.stock_movements;
END;
$f06$;

-- ── admin_clear_stock_movements ───────────────────────────────────────────────
-- Apaga apenas movimentos; quantidades e peças permanecem intactas
CREATE OR REPLACE FUNCTION public.admin_clear_stock_movements()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_csm$
DECLARE v_count integer; v_uid uuid := auth.uid(); v_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado: apenas administradores.');
  END IF;
  SELECT COUNT(*) INTO v_count FROM public.stock_movements;
  DELETE FROM public.stock_movements WHERE true; -- WHERE true: satisfaz proteção contra DELETE/UPDATE sem filtro
  SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid;
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, details)
  VALUES (v_uid, COALESCE(v_name, 'Desconhecido'), 'admin_clear_stock_movements', 'stock_movements',
    jsonb_build_object('deleted', v_count));
  RETURN jsonb_build_object('ok', true, 'deleted', v_count);
END;
$f_csm$;
GRANT EXECUTE ON FUNCTION public.admin_clear_stock_movements() TO authenticated;

-- ── admin_clear_comercial ─────────────────────────────────────────────────────
-- Apaga pedidos comerciais e itens; restaura reservas; não toca estoque.
-- Rastreabilidade pós-venda NÃO é apagada (FK stock_item_id/pedido_id/
-- pedido_item_id é ON DELETE SET NULL, ver 20260034000000_empresarial.sql) —
-- são dados de recall ANVISA e devem sobreviver à limpeza do histórico comercial.
CREATE OR REPLACE FUNCTION public.admin_clear_comercial()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_cc$
DECLARE v_count integer; v_uid uuid := auth.uid(); v_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado: apenas administradores.');
  END IF;
  UPDATE public.stock_items SET quantity_reserved = 0 WHERE true; -- WHERE true: satisfaz proteção contra UPDATE sem filtro
  SELECT COUNT(*) INTO v_count FROM public.pedidos_comerciais;
  DELETE FROM public.pedidos_comerciais WHERE true; -- CASCADE apaga pedido_itens e comentários
  SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid;
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, details)
  VALUES (v_uid, COALESCE(v_name, 'Desconhecido'), 'admin_clear_comercial', 'pedidos_comerciais',
    jsonb_build_object('deleted', v_count));
  RETURN jsonb_build_object('ok', true, 'deleted', v_count);
END;
$f_cc$;
GRANT EXECUTE ON FUNCTION public.admin_clear_comercial() TO authenticated;

-- ── admin_clear_producao ──────────────────────────────────────────────────────
-- Apaga apontamentos de produção; máquinas e produtos permanecem
CREATE OR REPLACE FUNCTION public.admin_clear_producao()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_cp$
DECLARE v_count integer; v_uid uuid := auth.uid(); v_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado: apenas administradores.');
  END IF;
  SELECT COUNT(*) INTO v_count FROM public.apontamentos_producao;
  DELETE FROM public.apontamentos_producao WHERE true; -- CASCADE apaga paradas e refugos
  SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid;
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, details)
  VALUES (v_uid, COALESCE(v_name, 'Desconhecido'), 'admin_clear_producao', 'apontamentos_producao',
    jsonb_build_object('deleted', v_count));
  RETURN jsonb_build_object('ok', true, 'deleted', v_count);
END;
$f_cp$;
GRANT EXECUTE ON FUNCTION public.admin_clear_producao() TO authenticated;

-- ── admin_regularizar_todos_devices ──────────────────────────────────────────
-- Confirma todas as peças cadastradas como regularizadas (Fase 5) sem apagar nada
CREATE OR REPLACE FUNCTION public.admin_regularizar_todos_devices()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_rd$
DECLARE v_total integer; v_atualizados integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado: apenas administradores.');
  END IF;
  SELECT COUNT(*) INTO v_total FROM public.devices;
  -- Fase 1: empresa ok
  UPDATE public.devices SET empresa_lf = true, empresa_afe = true, empresa_bpf = true
  WHERE NOT empresa_lf OR NOT empresa_afe OR NOT empresa_bpf;
  -- Fase 2: risk_class e classification_code
  UPDATE public.devices
  SET risk_class          = COALESCE(NULLIF(trim(risk_class), ''), 'III'),
      classification_code = COALESCE(NULLIF(trim(classification_code), ''), '10')
  WHERE risk_class IS NULL OR risk_class = ''
     OR classification_code IS NULL OR classification_code = '';
  -- Fase 3: status regularização
  UPDATE public.devices
  SET status_regularizacao   = CASE WHEN risk_class IN ('I','II') THEN 'notificado' ELSE 'registrado' END,
      data_registro_anvisa   = COALESCE(data_registro_anvisa, now()::date),
      data_vencimento_anvisa = COALESCE(data_vencimento_anvisa, (now() + INTERVAL '10 years')::date)
  WHERE status_regularizacao IN ('pendente','em_processo') OR status_regularizacao IS NULL;
  -- Fase 4: gtin e rotulo
  UPDATE public.devices
  SET gtin = COALESCE(NULLIF(trim(gtin),''), udi_di), rotulo_udi_ok = true
  WHERE gtin IS NULL OR gtin = '';
  GET DIAGNOSTICS v_atualizados = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'total', v_total, 'atualizados', v_atualizados);
END;
$f_rd$;
GRANT EXECUTE ON FUNCTION public.admin_regularizar_todos_devices() TO authenticated;

-- ── sync_stock_items_from_devices ─────────────────────────────────────────────
-- DROP necessário: migration anterior definia RETURNS void; aqui muda para RETURNS jsonb
DROP FUNCTION IF EXISTS public.sync_stock_items_from_devices();
CREATE OR REPLACE FUNCTION public.sync_stock_items_from_devices()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f07$
DECLARE inserted_count integer;
BEGIN
  INSERT INTO public.stock_items (device_id, quantity, min_quantity, fase)
  SELECT d.id, 0, 0, 'intermediaria' FROM public.devices d
  WHERE NOT EXISTS (SELECT 1 FROM public.stock_items si WHERE si.device_id = d.id);
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN jsonb_build_object('inserted', inserted_count);
END;
$f07$;
GRANT EXECUTE ON FUNCTION public.sync_stock_items_from_devices() TO authenticated;

-- ── get_lotes_intermediario ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_lotes_intermediario()
RETURNS TABLE (stock_item_id uuid, lote text, saldo integer, model text, reference text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f08$
  SELECT si.id, upper(sm.lote), SUM(CASE sm.type WHEN 'entrada' THEN sm.quantity WHEN 'saida' THEN -sm.quantity ELSE 0 END)::integer,
    d.model, d.reference
  FROM public.stock_items si
  JOIN public.devices d ON d.id = si.device_id
  JOIN public.stock_movements sm ON sm.stock_item_id = si.id
  WHERE si.fase = 'intermediaria' AND sm.lote IS NOT NULL
    AND trim(lower(sm.lote)) NOT IN ('a-definir','a definir','sem lote')
    AND (sm.reason IS NULL OR sm.reason NOT IN (
      'Rollback — falha ao criar item de retrabalho',
      'Rollback — falha ao criar item de expedição',
      'Rollback — falha ao registrar entrada na expedição'))
  GROUP BY si.id, upper(sm.lote), d.model, d.reference
  HAVING SUM(CASE sm.type WHEN 'entrada' THEN sm.quantity WHEN 'saida' THEN -sm.quantity ELSE 0 END) > 0
  ORDER BY d.model, upper(sm.lote);
$f08$;
GRANT EXECUTE ON FUNCTION public.get_lotes_intermediario() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260015000000_improvements.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Índice composto em stock_movements (stock_item_id, lote, type) ─────────
-- Acelera fetchLotesSummaryBatch e fetchLotesDisponivelBatch que filtram
-- por stock_item_id + lote + type em batch. Evita bitmap scan.
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_lote_type
  ON public.stock_movements (stock_item_id, lote, type)
  WHERE lote IS NOT NULL;

-- Índice cobrindo quantity para index-only scan em cálculos de saldo
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_lote_covering
  ON public.stock_movements (stock_item_id, lote, type, quantity)
  WHERE lote IS NOT NULL;

-- ── 2. Índice composto em pedido_itens (pedido_id, stock_item_id) ─────────────
-- Cobre as subqueries do RPC marcar_pedido_pronto e recálculo de reservas
CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido_stock
  ON public.pedido_itens (pedido_id, stock_item_id);

-- ── 3. CHECK constraint: quantity_reserved não pode ser negativo ──────────────
DO $f01$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stock_items_quantity_reserved_non_negative'
      AND conrelid = 'public.stock_items'::regclass
  ) THEN
    ALTER TABLE public.stock_items
      ADD CONSTRAINT stock_items_quantity_reserved_non_negative
      CHECK (quantity_reserved >= 0);
  END IF;
END $f01$;

-- ── 4. Tabela de auditoria de ações críticas ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name   text,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  details     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_audit_log_user       ON public.audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity     ON public.audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created    ON public.audit_log (created_at DESC);

-- Admins vêem tudo; usuários vêem suas próprias ações
DROP POLICY IF EXISTS "audit_log_admin_select" ON public.audit_log;
CREATE POLICY "audit_log_admin_select" ON public.audit_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "audit_log_self_select" ON public.audit_log;
CREATE POLICY "audit_log_self_select" ON public.audit_log
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "audit_log_insert" ON public.audit_log;
CREATE POLICY "audit_log_insert" ON public.audit_log
  FOR INSERT WITH CHECK (true);

-- ── admin_clear_audit_log ─────────────────────────────────────────────────────
-- Apaga o log de auditoria (aba "Auditoria" em Admin.tsx). Não afeta nenhum
-- outro dado do sistema — mesmo padrão das demais funções admin_clear_*.
-- O INSERT do próprio registro de auditoria roda DEPOIS do DELETE — assim o
-- "apaguei o log" fica registrado como único item restante na tabela.
CREATE OR REPLACE FUNCTION public.admin_clear_audit_log()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_cal$
DECLARE v_count integer; v_uid uuid := auth.uid(); v_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado: apenas administradores.');
  END IF;
  SELECT COUNT(*) INTO v_count FROM public.audit_log;
  DELETE FROM public.audit_log WHERE true;
  SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid;
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, details)
  VALUES (v_uid, COALESCE(v_name, 'Desconhecido'), 'admin_clear_audit_log', 'audit_log',
    jsonb_build_object('deleted', v_count));
  RETURN jsonb_build_object('ok', true, 'deleted', v_count);
END;
$f_cal$;
GRANT EXECUTE ON FUNCTION public.admin_clear_audit_log() TO authenticated;

-- ── 5. Guard no faturar_pedido_sefaz: idempotência ────────────────────────────
CREATE OR REPLACE FUNCTION public.faturar_pedido_sefaz(
  p_pedido_id uuid, p_nf text, p_chave_acesso text, p_protocolo text,
  p_dh_autorizacao timestamptz, p_user_id uuid, p_user_name text,
  p_xml_nfe text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f02$
DECLARE v_status text; v_nf_existente text;
BEGIN
  SELECT status, nota_fiscal INTO v_status, v_nf_existente
  FROM public.pedidos_comerciais WHERE id = p_pedido_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado');
  END IF;

  -- Idempotência: se já faturado com a mesma NF, retorna sucesso sem re-processar
  IF v_nf_existente = p_nf THEN
    RETURN jsonb_build_object('ok', true, 'already_faturado', true);
  END IF;

  -- Apenas pedidos no status 'pronto' podem ser faturados
  IF v_status NOT IN ('pronto') THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'Pedido deve estar no status "pronto" para ser faturado. Status atual: ' || v_status);
  END IF;

  UPDATE public.pedidos_comerciais SET
    status='enviado', nota_fiscal=p_nf, chave_acesso_nfe=p_chave_acesso,
    protocolo_sefaz=p_protocolo, dh_autorizacao_nfe=p_dh_autorizacao,
    nf_criada_por=p_user_id, nf_criada_em=now(), enviado_em=now(), xml_nfe=p_xml_nfe
  WHERE id = p_pedido_id;

  -- Registra na auditoria
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (p_user_id, p_user_name, 'faturar_nf', 'pedido_comercial', p_pedido_id,
    jsonb_build_object('nota_fiscal', p_nf, 'protocolo', p_protocolo));

  RETURN jsonb_build_object('ok', true);
END; $f02$;

GRANT EXECUTE ON FUNCTION public.faturar_pedido_sefaz(uuid,text,text,text,timestamptz,uuid,text,text) TO authenticated;

-- ── 6. Campo rastreio_envio em pedidos_comerciais ─────────────────────────────
ALTER TABLE public.pedidos_comerciais
  ADD COLUMN IF NOT EXISTS rastreio_envio text,
  ADD COLUMN IF NOT EXISTS transportadora text;

CREATE INDEX IF NOT EXISTS idx_pedidos_rastreio
  ON public.pedidos_comerciais (rastreio_envio) WHERE rastreio_envio IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 20260019000000_performance_stock_load.sql
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Substitui 4–13 requests HTTP por 1 chamada ao banco (RPC load_stock_page).
-- Também corrige ausência de índice em updated_at (seq scan no ORDER BY).
--
-- Problemas corrigidos vs versão anterior:
--   • Bloco SQL morto removido (dupla atribuição de v_lote_map)
--   • search_devices_for_stock: adicionado guard auth.uid()
--   • load_stock_page: p_limit clampado a 500 (DoS prevention)

-- ── Índice faltante: updated_at DESC em stock_items ───────────────────────────
-- O ORDER BY updated_at DESC fazia seq scan de toda a tabela.
CREATE INDEX IF NOT EXISTS idx_stock_items_updated_at
  ON public.stock_items (updated_at DESC);

-- Índice covering (fase + updated_at)
CREATE INDEX IF NOT EXISTS idx_stock_items_fase_updated
  ON public.stock_items (fase, updated_at DESC);

-- Índice trgm em anvisa_registration (faltava)
CREATE INDEX IF NOT EXISTS devices_anvisa_trgm_idx
  ON public.devices USING GIN (anvisa_registration gin_trgm_ops)
  WHERE anvisa_registration IS NOT NULL;

-- ── RPC auxiliar: search_devices_for_stock ────────────────────────────────────
-- Resolve busca textual no servidor usando índices GIN trgm.
-- Chamado pelo cliente ANTES de load_stock_page quando há termo de busca.
-- Fix: guard auth.uid() adicionado (estava ausente na versão anterior).
CREATE OR REPLACE FUNCTION public.search_devices_for_stock(p_search text)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $f01$
BEGIN
  -- SEG: rejeita chamadas não autenticadas (padrão do projeto)
  IF auth.uid() IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  RETURN ARRAY(
    SELECT id FROM public.devices
    WHERE
      model               ILIKE '%' || p_search || '%' OR
      reference           ILIKE '%' || p_search || '%' OR
      udi_di              ILIKE '%' || p_search || '%' OR
      internal_code       ILIKE '%' || p_search || '%' OR
      anvisa_registration ILIKE '%' || p_search || '%' OR
      brand_name          ILIKE '%' || p_search || '%'
    LIMIT 500
  );
END;
$f01$;

GRANT EXECUTE ON FUNCTION public.search_devices_for_stock(text) TO authenticated;

-- ── RPC principal: load_stock_page ────────────────────────────────────────────
-- Retorna em UMA chamada:
--   • items paginados com device join
--   • reserved_map: quantity_reserved recalculada dos pedidos ativos
--   • lote_map: contagem de lotes com saldo > 0 por item
--   • total_count para o cliente
--
-- Fixes vs versão anterior:
--   • p_limit clampado a LEAST(p_limit, 500) — previne DoS
--   • bloco SQL morto (dupla atribuição de v_lote_map) removido
--   • lote_map calculado com CTE limpa e única
CREATE OR REPLACE FUNCTION public.load_stock_page(
  p_search      text    DEFAULT NULL,
  p_limit       integer DEFAULT 200,
  p_offset      integer DEFAULT 0,
  p_device_ids  uuid[]  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $f02$
DECLARE
  v_total        bigint;
  v_items        jsonb;
  v_reserved_map jsonb;
  v_lote_map     jsonb;
  v_qty_by_fase  jsonb;
  v_limit        integer;
BEGIN
  -- SEG: rejeita chamadas não autenticadas
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  -- DoS prevention: limita o máximo de linhas retornadas independente do que o cliente pede
  v_limit := LEAST(COALESCE(p_limit, 200), 500);

  -- ── 1. Conta total ────────────────────────────────────────────────────────
  IF p_device_ids IS NOT NULL THEN
    SELECT COUNT(*) INTO v_total
    FROM public.stock_items
    WHERE device_id = ANY(p_device_ids);
  ELSE
    SELECT COUNT(*) INTO v_total FROM public.stock_items;
  END IF;

  -- ── 2. Items paginados com JOIN de devices ────────────────────────────────
  IF p_device_ids IS NOT NULL THEN
    SELECT jsonb_agg(row_to_json(t))
    INTO v_items
    FROM (
      SELECT
        si.id, si.device_id, si.quantity, si.quantity_reserved,
        si.min_quantity, si.location, si.notes, si.fase,
        si.created_at, si.updated_at,
        jsonb_build_object(
          'id',                   d.id,
          'udi_di',               d.udi_di,
          'reference',            d.reference,
          'model',                d.model,
          'brand_name',           d.brand_name,
          'internal_code',        d.internal_code,
          'anvisa_registration',  d.anvisa_registration,
          'manufacturer_country', d.manufacturer_country,
          'classification_code',  d.classification_code,
          'risk_class',           d.risk_class,
          'icon_url',             d.icon_url,
          'sterile',              d.sterile,
          'single_use',           d.single_use,
          'implantable',          d.implantable
        ) AS device
      FROM public.stock_items si
      JOIN public.devices d ON d.id = si.device_id
      WHERE si.device_id = ANY(p_device_ids)
      ORDER BY si.updated_at DESC
      LIMIT  v_limit
      OFFSET COALESCE(p_offset, 0)
    ) t;
  ELSE
    SELECT jsonb_agg(row_to_json(t))
    INTO v_items
    FROM (
      SELECT
        si.id, si.device_id, si.quantity, si.quantity_reserved,
        si.min_quantity, si.location, si.notes, si.fase,
        si.created_at, si.updated_at,
        jsonb_build_object(
          'id',                   d.id,
          'udi_di',               d.udi_di,
          'reference',            d.reference,
          'model',                d.model,
          'brand_name',           d.brand_name,
          'internal_code',        d.internal_code,
          'anvisa_registration',  d.anvisa_registration,
          'manufacturer_country', d.manufacturer_country,
          'classification_code',  d.classification_code,
          'risk_class',           d.risk_class,
          'icon_url',             d.icon_url,
          'sterile',              d.sterile,
          'single_use',           d.single_use,
          'implantable',          d.implantable
        ) AS device
      FROM public.stock_items si
      JOIN public.devices d ON d.id = si.device_id
      ORDER BY si.updated_at DESC
      LIMIT  v_limit
      OFFSET COALESCE(p_offset, 0)
    ) t;
  END IF;

  -- ── 3. reserved_map: quantity_reserved real via pedidos ativos ───────────
  -- Apenas para items de expedição na página atual.
  -- Substitui os 2 requests extras (pedidos_comerciais + pedido_itens) do cliente.
  SELECT jsonb_object_agg(agg.stock_item_id::text, agg.total_reservado)
  INTO v_reserved_map
  FROM (
    SELECT pi.stock_item_id, SUM(pi.quantidade) AS total_reservado
    FROM public.pedido_itens pi
    JOIN public.pedidos_comerciais pc ON pc.id = pi.pedido_id
    WHERE pc.status IN ('pendente', 'separando')
      AND pi.stock_item_id IN (
        SELECT (elem->>'id')::uuid
        FROM jsonb_array_elements(COALESCE(v_items, '[]'::jsonb)) elem
        WHERE elem->>'fase' = 'expedicao'
      )
    GROUP BY pi.stock_item_id
  ) agg;

  -- ── 4. lote_map: contagem de lotes com saldo > 0 por item ────────────────
  -- CTE única e correta (sem código morto).
  -- Substitui o fetchLotesSummaryBatch que o cliente fazia pós-render.
  WITH lotes_com_saldo AS (
    SELECT
      sm.stock_item_id                                                          AS item_id,
      upper(trim(sm.lote))                                                      AS lote_key,
      SUM(CASE WHEN sm.type = 'entrada' THEN sm.quantity ELSE -sm.quantity END) AS saldo
    FROM public.stock_movements sm
    WHERE sm.stock_item_id IN (
        SELECT (elem->>'id')::uuid
        FROM jsonb_array_elements(COALESCE(v_items, '[]'::jsonb)) elem
      )
      AND sm.lote IS NOT NULL
      AND lower(trim(sm.lote)) NOT IN ('a-definir', 'a definir', 'sem lote')
      AND (sm.reason IS NULL OR sm.reason NOT IN (
        'Recebido de Intermediário',
        'Retrabalho concluído — recebido do Retrabalho',
        'Rollback — falha ao criar item de retrabalho',
        'Rollback — falha ao criar item de expedição',
        'Rollback — falha ao registrar entrada na expedição'
      ))
    GROUP BY sm.stock_item_id, upper(trim(sm.lote))
    HAVING SUM(CASE WHEN sm.type = 'entrada' THEN sm.quantity ELSE -sm.quantity END) > 0
  ),
  lote_counts AS (
    SELECT item_id, COUNT(*) AS lote_count
    FROM lotes_com_saldo
    GROUP BY item_id
  )
  SELECT jsonb_object_agg(item_id::text, lote_count)
  INTO v_lote_map
  FROM lote_counts;

  -- ── 5. Totais de quantidade por fase (para o header do Estoque) ─────────
  SELECT jsonb_build_object(
    'intermediaria', COALESCE(SUM(quantity) FILTER (WHERE fase = 'intermediaria'), 0)::bigint,
    'expedicao',     COALESCE(SUM(quantity) FILTER (WHERE fase = 'expedicao'), 0)::bigint,
    'retrabalho',    COALESCE(SUM(quantity) FILTER (WHERE fase = 'retrabalho'), 0)::bigint
  ) INTO v_qty_by_fase
  FROM public.stock_items;

  -- ── 6. Retorna payload unificado ──────────────────────────────────────────
  RETURN jsonb_build_object(
    'total_count',  v_total,
    'items',        COALESCE(v_items,        '[]'::jsonb),
    'reserved_map', COALESCE(v_reserved_map, '{}'::jsonb),
    'lote_map',     COALESCE(v_lote_map,     '{}'::jsonb),
    'qty_by_fase',  COALESCE(v_qty_by_fase,  '{}'::jsonb)
  );
END;
$f02$;

GRANT EXECUTE ON FUNCTION public.load_stock_page(text, integer, integer, uuid[]) TO authenticated;

-- ── ANALYZE ───────────────────────────────────────────────────────────────────
ANALYZE public.stock_items;
ANALYZE public.stock_movements;
ANALYZE public.devices;
ANALYZE public.pedido_itens;
ANALYZE public.pedidos_comerciais;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260021000000_performance_functions.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- PERF-04: Funções aggregate para evitar paginação de milhares de rows no cliente

-- Retorna soma total de peças no estoque (quantity > 0)
CREATE OR REPLACE FUNCTION get_total_stock_quantity()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $f01$
  SELECT COALESCE(SUM(quantity)::integer, 0)
  FROM stock_items
  WHERE quantity > 0;
$f01$;

-- Retorna total de devices em regularização por fase
CREATE OR REPLACE FUNCTION get_devices_regularizacao_counts()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $f02$
  SELECT json_build_object(
    'total',       COUNT(*),
    'fase_1',      COUNT(*) FILTER (WHERE fase_atual = 1),
    'fase_2',      COUNT(*) FILTER (WHERE fase_atual = 2),
    'fase_3',      COUNT(*) FILTER (WHERE fase_atual = 3),
    'fase_4',      COUNT(*) FILTER (WHERE fase_atual = 4),
    'fase_5',      COUNT(*) FILTER (WHERE fase_atual = 5),
    'pendentes',   COUNT(*) FILTER (WHERE fase_atual < 5),
    'em_processo', COUNT(*) FILTER (WHERE fase_atual = 3 AND status_regularizacao = 'em_processo'),
    'vencendo',    COUNT(*) FILTER (WHERE dias_ate_vencer IS NOT NULL AND dias_ate_vencer < 365)
  )
  FROM devices_regularizacao;
$f02$;

GRANT EXECUTE ON FUNCTION get_total_stock_quantity() TO authenticated;
GRANT EXECUTE ON FUNCTION get_devices_regularizacao_counts() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260027000000_load_stock_page_qty_by_fase.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Retorna soma de quantity por fase para o header do Estoque mostrar o total
-- real mesmo quando há paginação (cliente só recebe até 500 itens por página)

CREATE OR REPLACE FUNCTION public.load_stock_page(
  p_search      text    DEFAULT NULL,
  p_limit       integer DEFAULT 200,
  p_offset      integer DEFAULT 0,
  p_device_ids  uuid[]  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $f01$
DECLARE
  v_total        bigint;
  v_items        jsonb;
  v_reserved_map jsonb;
  v_lote_map     jsonb;
  v_qty_by_fase  jsonb;
  v_limit        integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_limit := LEAST(COALESCE(p_limit, 200), 500);

  -- 1. Total de itens
  IF p_device_ids IS NOT NULL THEN
    SELECT COUNT(*) INTO v_total FROM public.stock_items WHERE device_id = ANY(p_device_ids);
  ELSE
    SELECT COUNT(*) INTO v_total FROM public.stock_items;
  END IF;

  -- 2. Items paginados
  IF p_device_ids IS NOT NULL THEN
    SELECT jsonb_agg(row_to_json(t)) INTO v_items FROM (
      SELECT si.id, si.device_id, si.quantity, si.quantity_reserved,
        si.min_quantity, si.location, si.notes, si.fase, si.created_at, si.updated_at,
        jsonb_build_object('id',d.id,'udi_di',d.udi_di,'reference',d.reference,'model',d.model,
          'brand_name',d.brand_name,'internal_code',d.internal_code,
          'anvisa_registration',d.anvisa_registration,'manufacturer_country',d.manufacturer_country,
          'classification_code',d.classification_code,'risk_class',d.risk_class,
          'icon_url',d.icon_url,'sterile',d.sterile,'single_use',d.single_use,'implantable',d.implantable
        ) AS device
      FROM public.stock_items si JOIN public.devices d ON d.id = si.device_id
      WHERE si.device_id = ANY(p_device_ids)
      ORDER BY si.updated_at DESC LIMIT v_limit OFFSET COALESCE(p_offset,0)
    ) t;
  ELSE
    SELECT jsonb_agg(row_to_json(t)) INTO v_items FROM (
      SELECT si.id, si.device_id, si.quantity, si.quantity_reserved,
        si.min_quantity, si.location, si.notes, si.fase, si.created_at, si.updated_at,
        jsonb_build_object('id',d.id,'udi_di',d.udi_di,'reference',d.reference,'model',d.model,
          'brand_name',d.brand_name,'internal_code',d.internal_code,
          'anvisa_registration',d.anvisa_registration,'manufacturer_country',d.manufacturer_country,
          'classification_code',d.classification_code,'risk_class',d.risk_class,
          'icon_url',d.icon_url,'sterile',d.sterile,'single_use',d.single_use,'implantable',d.implantable
        ) AS device
      FROM public.stock_items si JOIN public.devices d ON d.id = si.device_id
      ORDER BY si.updated_at DESC LIMIT v_limit OFFSET COALESCE(p_offset,0)
    ) t;
  END IF;

  -- 3. reserved_map
  SELECT jsonb_object_agg(agg.stock_item_id::text, agg.total_reservado) INTO v_reserved_map
  FROM (
    SELECT pi.stock_item_id, SUM(pi.quantidade) AS total_reservado
    FROM public.pedido_itens pi JOIN public.pedidos_comerciais pc ON pc.id = pi.pedido_id
    WHERE pc.status IN ('pendente','separando')
      AND pi.stock_item_id IN (
        SELECT (elem->>'id')::uuid FROM jsonb_array_elements(COALESCE(v_items,'[]'::jsonb)) elem
        WHERE elem->>'fase' = 'expedicao'
      )
    GROUP BY pi.stock_item_id
  ) agg;

  -- 4. lote_map
  WITH lotes_com_saldo AS (
    SELECT sm.stock_item_id AS item_id, upper(trim(sm.lote)) AS lote_key,
      SUM(CASE WHEN sm.type='entrada' THEN sm.quantity ELSE -sm.quantity END) AS saldo
    FROM public.stock_movements sm
    WHERE sm.stock_item_id IN (
        SELECT (elem->>'id')::uuid FROM jsonb_array_elements(COALESCE(v_items,'[]'::jsonb)) elem
      )
      AND sm.lote IS NOT NULL
      AND lower(trim(sm.lote)) NOT IN ('a-definir','a definir','sem lote')
      AND (sm.reason IS NULL OR sm.reason NOT IN (
        'Recebido de Intermediário','Retrabalho concluído — recebido do Retrabalho',
        'Rollback — falha ao criar item de retrabalho','Rollback — falha ao criar item de expedição',
        'Rollback — falha ao registrar entrada na expedição'))
    GROUP BY sm.stock_item_id, upper(trim(sm.lote))
    HAVING SUM(CASE WHEN sm.type='entrada' THEN sm.quantity ELSE -sm.quantity END) > 0
  ),
  lote_counts AS (SELECT item_id, COUNT(*) AS lote_count FROM lotes_com_saldo GROUP BY item_id)
  SELECT jsonb_object_agg(item_id::text, lote_count) INTO v_lote_map FROM lote_counts;

  -- 5. Totais por fase (quantidade e contagem de tipos, independente da paginação)
  SELECT jsonb_build_object(
    'intermediaria',       COALESCE(SUM(quantity) FILTER (WHERE fase = 'intermediaria'), 0)::bigint,
    'expedicao',           COALESCE(SUM(quantity) FILTER (WHERE fase = 'expedicao'), 0)::bigint,
    'retrabalho',          COALESCE(SUM(quantity) FILTER (WHERE fase = 'retrabalho'), 0)::bigint,
    'count_intermediaria', COALESCE(COUNT(*) FILTER (WHERE fase = 'intermediaria' AND quantity > 0), 0)::bigint,
    'count_expedicao',     COALESCE(COUNT(*) FILTER (WHERE fase = 'expedicao'     AND quantity > 0), 0)::bigint,
    'count_retrabalho',    COALESCE(COUNT(*) FILTER (WHERE fase = 'retrabalho'    AND quantity > 0), 0)::bigint
  ) INTO v_qty_by_fase FROM public.stock_items;

  RETURN jsonb_build_object(
    'total_count',  v_total,
    'items',        COALESCE(v_items,        '[]'::jsonb),
    'reserved_map', COALESCE(v_reserved_map, '{}'::jsonb),
    'lote_map',     COALESCE(v_lote_map,     '{}'::jsonb),
    'qty_by_fase',  COALESCE(v_qty_by_fase,  '{}'::jsonb)
  );
END;
$f01$;

GRANT EXECUTE ON FUNCTION public.load_stock_page(text, integer, integer, uuid[]) TO authenticated;
