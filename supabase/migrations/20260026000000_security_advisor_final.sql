-- =============================================================================
-- 026: Correções finais do Supabase Security Advisor
-- =============================================================================
-- 1. auth.uid() → (select auth.uid()) nas policies restantes
-- 2. SET search_path nas funções com search_path mutável
-- 3. Extension pg_trgm → mover para schema extensions (via config.toml)
-- =============================================================================

-- ── 1A. financeiro_lancamentos ────────────────────────────────────────────────
DROP POLICY IF EXISTS "financeiro_lanc_insert" ON public.financeiro_lancamentos;
CREATE POLICY "financeiro_lanc_insert" ON public.financeiro_lancamentos
  FOR INSERT TO authenticated WITH CHECK (
    (select auth.uid()) = created_by OR
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role IN ('admin','financeiro'))
  );

DROP POLICY IF EXISTS "financeiro_lanc_update" ON public.financeiro_lancamentos;
CREATE POLICY "financeiro_lanc_update" ON public.financeiro_lancamentos
  FOR UPDATE TO authenticated USING (
    (select auth.uid()) = created_by OR
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role IN ('admin','financeiro'))
  );

DROP POLICY IF EXISTS "financeiro_lanc_delete" ON public.financeiro_lancamentos;
CREATE POLICY "financeiro_lanc_delete" ON public.financeiro_lancamentos
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role IN ('admin','financeiro'))
  );

-- ── 1B. financeiro_contas_bancarias ──────────────────────────────────────────
DROP POLICY IF EXISTS "fin_contas_select" ON public.financeiro_contas_bancarias;
CREATE POLICY "fin_contas_select" ON public.financeiro_contas_bancarias
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role IN ('admin','financeiro'))
  );

DROP POLICY IF EXISTS "fin_contas_write" ON public.financeiro_contas_bancarias;
CREATE POLICY "fin_contas_write" ON public.financeiro_contas_bancarias
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role IN ('admin','financeiro'))
  );

-- ── 1C. audit_log ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "audit_log_admin_select" ON public.audit_log;
CREATE POLICY "audit_log_admin_select" ON public.audit_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role = 'admin')
  );

DROP POLICY IF EXISTS "audit_log_self_select" ON public.audit_log;
CREATE POLICY "audit_log_self_select" ON public.audit_log
  FOR SELECT USING (user_id = (select auth.uid()));

-- ── 1D. rate_limit_log ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "rate_limit_self" ON public.rate_limit_log;
CREATE POLICY "rate_limit_self" ON public.rate_limit_log
  FOR SELECT USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "rate_limit_insert" ON public.rate_limit_log;
CREATE POLICY "rate_limit_insert" ON public.rate_limit_log
  FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));

-- ── 1E. pedido_comentarios ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "comentarios_insert" ON public.pedido_comentarios;
CREATE POLICY "comentarios_insert" ON public.pedido_comentarios
  FOR INSERT TO authenticated WITH CHECK (
    user_id = (select auth.uid()) AND (public.is_approved_user() OR public.is_admin_user())
  );

-- ── 1F. peca_favoritas ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "favoritas_self" ON public.peca_favoritas;
CREATE POLICY "favoritas_self" ON public.peca_favoritas
  FOR ALL USING (user_id = (select auth.uid()));

-- ── 2. Funções com search_path mutável — adicionar SET search_path = public ──

CREATE OR REPLACE FUNCTION public.set_updated_at_producao()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $f01$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $f01$;

CREATE OR REPLACE FUNCTION public.resolve_ncm_device(
  p_risk_class text, p_implantable boolean, p_body_region text,
  p_classification text, p_primary_material text
) RETURNS text LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $f02$
DECLARE
  v_body     text := lower(coalesce(p_body_region,''));
  v_class    text := lower(coalesce(p_classification,''));
  v_material text := lower(coalesce(p_primary_material,''));
BEGIN
  IF p_implantable = true AND (v_body LIKE '%oral%' OR v_body LIKE '%dent%' OR v_body LIKE '%buc%') THEN
    IF v_class LIKE '%implant%' OR v_class LIKE '%fixture%' OR v_class LIKE '%parafus%' THEN RETURN '9021.29.10'; END IF;
    IF v_class LIKE '%pilar%' OR v_class LIKE '%abutment%' OR v_class LIKE '%proteti%' OR v_class LIKE '%protese%' OR v_class LIKE '%prótese%' THEN RETURN '9021.39.90'; END IF;
    IF v_material LIKE '%titani%' OR v_material LIKE '%ti-6%' OR v_material LIKE '%titanium%' THEN RETURN '9021.29.10'; END IF;
    RETURN '9021.39.90';
  END IF;
  IF v_body LIKE '%oral%' OR v_body LIKE '%dent%' OR v_body LIKE '%buc%' THEN
    IF v_class LIKE '%instrumen%' OR v_class LIKE '%tool%' OR v_class LIKE '%broca%' OR v_class LIKE '%fresa%' OR v_class LIKE '%kit%' THEN RETURN '9018.49.90'; END IF;
    RETURN '9021.39.90';
  END IF;
  IF p_risk_class IN ('III','IV') AND p_implantable = true THEN RETURN '9021.39.90'; END IF;
  IF p_risk_class IN ('I','II') THEN RETURN '9018.90.99'; END IF;
  RETURN '9021.39.90';
END;
$f02$;

CREATE OR REPLACE FUNCTION public.resolve_cfop_device(p_implantable boolean)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = public
AS $f03$ SELECT '5102'; $f03$;

CREATE OR REPLACE FUNCTION public.trg_auto_ncm_cfop()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $f04$
BEGIN
  IF NEW.ncm IS NULL OR NEW.ncm = '' OR NEW.ncm = '90213990' THEN
    NEW.ncm := replace(public.resolve_ncm_device(NEW.risk_class, NEW.implantable, NEW.body_region, NEW.classification_code, NEW.primary_material), '.', '');
  END IF;
  IF NEW.cfop_padrao IS NULL OR NEW.cfop_padrao = '' OR NEW.cfop_padrao = '5102' THEN
    NEW.cfop_padrao := public.resolve_cfop_device(NEW.implantable);
  END IF;
  IF NEW.unidade IS NULL OR NEW.unidade = '' THEN NEW.unidade := 'UN'; END IF;
  RETURN NEW;
END;
$f04$;

CREATE OR REPLACE FUNCTION public.get_total_stock_quantity()
RETURNS integer LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $f05$
  SELECT COALESCE(SUM(quantity)::integer, 0)
  FROM public.stock_items
  WHERE quantity > 0;
$f05$;

CREATE OR REPLACE FUNCTION public.get_devices_regularizacao_counts()
RETURNS json LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $f06$
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
  FROM public.devices_regularizacao;
$f06$;

GRANT EXECUTE ON FUNCTION public.get_total_stock_quantity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_devices_regularizacao_counts() TO authenticated;

-- ── 3. pg_trgm no schema extensions ──────────────────────────────────────────
-- O aviso "Extension in Public" para pg_trgm é resolvido movendo a extensão
-- para o schema extensions. No Supabase hospedado isso é feito pelo painel:
-- Database → Extensions → pg_trgm → mude o schema para "extensions"
-- A linha abaixo tenta fazer isso automaticamente:
DO $f07$
BEGIN
  -- Tenta mover pg_trgm para schema extensions se ainda estiver em public
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm' AND extnamespace = 'public'::regnamespace
  ) THEN
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
    RAISE NOTICE 'pg_trgm movido para schema extensions';
  ELSE
    RAISE NOTICE 'pg_trgm já está no schema correto ou não instalado em public';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Não foi possível mover pg_trgm automaticamente: %. Mova manualmente em Database > Extensions', SQLERRM;
END;
$f07$;
