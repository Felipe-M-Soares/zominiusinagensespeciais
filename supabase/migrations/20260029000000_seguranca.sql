-- =============================================================================
-- SEGURANÇA — RLS policies, rate limiting DDoS, security advisor fixes, hardening
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 20260004000000_rls_policies_core.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── user_roles ────────────────────────────────────────────────────────────────


-- ── profiles ──────────────────────────────────────────────────────────────────




-- ── devices ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "devices_approved_select" ON public.devices;
CREATE POLICY "devices_approved_select" ON public.devices
  FOR SELECT TO authenticated USING (public.is_approved_user() OR public.is_admin_user());

DROP POLICY IF EXISTS "devices_admin_insert" ON public.devices;
CREATE POLICY "devices_admin_insert" ON public.devices
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_user());


DROP POLICY IF EXISTS "devices_admin_delete" ON public.devices;
CREATE POLICY "devices_admin_delete" ON public.devices
  FOR DELETE TO authenticated USING (public.is_admin_user());

-- ── contacts ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "contacts_approved_select" ON public.contacts;
CREATE POLICY "contacts_approved_select" ON public.contacts
  FOR SELECT TO authenticated USING (public.is_approved_user() OR public.is_admin_user());

DROP POLICY IF EXISTS "contacts_admin_insert" ON public.contacts;
CREATE POLICY "contacts_admin_insert" ON public.contacts
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS "contacts_admin_update" ON public.contacts;
CREATE POLICY "contacts_admin_update" ON public.contacts
  FOR UPDATE TO authenticated USING (public.is_admin_user());

DROP POLICY IF EXISTS "contacts_admin_delete" ON public.contacts;
CREATE POLICY "contacts_admin_delete" ON public.contacts
  FOR DELETE TO authenticated USING (public.is_admin_user());

-- ── manuals ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "manuals_approved_select" ON public.manuals;
CREATE POLICY "manuals_approved_select" ON public.manuals
  FOR SELECT TO authenticated USING (public.is_approved_user() OR public.is_admin_user());

DROP POLICY IF EXISTS "manuals_admin_insert" ON public.manuals;
CREATE POLICY "manuals_admin_insert" ON public.manuals
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS "manuals_admin_update" ON public.manuals;
CREATE POLICY "manuals_admin_update" ON public.manuals
  FOR UPDATE TO authenticated USING (public.is_admin_user());

DROP POLICY IF EXISTS "manuals_admin_delete" ON public.manuals;
CREATE POLICY "manuals_admin_delete" ON public.manuals
  FOR DELETE TO authenticated USING (public.is_admin_user());

-- ── catalogs ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "catalogs_approved_select" ON public.catalogs;
CREATE POLICY "catalogs_approved_select" ON public.catalogs
  FOR SELECT TO authenticated USING (public.is_approved_user() OR public.is_admin_user());

DROP POLICY IF EXISTS "catalogs_admin_insert" ON public.catalogs;
CREATE POLICY "catalogs_admin_insert" ON public.catalogs
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS "catalogs_admin_update" ON public.catalogs;
CREATE POLICY "catalogs_admin_update" ON public.catalogs
  FOR UPDATE TO authenticated USING (public.is_admin_user());

DROP POLICY IF EXISTS "catalogs_admin_delete" ON public.catalogs;
CREATE POLICY "catalogs_admin_delete" ON public.catalogs
  FOR DELETE TO authenticated USING (public.is_admin_user());

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260017000000_ddos_rate_limiting.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- SEG-07: limita chamadas críticas no banco sem depender de middleware externo

-- ── Tabela de rate limit (sliding window) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limit_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action      text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_user_action_created
  ON public.rate_limit_log (user_id, action, created_at DESC);

-- Limpa entradas > 5 min automaticamente via trigger
DROP TRIGGER IF EXISTS trg_cleanup_rate_limit ON public.rate_limit_log;
DROP FUNCTION IF EXISTS public.cleanup_rate_limit_log();
CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f01$
BEGIN
  DELETE FROM public.rate_limit_log
  WHERE created_at < now() - interval '5 minutes';
  RETURN NULL;
END; $f01$;

DROP TRIGGER IF EXISTS trg_cleanup_rate_limit ON public.rate_limit_log;
CREATE TRIGGER trg_cleanup_rate_limit
  AFTER INSERT ON public.rate_limit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.cleanup_rate_limit_log();

-- RLS: usuário só lê seus próprios registros; INSERT aberto para authenticated
ALTER TABLE public.rate_limit_log ENABLE ROW LEVEL SECURITY;


-- ── Função check_rate_limit ───────────────────────────────────────────────────
-- Retorna TRUE se dentro do limite, FALSE se excedeu.
-- Limites configurados por ação (max_calls em window_seconds):
--   stock_movement_atomic : 60 req/60s
--   reserve_stock         : 20 req/60s
--   cancel_pedido         : 10 req/60s
--   faturar_pedido_sefaz  : 5  req/60s
DROP FUNCTION IF EXISTS public.check_rate_limit(text, uuid);
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_action text,
  p_user_id uuid DEFAULT auth.uid()
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f02$
DECLARE
  v_count   integer;
  v_max     integer;
  v_window  integer; -- seconds
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;

  -- Configuração por ação
  CASE p_action
    WHEN 'stock_movement_atomic'  THEN v_max := 60;  v_window := 60;
    WHEN 'reserve_stock'          THEN v_max := 20;  v_window := 60;
    WHEN 'cancel_pedido'          THEN v_max := 10;  v_window := 60;
    WHEN 'faturar_pedido_sefaz'   THEN v_max := 5;   v_window := 60;
    WHEN 'marcar_pedido_pronto'   THEN v_max := 30;  v_window := 60;
    WHEN 'import_devices'         THEN v_max := 3;   v_window := 300;
    ELSE                               v_max := 100; v_window := 60;
  END CASE;

  SELECT COUNT(*) INTO v_count
  FROM public.rate_limit_log
  WHERE user_id = p_user_id
    AND action  = p_action
    AND created_at > now() - (v_window || ' seconds')::interval;

  IF v_count >= v_max THEN RETURN false; END IF;

  -- Registra a chamada atual
  INSERT INTO public.rate_limit_log (user_id, action) VALUES (p_user_id, p_action);
  RETURN true;
END; $f02$;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, uuid) TO authenticated;

-- ── Adiciona check_rate_limit nas RPCs críticas ───────────────────────────────
-- NOTA: stock_movement_atomic é definida apenas uma vez nesta migration,
-- mais abaixo (seção "bloquear lotes vazios"), já incluindo rate limit e o
-- fix de autoria via servidor — evita ter duas definições divergentes da
-- mesma função no mesmo arquivo.

-- cancel_pedido com rate limit
DROP FUNCTION IF EXISTS public.cancel_pedido(uuid);
CREATE OR REPLACE FUNCTION public.cancel_pedido(p_pedido_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f04$
DECLARE v_vendedora_id uuid; v_status text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;
  IF NOT public.check_rate_limit('cancel_pedido') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Muitas requisições. Aguarde alguns segundos.');
  END IF;

  SELECT vendedora_id, status INTO v_vendedora_id, v_status
  FROM public.pedidos_comerciais WHERE id = p_pedido_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado'); END IF;
  IF v_status = 'cancelado' THEN RETURN jsonb_build_object('ok', true); END IF;
  IF v_status IN ('faturado','enviado') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pedido já faturado não pode ser cancelado');
  END IF;
  IF NOT public.is_admin_user() AND v_vendedora_id != auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão para cancelar este pedido');
  END IF;

  UPDATE public.stock_items si
  SET quantity_reserved = GREATEST(0, si.quantity_reserved - pi.quantidade_reservada)
  FROM public.pedido_itens pi
  WHERE pi.pedido_id = p_pedido_id AND pi.stock_item_id = si.id;

  UPDATE public.pedidos_comerciais SET status = 'cancelado' WHERE id = p_pedido_id;
  RETURN jsonb_build_object('ok', true);
END; $f04$;
GRANT EXECUTE ON FUNCTION public.cancel_pedido(uuid) TO authenticated;

-- faturar_pedido_sefaz com rate limit (redefine a versão da migration 015)
--
-- SEG-FIX: p_user_id/p_user_name são valores enviados pelo CLIENTE e antes
-- eram gravados direto em pedidos_comerciais/audit_log sem validação (o
-- frontend, em Financeiro.tsx, chega a mandar p_user_name fixo como
-- "Financeiro" em vez do nome real de quem faturou). A assinatura NÃO muda
-- (mesmos parâmetros, mesma ordem, mesmo retorno — compatível com o frontend
-- e os tipos gerados); o corpo passa a ignorar os parâmetros recebidos e usar
-- auth.uid() + o display_name real do profile do usuário autenticado.
DROP FUNCTION IF EXISTS public.faturar_pedido_sefaz(uuid, text, text, text, timestamptz, uuid, text, text);
CREATE OR REPLACE FUNCTION public.faturar_pedido_sefaz(
  p_pedido_id uuid, p_nf text, p_chave_acesso text, p_protocolo text,
  p_dh_autorizacao timestamptz,
  p_user_id uuid,    -- mantido na assinatura por compatibilidade; ignorado no corpo
  p_user_name text,  -- mantido na assinatura por compatibilidade; ignorado no corpo
  p_xml_nfe text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f05$
DECLARE
  v_status       text;
  v_nf_existente text;
  v_role         text;
  v_real_uid     uuid := auth.uid();
  v_real_name    text;
BEGIN
  IF v_real_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;

  -- Somente admin ou financeiro
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = v_real_uid LIMIT 1;
  IF v_role NOT IN ('admin','financeiro') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão: requer role admin ou financeiro');
  END IF;

  IF NOT public.check_rate_limit('faturar_pedido_sefaz') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Muitas requisições de faturamento. Aguarde 1 minuto.');
  END IF;

  SELECT status, nota_fiscal INTO v_status, v_nf_existente
  FROM public.pedidos_comerciais WHERE id = p_pedido_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado'); END IF;
  IF v_nf_existente = p_nf THEN RETURN jsonb_build_object('ok', true, 'already_faturado', true); END IF;
  IF v_status != 'pronto' THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'Pedido deve estar no status "pronto" para ser faturado. Status atual: ' || v_status);
  END IF;

  -- SEG-FIX: autoria sempre do servidor, nunca do parâmetro recebido do cliente
  SELECT display_name INTO v_real_name FROM public.profiles WHERE user_id = v_real_uid;

  UPDATE public.pedidos_comerciais SET
    status='enviado', nota_fiscal=p_nf, chave_acesso_nfe=p_chave_acesso,
    protocolo_sefaz=p_protocolo, dh_autorizacao_nfe=p_dh_autorizacao,
    nf_criada_por=v_real_uid, nf_criada_em=now(), enviado_em=now(), xml_nfe=p_xml_nfe
  WHERE id = p_pedido_id;

  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (v_real_uid, COALESCE(v_real_name, 'Desconhecido'), 'faturar_nf', 'pedido_comercial', p_pedido_id,
    jsonb_build_object('nota_fiscal', p_nf, 'protocolo', p_protocolo));

  RETURN jsonb_build_object('ok', true);
END; $f05$;
GRANT EXECUTE ON FUNCTION public.faturar_pedido_sefaz(uuid,text,text,text,timestamptz,uuid,text,text) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 20260024000000_security_advisor_fixes.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Fix 1: devices_regularizacao — trocar SECURITY DEFINER por SECURITY INVOKER
-- A view deve respeitar o RLS do usuário consultante, não do criador.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260025000000_rls_auth_uid_performance.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Evita re-avaliação da função por linha (Supabase Security Advisor warnings)

-- ── devices ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "devices_admin_update" ON public.devices;
CREATE POLICY "devices_admin_update" ON public.devices
  FOR UPDATE TO authenticated
  USING (public.is_admin_user() OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = (select auth.uid()) AND role IN ('admin', 'financeiro')
  ));

-- ── stock_movements ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "stock_movements_insert" ON public.stock_movements;
CREATE POLICY "stock_movements_insert" ON public.stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_user() AND (user_id IS NULL OR user_id = (select auth.uid())));

-- ── clientes ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "clientes_select" ON public.clientes;
CREATE POLICY "clientes_select" ON public.clientes FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role IN ('admin','comercial','estoque','financeiro'))
  OR (select auth.uid()) = created_by
);

DROP POLICY IF EXISTS "clientes_insert" ON public.clientes;
CREATE POLICY "clientes_insert" ON public.clientes
  FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = created_by);

DROP POLICY IF EXISTS "clientes_update" ON public.clientes;
CREATE POLICY "clientes_update" ON public.clientes FOR UPDATE TO authenticated USING (
  (select auth.uid()) = created_by OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role = 'admin')
);

DROP POLICY IF EXISTS "clientes_delete" ON public.clientes;
CREATE POLICY "clientes_delete" ON public.clientes FOR DELETE TO authenticated USING (
  (select auth.uid()) = created_by OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role = 'admin')
);

-- ── pedidos_comerciais ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "pedidos_select" ON public.pedidos_comerciais;
CREATE POLICY "pedidos_select" ON public.pedidos_comerciais FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role IN ('admin','comercial','estoque','financeiro'))
  OR vendedora_id = (select auth.uid())
);

DROP POLICY IF EXISTS "pedidos_delete" ON public.pedidos_comerciais;
CREATE POLICY "pedidos_delete" ON public.pedidos_comerciais FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role = 'admin')
);

-- ── pedido_itens ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "pedido_itens_select" ON public.pedido_itens;
CREATE POLICY "pedido_itens_select" ON public.pedido_itens FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.pedidos_comerciais pc WHERE pc.id = pedido_id AND (
    pc.vendedora_id = (select auth.uid()) OR
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role IN ('admin','comercial','estoque','financeiro'))
  ))
);

DROP POLICY IF EXISTS "pedido_itens_delete" ON public.pedido_itens;
CREATE POLICY "pedido_itens_delete" ON public.pedido_itens FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (select auth.uid()) AND role = 'admin')
);

-- ── notificacoes ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "notif_select" ON public.notificacoes;
CREATE POLICY "notif_select" ON public.notificacoes
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "notif_update" ON public.notificacoes;
CREATE POLICY "notif_update" ON public.notificacoes
  FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id);

-- ── producao ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "apon_update" ON apontamentos_producao;
CREATE POLICY "apon_update" ON apontamentos_producao
  FOR UPDATE USING ((select auth.uid()) = user_id OR public.get_my_role() IN ('admin','producao'));

DROP POLICY IF EXISTS "par_update" ON paradas_producao;
CREATE POLICY "par_update" ON paradas_producao
  FOR UPDATE USING ((select auth.uid()) = user_id OR public.get_my_role() IN ('admin','producao'));

DROP POLICY IF EXISTS "ref_update" ON refugos_producao;
CREATE POLICY "ref_update" ON refugos_producao
  FOR UPDATE USING ((select auth.uid()) = user_id OR public.get_my_role() IN ('admin','producao'));

-- Policies que usam auth.uid() IS NOT NULL → trocar por autenticação via role
DROP POLICY IF EXISTS "maq_select"  ON maquinas_producao;
DROP POLICY IF EXISTS "prod_select" ON produtos_producao;
DROP POLICY IF EXISTS "apon_select" ON apontamentos_producao;
DROP POLICY IF EXISTS "apon_insert" ON apontamentos_producao;
DROP POLICY IF EXISTS "op_select"   ON ordens_planejamento;
DROP POLICY IF EXISTS "op_insert"   ON ordens_planejamento;
DROP POLICY IF EXISTS "op_update"   ON ordens_planejamento;
DROP POLICY IF EXISTS "par_select"  ON paradas_producao;
DROP POLICY IF EXISTS "par_insert"  ON paradas_producao;
DROP POLICY IF EXISTS "ref_select"  ON refugos_producao;
DROP POLICY IF EXISTS "ref_insert"  ON refugos_producao;
DROP POLICY IF EXISTS "mp_select"   ON materias_primas_producao;
DROP POLICY IF EXISTS "mp_update"   ON materias_primas_producao;
DROP POLICY IF EXISTS "mov_select"  ON movimentos_mp_producao;
DROP POLICY IF EXISTS "mov_insert"  ON movimentos_mp_producao;

CREATE POLICY "maq_select"  ON maquinas_producao     FOR SELECT USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "prod_select" ON public.produtos_producao;
CREATE POLICY "prod_select" ON produtos_producao      FOR SELECT USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "apon_select" ON public.apontamentos_producao;
CREATE POLICY "apon_select" ON apontamentos_producao  FOR SELECT USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "apon_insert" ON public.apontamentos_producao;
CREATE POLICY "apon_insert" ON apontamentos_producao  FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);
CREATE POLICY "op_select"   ON ordens_planejamento    FOR SELECT USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "op_insert"   ON ordens_planejamento    FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);
CREATE POLICY "op_update"   ON ordens_planejamento    FOR UPDATE USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "par_select"  ON paradas_producao       FOR SELECT USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "par_insert"  ON paradas_producao       FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);
CREATE POLICY "ref_select"  ON refugos_producao       FOR SELECT USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "ref_insert"  ON refugos_producao       FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);
CREATE POLICY "mp_select"   ON materias_primas_producao  FOR SELECT USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "mp_update"   ON materias_primas_producao  FOR UPDATE USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "mov_select"  ON movimentos_mp_producao FOR SELECT USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "mov_insert"  ON movimentos_mp_producao FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260026000000_security_advisor_final.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. auth.uid() → (select auth.uid()) nas policies restantes
-- 2. SET search_path nas funções com search_path mutável
-- 3. Extension pg_trgm → mover para schema extensions (via config.toml)

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260028000000_vault_token_api.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- FIX REAL: token_api de financeiro_contas_bancarias estava em plain text.
-- Implementado com Supabase Vault (extensão habilitada por padrão em todo
-- projeto Supabase hospedado — diferente de pg_cron/pgsodium, não exige
-- nenhuma ativação manual no painel). A chave de criptografia raiz é gerida
-- internamente pelo Supabase e nunca fica acessível via SQL.
--
-- Esquema: a coluna token_api (texto puro) é substituída por
-- token_api_secret_id (uuid, aponta para vault.secrets.id). O texto cifrado
-- vive em vault.secrets; só é lido de volta através de vault.decrypted_secrets,
-- e só dentro da função get_conta_bancaria_token() abaixo — nunca via
-- SELECT * direto na tabela.

-- 1. Nova coluna (referência ao secret no Vault, não o valor)
ALTER TABLE public.financeiro_contas_bancarias
  ADD COLUMN IF NOT EXISTS token_api_secret_id uuid;

-- 2. Migra tokens já cadastrados em texto puro para o Vault, se a coluna
--    antiga ainda existir (idempotente — pula linhas já migradas)
DO $f01$
DECLARE
  v_row record;
  v_secret_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'financeiro_contas_bancarias'
      AND column_name = 'token_api'
  ) THEN
    FOR v_row IN
      SELECT id, token_api FROM public.financeiro_contas_bancarias
      WHERE token_api IS NOT NULL AND token_api <> '' AND token_api_secret_id IS NULL
    LOOP
      SELECT vault.create_secret(
        v_row.token_api,
        'fin_conta_token_' || v_row.id::text,
        'Token API de integração bancária — migrado de plain text'
      ) INTO v_secret_id;
      UPDATE public.financeiro_contas_bancarias
        SET token_api_secret_id = v_secret_id WHERE id = v_row.id;
    END LOOP;
    RAISE NOTICE 'Tokens migrados para o Vault.';

    -- Remove a coluna antiga em texto puro — não há mais motivo para mantê-la
    ALTER TABLE public.financeiro_contas_bancarias DROP COLUMN IF EXISTS token_api;
    RAISE NOTICE 'Coluna token_api (plain text) removida.';
  ELSE
    RAISE NOTICE 'Coluna token_api não encontrada — nada a migrar.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Falha ao migrar tokens para o Vault: %. Os tokens antigos NÃO foram apagados; investigue antes de tentar de novo.', SQLERRM;
END;
$f01$;

-- 3. Grava/atualiza o token de uma conta — cria um novo secret no Vault e
--    descarta o anterior (vault.update_secret também existiria, mas criar
--    novo + apagar o velho é mais simples de auditar e evita corromper o
--    secret em caso de falha no meio do update).
CREATE OR REPLACE FUNCTION public.set_conta_bancaria_token(p_conta_id uuid, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f02$
DECLARE
  v_old_secret_id uuid;
  v_new_secret_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('admin','financeiro')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso não autorizado.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.financeiro_contas_bancarias WHERE id = p_conta_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Conta bancária não encontrada.');
  END IF;

  SELECT token_api_secret_id INTO v_old_secret_id
  FROM public.financeiro_contas_bancarias WHERE id = p_conta_id;

  IF p_token IS NULL OR p_token = '' THEN
    -- Remover o token: limpa a referência e apaga o secret antigo
    UPDATE public.financeiro_contas_bancarias
      SET token_api_secret_id = NULL WHERE id = p_conta_id;
    IF v_old_secret_id IS NOT NULL THEN
      DELETE FROM vault.secrets WHERE id = v_old_secret_id;
    END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;

  SELECT vault.create_secret(
    p_token,
    'fin_conta_token_' || p_conta_id::text || '_' || extract(epoch FROM now())::text,
    'Token API de integração bancária'
  ) INTO v_new_secret_id;

  UPDATE public.financeiro_contas_bancarias
    SET token_api_secret_id = v_new_secret_id WHERE id = p_conta_id;

  IF v_old_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_old_secret_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$f02$;

GRANT EXECUTE ON FUNCTION public.set_conta_bancaria_token(uuid, text) TO authenticated;

-- 4. Lê o token de volta em texto puro — só quem tem role admin/financeiro,
--    e só nesta função (nunca via SELECT * na tabela). Usada exclusivamente
--    no momento em que o usuário pede para testar o webhook.
CREATE OR REPLACE FUNCTION public.get_conta_bancaria_token(p_conta_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f03$
DECLARE
  v_secret_id uuid;
  v_token text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('admin','financeiro')
  ) THEN
    RAISE EXCEPTION 'Acesso não autorizado.';
  END IF;

  SELECT token_api_secret_id INTO v_secret_id
  FROM public.financeiro_contas_bancarias WHERE id = p_conta_id;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets WHERE id = v_secret_id;

  RETURN v_token;
END;
$f03$;

GRANT EXECUTE ON FUNCTION public.get_conta_bancaria_token(uuid) TO authenticated;

COMMENT ON COLUMN public.financeiro_contas_bancarias.token_api_secret_id IS
  'Referência ao secret no Supabase Vault (vault.secrets.id). O valor real do token NUNCA é armazenado nesta tabela — use set_conta_bancaria_token()/get_conta_bancaria_token() para escrever/ler.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260029000000_final_hardening.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Índices adicionais para queries frequentes ────────────────────────────────

-- profiles: busca por login (case-insensitive) — usado no login
CREATE INDEX IF NOT EXISTS idx_profiles_login_lower
  ON public.profiles (lower(login))
  WHERE login IS NOT NULL;

-- profiles: aprovação + bloqueio (verificado no login e no realtime)
CREATE INDEX IF NOT EXISTS idx_profiles_approved_blocked
  ON public.profiles (user_id, approved, blocked);

-- stock_items: fase + quantity (usado em contagens por fase)
CREATE INDEX IF NOT EXISTS idx_stock_items_fase_qty
  ON public.stock_items (fase, quantity)
  WHERE quantity > 0;

-- pedidos_comerciais: status + created_at (listagem por status)
CREATE INDEX IF NOT EXISTS idx_pedidos_status_created
  ON public.pedidos_comerciais (status, created_at DESC);

-- audit_log: índice em created_at para queries de limpeza e listagem
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON public.audit_log (created_at DESC);

-- ── GRANTs faltantes em funções ───────────────────────────────────────────────

-- Funções que podem estar sem GRANT após reordenação de migrations
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_user()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved_user()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_role()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_password(uuid,text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_stock_items_from_devices()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lotes_intermediario()              TO authenticated;

-- admin_clear_history removida (ver nota em 20260027000000_estoque.sql) —
-- DROP explícito para apagar de bancos que já tinham essa função aplicada
-- antes desta correção.
DROP FUNCTION IF EXISTS public.admin_clear_history();

-- Revogar acesso anon em funções admin (defense in depth)
REVOKE ALL ON FUNCTION public.admin_create_user(text,text,text,text)    FROM anon;
REVOKE ALL ON FUNCTION public.admin_reset_password(uuid,text)           FROM anon;
REVOKE ALL ON FUNCTION public.admin_delete_user(uuid)                   FROM anon;

-- ── Limpeza automática de audit_log antigo ────────────────────────────────────
-- Remove registros com mais de 90 dias para evitar crescimento ilimitado
CREATE OR REPLACE FUNCTION public.cleanup_audit_log()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $f01$
  DELETE FROM public.audit_log
  WHERE created_at < now() - INTERVAL '90 days';
$f01$;

GRANT EXECUTE ON FUNCTION public.cleanup_audit_log() TO authenticated;

-- ── Agendamento automático real via pg_cron ───────────────────────────────────
-- ATENÇÃO: pg_cron exige habilitação manual no Supabase hospedado (não pode
-- ser feito por SQL de migration comum, exige superuser). Antes desta seção
-- funcionar, habilite uma vez em:
--   Supabase Dashboard → Database → Extensions → pg_cron → Enable
-- Depois disso, o bloco abaixo agenda a limpeza para todo dia às 2h da manhã
-- automaticamente — sem precisar configurar nada manualmente no painel de Cron
-- Jobs. Se pg_cron ainda não estiver habilitada, o bloco abaixo apenas avisa
-- e não falha a migration.
DO $f01b$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup_audit_log_diario') THEN
      PERFORM cron.unschedule('cleanup_audit_log_diario');
    END IF;
    PERFORM cron.schedule(
      'cleanup_audit_log_diario',
      '0 2 * * *',
      $job$SELECT public.cleanup_audit_log();$job$
    );
    RAISE NOTICE 'Cron job "cleanup_audit_log_diario" agendado (todo dia às 2h).';
  ELSE
    RAISE NOTICE 'pg_cron não está habilitada — limpeza automática de audit_log NÃO foi agendada. Habilite em Database > Extensions > pg_cron e rode esta migration de novo.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Não foi possível agendar cleanup_audit_log via pg_cron: %. Agende manualmente em Database > Cron Jobs.', SQLERRM;
END;
$f01b$;

-- ── Trigger de limpeza automática do audit_log ────────────────────────────────
-- Nota: a limpeza roda via pg_cron (ver bloco acima) chamando esta RPC todo
-- dia às 2h. Sem trigger por linha — seria custoso rodar a cada INSERT.
DROP TRIGGER IF EXISTS trg_cleanup_audit_log ON public.audit_log;

-- ── Comentários de documentação nas tabelas principais ───────────────────────
COMMENT ON TABLE public.profiles    IS 'Perfis de usuário: aprovação, bloqueio, login interno';
COMMENT ON TABLE public.user_roles  IS 'Roles do sistema: admin, estoque, qualidade, comercial, financeiro, producao';
COMMENT ON TABLE public.devices     IS 'Catálogo de dispositivos médicos com conformidade ANVISA';
COMMENT ON TABLE public.stock_items IS 'Estoque por fase: intermediaria, expedicao, retrabalho';
COMMENT ON TABLE public.stock_movements IS 'Histórico de movimentações de estoque com lotes';
COMMENT ON TABLE public.pedidos_comerciais IS 'Pedidos comerciais com NF-e SEFAZ';
COMMENT ON TABLE public.audit_log   IS 'Log de auditoria de ações críticas (retido 90 dias)';
COMMENT ON TABLE public.rate_limit_log IS 'Rate limiting de operações críticas (sliding window)';

-- =============================================================================
-- FIX RLS: RPCs SECURITY DEFINER para operações em stock_items por não-admins
-- =============================================================================
-- Problema: a policy "stock_items_write_admin" só permite admin fazer INSERT/UPDATE.
-- Usuários com role estoque/comercial precisam:
--   1. Criar itens de expedição ao transferir do intermediário
--   2. Criar itens de retrabalho ao enviar da expedição
--   3. Criar/upsert itens via importação (Excel/CSV)
--   4. Atualizar campos de configuração (min_quantity, location, notes) via CSV
-- Solução: RPCs com SECURITY DEFINER que validam a role antes de agir.
-- O admin continua funcionando normalmente via RLS (is_admin_user() = true).
-- =============================================================================

-- ── Helper: can_write_stock ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_write_stock()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f_cws$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = (SELECT auth.uid())
      AND role IN ('admin', 'estoque', 'comercial')
  )
$f_cws$;
GRANT EXECUTE ON FUNCTION public.can_write_stock() TO authenticated;

-- ── ensure_stock_item_fase ────────────────────────────────────────────────────
-- Localiza ou cria um stock_item para (device_id, fase).
-- Retorna o UUID do item (existente ou criado).
DROP FUNCTION IF EXISTS public.ensure_stock_item_fase(uuid, text, uuid, text);
CREATE OR REPLACE FUNCTION public.ensure_stock_item_fase(
  p_device_id      uuid,
  p_fase           text,
  p_source_item_id uuid,
  p_notes_override text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_esf$
DECLARE
  v_existing_id uuid;
  v_new_id      uuid;
  v_src_min     integer;
  v_src_loc     text;
  v_src_notes   text;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF NOT public.can_write_stock() THEN
    RAISE EXCEPTION 'Sem permissão para criar itens de estoque (requer: admin, estoque ou comercial)';
  END IF;

  IF p_fase NOT IN ('expedicao', 'retrabalho') THEN
    RAISE EXCEPTION 'Fase inválida: %', p_fase;
  END IF;

  -- Para retrabalho com notes_override: busca pelo notes (lote único por item)
  IF p_fase = 'retrabalho' AND p_notes_override IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.stock_items
    WHERE device_id = p_device_id
      AND fase = 'retrabalho'
      AND notes ILIKE '%' || p_notes_override || '%'
    LIMIT 1;
  ELSE
    SELECT id INTO v_existing_id
    FROM public.stock_items
    WHERE device_id = p_device_id AND fase = p_fase
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- Copia atributos do item de origem
  SELECT min_quantity, location, notes
  INTO v_src_min, v_src_loc, v_src_notes
  FROM public.stock_items
  WHERE id = p_source_item_id;

  INSERT INTO public.stock_items (device_id, quantity, min_quantity, location, notes, fase)
  VALUES (
    p_device_id,
    0,
    CASE WHEN p_fase = 'retrabalho' THEN 0 ELSE COALESCE(v_src_min, 0) END,
    v_src_loc,
    COALESCE(p_notes_override, v_src_notes),
    p_fase
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$f_esf$;
GRANT EXECUTE ON FUNCTION public.ensure_stock_item_fase(uuid, text, uuid, text) TO authenticated;

-- ── upsert_stock_item_for_device ──────────────────────────────────────────────
-- Cria ou recupera um stock_item para (device_id, fase).
-- Usado nas importações Excel/CSV.
DROP FUNCTION IF EXISTS public.upsert_stock_item_for_device(uuid, text);
CREATE OR REPLACE FUNCTION public.upsert_stock_item_for_device(
  p_device_id uuid,
  p_fase      text DEFAULT 'intermediaria'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_uid$
DECLARE
  v_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF NOT public.can_write_stock() THEN
    RAISE EXCEPTION 'Sem permissão para criar itens de estoque';
  END IF;

  IF p_fase NOT IN ('intermediaria', 'expedicao', 'retrabalho') THEN
    RAISE EXCEPTION 'Fase inválida: %', p_fase;
  END IF;

  INSERT INTO public.stock_items (device_id, quantity, min_quantity, fase)
  VALUES (p_device_id, 0, 0, p_fase)
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_id
  FROM public.stock_items
  WHERE device_id = p_device_id AND fase = p_fase
  LIMIT 1;

  RETURN v_id;
END;
$f_uid$;
GRANT EXECUTE ON FUNCTION public.upsert_stock_item_for_device(uuid, text) TO authenticated;

-- ── update_stock_item_settings ────────────────────────────────────────────────
-- Atualiza campos de configuração (não-quantidade) de um stock_item.
-- Usado no CSV import. Não toca em quantity/quantity_reserved.
DROP FUNCTION IF EXISTS public.update_stock_item_settings(uuid, integer, text, text);
CREATE OR REPLACE FUNCTION public.update_stock_item_settings(
  p_item_id  uuid,
  p_min_qty  integer DEFAULT NULL,
  p_location text    DEFAULT NULL,
  p_notes    text    DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_uss$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF NOT public.can_write_stock() THEN
    RAISE EXCEPTION 'Sem permissão para atualizar itens de estoque';
  END IF;

  UPDATE public.stock_items
  SET
    min_quantity = COALESCE(p_min_qty,   min_quantity),
    location     = COALESCE(p_location,  location),
    notes        = COALESCE(p_notes,     notes),
    updated_at   = now()
  WHERE id = p_item_id;
END;
$f_uss$;
GRANT EXECUTE ON FUNCTION public.update_stock_item_settings(uuid, integer, text, text) TO authenticated;

-- ── add_device_to_stock_rpc ───────────────────────────────────────────────────
-- Substitui o upsert direto em addDeviceToStock (useStock.ts).
DROP FUNCTION IF EXISTS public.add_device_to_stock_rpc(uuid);
CREATE OR REPLACE FUNCTION public.add_device_to_stock_rpc(p_device_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_ads$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF NOT public.can_write_stock() THEN
    RAISE EXCEPTION 'Sem permissão para adicionar peças ao estoque';
  END IF;

  INSERT INTO public.stock_items (device_id, quantity, min_quantity, fase)
  VALUES (p_device_id, 0, 0, 'intermediaria')
  ON CONFLICT DO NOTHING;
END;
$f_ads$;
GRANT EXECUTE ON FUNCTION public.add_device_to_stock_rpc(uuid) TO authenticated;

-- ── release_item_reservation ──────────────────────────────────────────────────
-- Libera quantidade_reservada ao remover item de pedido pendente.
-- Usado em Comercial.tsx por role=comercial, que não tem acesso direto de UPDATE.
-- Usa GREATEST(0, ...) para evitar reservas negativas.
DROP FUNCTION IF EXISTS public.release_item_reservation(uuid, integer);
CREATE OR REPLACE FUNCTION public.release_item_reservation(
  p_stock_item_id uuid,
  p_quantity      integer
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_rir$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  -- Roles que podem liberar reservas: admin, comercial, estoque
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = (SELECT auth.uid())
      AND role IN ('admin', 'comercial', 'estoque')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para liberar reservas de estoque';
  END IF;

  UPDATE public.stock_items
  SET
    quantity_reserved = GREATEST(0, quantity_reserved - p_quantity),
    updated_at        = now()
  WHERE id = p_stock_item_id;
END;
$f_rir$;
GRANT EXECUTE ON FUNCTION public.release_item_reservation(uuid, integer) TO authenticated;

-- ── set_password_done ─────────────────────────────────────────────────────────
-- Marca must_change_password = false para o usuário autenticado.
-- Necessário porque a policy profiles_own_update usa WITH CHECK que compara
-- login/email/approved/blocked com os valores atuais — se login for NULL,
-- "NULL = NULL" retorna false em SQL e o UPDATE falha silenciosamente.
DROP FUNCTION IF EXISTS public.set_password_done();
CREATE OR REPLACE FUNCTION public.set_password_done()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_spd$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  UPDATE public.profiles
  SET must_change_password = false
  WHERE user_id = (SELECT auth.uid());
END;
$f_spd$;
GRANT EXECUTE ON FUNCTION public.set_password_done() TO authenticated;

-- =============================================================================
-- FIX RLS stock_items: expandir policy de escrita para roles autorizadas
-- =============================================================================
-- A policy "stock_items_write_admin" só permite admin fazer INSERT/UPDATE/DELETE.
-- Isso causa 2 problemas:
-- 1. stock_movement_atomic (SECURITY DEFINER) tenta UPDATE em stock_items — se o
--    owner da função não tiver BYPASSRLS, o UPDATE falha silenciosamente e o lote
--    é salvo no stock_movements mas a quantity não é atualizada.
-- 2. Funções ensure_stock_item_fase, upsert_stock_item_for_device etc. dependem de
--    BYPASSRLS do owner para funcionar corretamente.
-- Solução: adicionar policy explícita para roles autorizadas, eliminando a
-- dependência de BYPASSRLS e garantindo comportamento consistente em qualquer
-- ambiente Supabase (hosted ou self-hosted).
-- =============================================================================

-- Remove policy restritiva antiga (admin-only)
DROP POLICY IF EXISTS "stock_items_write_admin" ON public.stock_items;
DROP POLICY IF EXISTS "stock_items_write_roles"  ON public.stock_items;

-- Nova policy: admin, estoque e comercial podem escrever em stock_items
CREATE POLICY "stock_items_write_roles" ON public.stock_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = (SELECT auth.uid())
        AND role IN ('admin', 'estoque', 'comercial')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = (SELECT auth.uid())
        AND role IN ('admin', 'estoque', 'comercial')
    )
  );

-- ── set_own_password ──────────────────────────────────────────────────────────
-- Troca a senha do próprio usuário autenticado diretamente em auth.users.
-- Necessário porque supabase.auth.updateUser({ password }) retorna 400 quando
-- a sessão foi criada via INSERT direto (admin_create_user), pois o Supabase
-- Auth exige reauthentication para esse fluxo. Esta RPC bypassa essa restrição
-- fazendo o UPDATE idêntico ao admin_reset_password, mas para o próprio usuário.
DROP FUNCTION IF EXISTS public.set_own_password(text);
CREATE OR REPLACE FUNCTION public.set_own_password(p_password text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $f_sop$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado');
  END IF;

  IF length(p_password) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Senha deve ter no mínimo 8 caracteres');
  END IF;

  IF length(p_password) > 72 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Senha deve ter no máximo 72 caracteres');
  END IF;

  -- Atualiza a senha diretamente em auth.users (mesmo mecanismo do admin_reset_password)
  UPDATE auth.users
  SET
    encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
    updated_at         = now()
  WHERE id = (SELECT auth.uid());

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuário não encontrado');
  END IF;

  -- Marca must_change_password = false
  UPDATE public.profiles
  SET must_change_password = false
  WHERE user_id = (SELECT auth.uid());

  RETURN jsonb_build_object('ok', true);
END;
$f_sop$;
GRANT EXECUTE ON FUNCTION public.set_own_password(text) TO authenticated;

-- =============================================================================
-- REALTIME: habilitar publicação e replica identity nas tabelas que usam
-- postgres_changes no frontend. Sem isso os canais se conectam mas não recebem
-- nenhum evento — o Supabase Realtime exige que a tabela esteja na publication
-- "supabase_realtime" e com REPLICA IDENTITY FULL para enviar o payload completo.
-- =============================================================================

-- Replica identity: garante que o Realtime envia old + new row completos
ALTER TABLE public.stock_items     REPLICA IDENTITY FULL;
ALTER TABLE public.stock_movements REPLICA IDENTITY FULL;
ALTER TABLE public.pedidos_comerciais REPLICA IDENTITY FULL;
ALTER TABLE public.profiles        REPLICA IDENTITY FULL;

-- Adiciona as tabelas à publication do Supabase Realtime
-- (IF NOT EXISTS não é suportado em ALTER PUBLICATION ADD TABLE, então usamos DO block)
DO $$
BEGIN
  -- stock_items
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'stock_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_items;
  END IF;

  -- stock_movements
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'stock_movements'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_movements;
  END IF;

  -- pedidos_comerciais
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'pedidos_comerciais'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pedidos_comerciais;
  END IF;

  -- profiles (já pode estar — garante sem erro)
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
END;
$$;

-- =============================================================================
-- FIX: bloquear lotes vazios ou sem numeração na RPC stock_movement_atomic
-- Garante que mesmo que o frontend passe um lote inválido, o banco rejeita.
--
-- SEG-FIX: p_user_id/p_user_name são valores enviados pelo CLIENTE e antes
-- eram gravados direto em stock_movements sem validação — um usuário
-- autenticado podia forjar esses parâmetros e fazer um movimento aparecer
-- registrado em nome de outra pessoa. A assinatura NÃO muda (mesmos
-- parâmetros, mesma ordem, mesmo retorno — compatível com o frontend e os
-- tipos gerados); o corpo passa a ignorar os parâmetros recebidos e usar
-- auth.uid() + o display_name real do profile do usuário autenticado.
-- =============================================================================
DROP FUNCTION IF EXISTS public.stock_movement_atomic(uuid, text, integer, text, text, uuid, text);
CREATE OR REPLACE FUNCTION public.stock_movement_atomic(
  p_item_id   uuid,
  p_type      text,
  p_qty       integer,
  p_reason    text,
  p_lote      text,
  p_user_id   uuid,   -- mantido na assinatura por compatibilidade; ignorado no corpo
  p_user_name text    -- mantido na assinatura por compatibilidade; ignorado no corpo
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_sma$
DECLARE
  v_current   integer;
  v_real_uid  uuid := auth.uid();
  v_real_name text;
BEGIN
  IF v_real_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;
  IF NOT public.check_rate_limit('stock_movement_atomic') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Muitas requisições. Aguarde alguns segundos.');
  END IF;

  IF p_type NOT IN ('entrada','saida') THEN RETURN jsonb_build_object('ok', false, 'error', 'Tipo inválido'); END IF;
  IF p_qty <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'Quantidade deve ser > 0'); END IF;

  -- Bloqueia lotes vazios ou placeholders sem numeração real
  IF p_type = 'entrada' THEN
    IF p_lote IS NULL OR trim(p_lote) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Lote obrigatório para entrada. Use o formato DDMMYYS-NN (ex: 0101261-01).');
    END IF;
    IF lower(trim(p_lote)) IN ('sem lote', 'a-definir', 'a definir', 'sem_lote') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Lote sem numeração não é permitido. Use o formato DDMMYYS-NN (ex: 0101261-01).');
    END IF;
  END IF;

  SELECT quantity INTO v_current FROM public.stock_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado'); END IF;
  IF p_type = 'saida' AND v_current < p_qty THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Estoque insuficiente: ' || v_current || ' disponível');
  END IF;

  -- SEG-FIX: autoria sempre do servidor, nunca do parâmetro recebido do cliente
  SELECT display_name INTO v_real_name FROM public.profiles WHERE user_id = v_real_uid;

  UPDATE public.stock_items
  SET quantity = CASE WHEN p_type = 'entrada' THEN quantity + p_qty ELSE GREATEST(0, quantity - p_qty) END,
      updated_at = now()
  WHERE id = p_item_id;

  INSERT INTO public.stock_movements (stock_item_id, type, quantity, reason, lote, user_id, user_display_name)
  VALUES (p_item_id, p_type, p_qty, p_reason, p_lote, v_real_uid, COALESCE(v_real_name, 'Desconhecido'));

  RETURN jsonb_build_object('ok', true);
END; $f_sma$;
GRANT EXECUTE ON FUNCTION public.stock_movement_atomic(uuid,text,integer,text,text,uuid,text) TO authenticated;
