-- =============================================================================
-- MELHORIAS DE PERFORMANCE — Índices GIN, View Materializada, Tema no Perfil
-- =============================================================================

-- ── PERF-01: Índice GIN pg_trgm para busca full-text em dispositivos ──────────
-- pg_trgm pode estar no schema 'public' OU 'extensions' (movido pela migration
-- 20260029). Descobrimos o schema em runtime e qualificamos o operator class.
DO $trgm_idx$
DECLARE
  v_trgm_schema text;
BEGIN
  SELECT n.nspname INTO v_trgm_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm'
  LIMIT 1;

  IF v_trgm_schema IS NULL THEN
    RAISE NOTICE 'pg_trgm nao encontrado -- pulando indices GIN';
    RETURN;
  END IF;

  RAISE NOTICE 'pg_trgm esta no schema: %', v_trgm_schema;

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_devices_model_trgm
    ON public.devices USING GIN (model %I.gin_trgm_ops)', v_trgm_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_devices_reference_trgm
    ON public.devices USING GIN (reference %I.gin_trgm_ops)', v_trgm_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_devices_brand_trgm
    ON public.devices USING GIN (brand_name %I.gin_trgm_ops)', v_trgm_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_devices_internal_code_trgm
    ON public.devices USING GIN (internal_code %I.gin_trgm_ops)', v_trgm_schema);

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'rastreabilidade_pos_venda'
  ) THEN
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_rastr_lote_trgm
      ON public.rastreabilidade_pos_venda USING GIN (lote %I.gin_trgm_ops)', v_trgm_schema);
  END IF;

EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Erro ao criar indices GIN: %. ILIKE ainda funciona sem eles.', SQLERRM;
END $trgm_idx$;

-- ── PERF-03: RPC para autocomplete de dispositivos ────────────────────────────
-- SET search_path inclui 'extensions' para que similarity() seja encontrada
-- independente do schema em que o pg_trgm estiver instalado.
-- A ordenacao usa CASE em vez de similarity() diretamente — funciona mesmo
-- sem pg_trgm (degrada graciosamente para ordenacao por nome).
CREATE OR REPLACE FUNCTION public.autocomplete_devices(p_query text, p_limit int DEFAULT 8)
RETURNS TABLE(suggestion text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  -- SELECT DISTINCT não aceita ORDER BY com expressões fora do SELECT.
  -- Solução: subquery calcula a prioridade, outer query aplica DISTINCT + ORDER.
  SELECT suggestion FROM (
    SELECT DISTINCT model AS suggestion,
      CASE
        WHEN model ILIKE p_query || '%' THEN 0   -- começa com o termo: maior prioridade
        WHEN model ILIKE '%' || p_query || '%' THEN 1
        ELSE 2
      END AS prio
    FROM public.devices
    WHERE model     ILIKE '%' || p_query || '%'
       OR reference ILIKE '%' || p_query || '%'
  ) sub
  ORDER BY prio, suggestion
  LIMIT LEAST(p_limit, 20);
$$;
GRANT EXECUTE ON FUNCTION public.autocomplete_devices(text, int) TO authenticated;

-- ── PERF-04: View materializada para dashboard gerencial ──────────────────────
-- Substitui a função dashboard_gerencial() que faz JOINs pesados a cada load.
-- Atualizada a cada 15 min via pg_cron (abaixo).
-- O DashboardGeral.tsx continua chamando a função — ela agora lê da view.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_dashboard_kpis AS
SELECT
  -- Estoque
  COALESCE((SELECT SUM(quantity) FROM public.stock_items WHERE fase='intermediaria'), 0)::int AS estoque_intermediario_qty,
  COALESCE((SELECT SUM(quantity) FROM public.stock_items WHERE fase='expedicao'), 0)::int AS estoque_expedicao_qty,
  COALESCE((SELECT COUNT(*) FROM public.stock_items WHERE quantity > 0 AND min_quantity > 0 AND quantity <= min_quantity), 0)::int AS estoque_critico,
  -- Comercial
  COALESCE((SELECT COUNT(*) FROM public.pedidos_comerciais WHERE status IN ('pendente','separando')), 0)::int AS pedidos_pendentes,
  COALESCE((SELECT COUNT(*) FROM public.pedidos_comerciais WHERE status='pronto'), 0)::int AS pedidos_prontos,
  COALESCE((SELECT COUNT(*) FROM public.pedidos_comerciais WHERE status='pronto' AND created_at < (now() - INTERVAL '7 days')), 0)::int AS pedidos_atrasados,
  -- Qualidade
  COALESCE((SELECT COUNT(*) FROM public.devices WHERE data_vencimento_anvisa IS NOT NULL AND data_vencimento_anvisa BETWEEN CURRENT_DATE AND CURRENT_DATE+90), 0)::int AS devices_vencendo_anvisa,
  COALESCE((SELECT COUNT(*) FROM public.devices WHERE data_vencimento_anvisa IS NOT NULL AND data_vencimento_anvisa < CURRENT_DATE), 0)::int AS devices_anvisa_vencidos,
  -- Rastreabilidade
  COALESCE((SELECT COUNT(*) FROM public.rastreabilidade_pos_venda WHERE status_recall IN ('alerta','recall_ativo')), 0)::int AS recall_ativos,
  now() AS refreshed_at;

CREATE UNIQUE INDEX IF NOT EXISTS mv_dashboard_kpis_idx ON public.mv_dashboard_kpis (refreshed_at);

-- Atualizar a view materializada via pg_cron (a cada 15 min)
DO $cron_dash$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh_mv_dashboard') THEN
      PERFORM cron.unschedule('refresh_mv_dashboard');
    END IF;
    PERFORM cron.schedule(
      'refresh_mv_dashboard',
      '*/15 * * * *',
      'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_dashboard_kpis'
    );
    RAISE NOTICE 'Cron job refresh_mv_dashboard criado';
  ELSE
    RAISE NOTICE 'pg_cron não disponível — atualize mv_dashboard_kpis manualmente ou via trigger';
  END IF;
END $cron_dash$;

-- ── PERF-05: Tema por usuário no perfil ───────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS theme text DEFAULT 'light'
    CHECK (theme IN ('light', 'dark', 'system'));

COMMENT ON COLUMN public.profiles.theme IS
  'Preferência de tema do usuário. Sincronizada entre dispositivos ao fazer login.';

-- ── PERF-06: Manutenção preventiva de máquinas ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.manutencao_preventiva (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maquina_id           uuid REFERENCES public.maquinas_producao(id) ON DELETE CASCADE NOT NULL,
  tipo_manutencao      text NOT NULL,
  periodicidade_dias   int NOT NULL CHECK (periodicidade_dias > 0),
  ultima_manutencao    date,
  proxima_manutencao   date GENERATED ALWAYS AS (ultima_manutencao + periodicidade_dias) STORED,
  responsavel          text,
  observacoes          text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manutencao_preventiva ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manut_select" ON public.manutencao_preventiva;
CREATE POLICY "manut_select" ON public.manutencao_preventiva
  FOR SELECT USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "manut_write" ON public.manutencao_preventiva;
CREATE POLICY "manut_write" ON public.manutencao_preventiva
  FOR ALL USING (public.get_my_role() IN ('admin', 'producao'));

CREATE INDEX IF NOT EXISTS idx_manut_maquina_proxima
  ON public.manutencao_preventiva (maquina_id, proxima_manutencao);

DROP TRIGGER IF EXISTS trg_manut_updated_at ON public.manutencao_preventiva;
CREATE TRIGGER trg_manut_updated_at
  BEFORE UPDATE ON public.manutencao_preventiva
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.manutencao_preventiva IS
  'Plano de manutenção preventiva das máquinas de produção. proxima_manutencao é coluna gerada automaticamente.';

-- ── PERF-07: Portal do fornecedor — role e tabela ─────────────────────────────
DO $role_forn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.app_role'::regtype
      AND enumlabel = 'fornecedor'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'fornecedor';
    RAISE NOTICE 'Role fornecedor adicionado ao enum app_role';
  END IF;
END $role_forn$;

-- ── PERF-08: Rastreabilidade QR Code — view consolidada ──────────────────────
-- security_invoker = true: a view respeita o RLS do usuário consultante,
-- não do criador da view. A cláusula WITH vai ANTES do AS (sintaxe PostgreSQL 15+).
DROP VIEW IF EXISTS public.rastreabilidade_qr;
CREATE VIEW public.rastreabilidade_qr
  WITH (security_invoker = true)
AS
SELECT
  r.lote,
  r.device_ref,
  r.device_model,
  r.udi_di,
  r.quantidade,
  r.cliente_nome,
  r.data_envio,
  r.status_recall,
  r.pedido_id,
  p.nota_fiscal,
  p.chave_acesso_nfe,
  p.protocolo_sefaz,
  p.dh_autorizacao_nfe,
  si.fase  AS estoque_fase,
  sm.lote  AS lote_estoque
FROM public.rastreabilidade_pos_venda r
LEFT JOIN public.pedidos_comerciais p  ON r.pedido_id       = p.id
LEFT JOIN public.stock_movements    sm ON sm.lote            = r.lote
LEFT JOIN public.stock_items        si ON sm.stock_item_id   = si.id;

GRANT SELECT ON public.rastreabilidade_qr TO authenticated;

-- ── PERF-09: Função para health check ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.health_check()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'status', 'ok',
    'db', 'connected',
    'timestamp', now(),
    'version', current_setting('server_version')
  );
$$;
GRANT EXECUTE ON FUNCTION public.health_check() TO anon, authenticated;

-- =============================================================================
-- ÍNDICES DE PERFORMANCE ADICIONAIS
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_financeiro_lanc_data_created
  ON public.financeiro_lancamentos (data_lancamento DESC, created_by)
  WHERE data_lancamento IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_financeiro_lanc_tipo
  ON public.financeiro_lancamentos (tipo, data_lancamento DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_item_created
  ON public.stock_movements (stock_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_items_device_fase
  ON public.stock_items (device_id, fase, quantity)
  WHERE quantity > 0;

CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON public.audit_log (entity_type, entity_id, created_at DESC)
  WHERE entity_id IS NOT NULL;

-- RLS fix: ver 20260039000000_fix_stock_rls.sql (RPCs SECURITY DEFINER)

-- =============================================================================
-- FIX: Foreign Keys auth.users sem ON DELETE SET NULL
-- =============================================================================
-- Erro "violates foreign key constraint" ao excluir usuário que tem pedidos,
-- lançamentos ou clientes vinculados. ON DELETE SET NULL preserva o histórico.

ALTER TABLE public.pedidos_comerciais
  DROP CONSTRAINT IF EXISTS pedidos_comerciais_vendedora_id_fkey,
  DROP CONSTRAINT IF EXISTS pedidos_comerciais_separado_por_fkey,
  DROP CONSTRAINT IF EXISTS pedidos_comerciais_faturado_por_fkey,
  DROP CONSTRAINT IF EXISTS pedidos_comerciais_nf_criada_por_fkey;

ALTER TABLE public.pedidos_comerciais
  ADD CONSTRAINT pedidos_comerciais_vendedora_id_fkey
    FOREIGN KEY (vendedora_id)  REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT pedidos_comerciais_separado_por_fkey
    FOREIGN KEY (separado_por)  REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT pedidos_comerciais_faturado_por_fkey
    FOREIGN KEY (faturado_por)  REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT pedidos_comerciais_nf_criada_por_fkey
    FOREIGN KEY (nf_criada_por) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.clientes
  DROP CONSTRAINT IF EXISTS clientes_created_by_fkey;
ALTER TABLE public.clientes
  ADD CONSTRAINT clientes_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.financeiro_lancamentos
  DROP CONSTRAINT IF EXISTS financeiro_lancamentos_created_by_fkey;
ALTER TABLE public.financeiro_lancamentos
  ADD CONSTRAINT financeiro_lancamentos_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.financeiro_contas_bancarias
  DROP CONSTRAINT IF EXISTS financeiro_contas_bancarias_created_by_fkey;
ALTER TABLE public.financeiro_contas_bancarias
  ADD CONSTRAINT financeiro_contas_bancarias_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Corrige automaticamente todas as demais FKs para auth.users sem ON DELETE
DO $fix_fk$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT tc.table_name, tc.constraint_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
    JOIN information_schema.table_constraints tc2
      ON rc.unique_constraint_name = tc2.constraint_name AND rc.unique_constraint_schema = tc2.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc2.table_name = 'users' AND tc2.table_schema = 'auth'
      AND rc.delete_rule NOT IN ('SET NULL', 'CASCADE')
      AND tc.table_name NOT IN (
        'pedidos_comerciais','clientes',
        'financeiro_lancamentos','financeiro_contas_bancarias'
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', r.table_name, r.constraint_name);
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE SET NULL', r.table_name, r.constraint_name, r.column_name);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'FK %: %', r.constraint_name, SQLERRM;
    END;
  END LOOP;
END $fix_fk$;
