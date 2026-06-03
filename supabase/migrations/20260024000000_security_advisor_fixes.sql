-- =============================================================================
-- 024: Correções apontadas pelo Supabase Security Advisor
-- =============================================================================

-- ── Fix 1: devices_regularizacao — trocar SECURITY DEFINER por SECURITY INVOKER
-- A view deve respeitar o RLS do usuário consultante, não do criador.
-- =============================================================================
DROP VIEW IF EXISTS public.devices_regularizacao;

CREATE VIEW public.devices_regularizacao
WITH (security_invoker = true)
AS
SELECT
  d.id,
  d.model,
  d.reference,
  d.risk_class,
  d.regime,
  d.status_regularizacao,
  d.empresa_lf,
  d.empresa_afe,
  d.empresa_bpf,
  d.anvisa_registration,
  d.numero_processo_anvisa,
  d.data_registro_anvisa,
  d.data_vencimento_anvisa,
  d.udi_di,
  d.gtin,
  d.siud_transmitido_em,
  d.rotulo_udi_ok,
  d.classification_code,
  d.brand_name,
  d.updated_at,
  CASE
    WHEN NOT d.empresa_lf OR NOT d.empresa_afe                      THEN 1
    WHEN d.risk_class IS NULL OR d.classification_code IS NULL       THEN 2
    WHEN d.status_regularizacao IN ('pendente', 'em_processo')       THEN 3
    WHEN d.udi_di IS NULL OR d.gtin IS NULL                         THEN 4
    ELSE 5
  END AS fase_atual,
  CASE
    WHEN d.data_vencimento_anvisa IS NOT NULL
    THEN (d.data_vencimento_anvisa - CURRENT_DATE)
    ELSE NULL
  END AS dias_ate_vencer
FROM public.devices d;

GRANT SELECT ON public.devices_regularizacao TO authenticated;

-- ── Fix 2: user_roles RLS — substituir auth.uid() por (select auth.uid())
-- Evita re-avaliação da função por linha, melhorando performance.
-- =============================================================================
DROP POLICY IF EXISTS "user_roles_own_select" ON public.user_roles;
CREATE POLICY "user_roles_own_select" ON public.user_roles
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR public.has_role((select auth.uid()), 'admin'));

DROP POLICY IF EXISTS "user_roles_admin_all" ON public.user_roles;
CREATE POLICY "user_roles_admin_all" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'));

-- Aplicar o mesmo padrão nas policies de profiles (mesmo problema potencial)
DROP POLICY IF EXISTS "profiles_own_select" ON public.profiles;
CREATE POLICY "profiles_own_select" ON public.profiles
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR public.has_role((select auth.uid()), 'admin'));

DROP POLICY IF EXISTS "profiles_own_insert" ON public.profiles;
CREATE POLICY "profiles_own_insert" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "profiles_own_update" ON public.profiles;
CREATE POLICY "profiles_own_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK (
    (select auth.uid()) = user_id
    AND approved = (SELECT approved FROM public.profiles WHERE user_id = (select auth.uid()))
    AND email    = (SELECT email    FROM public.profiles WHERE user_id = (select auth.uid()))
    AND blocked  = (SELECT blocked  FROM public.profiles WHERE user_id = (select auth.uid()))
    AND login    = (SELECT login    FROM public.profiles WHERE user_id = (select auth.uid()))
  );

DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
CREATE POLICY "profiles_admin_all" ON public.profiles
  FOR ALL TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'))
  WITH CHECK (public.has_role((select auth.uid()), 'admin'));
