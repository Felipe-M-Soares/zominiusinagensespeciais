-- =============================================================================
-- DESENHOS TÉCNICOS — PDFs de desenho técnico por peça (visualização + impressão
-- direto no card do componente, sem opção de download).
-- =============================================================================

-- ── 1. Coluna de vínculo em devices ──────────────────────────────────────────
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS desenho_tecnico_path text;

-- ── 2. Bucket privado (mesmo padrão de 'manuals': leitura por usuário aprovado,
--       escrita só admin) ───────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('desenhos-tecnicos', 'desenhos-tecnicos', false, 52428800, ARRAY['application/pdf'])
  ON CONFLICT (id) DO UPDATE SET
    file_size_limit = 52428800,
    allowed_mime_types = ARRAY['application/pdf'];

DROP POLICY IF EXISTS "desenhos_tecnicos_approved_read" ON storage.objects;
CREATE POLICY "desenhos_tecnicos_approved_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'desenhos-tecnicos' AND (public.is_approved_user() OR public.is_admin_user()));

DROP POLICY IF EXISTS "desenhos_tecnicos_admin_insert" ON storage.objects;
CREATE POLICY "desenhos_tecnicos_admin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'desenhos-tecnicos' AND public.is_admin_user());

DROP POLICY IF EXISTS "desenhos_tecnicos_admin_update" ON storage.objects;
CREATE POLICY "desenhos_tecnicos_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'desenhos-tecnicos' AND public.is_admin_user());

DROP POLICY IF EXISTS "desenhos_tecnicos_admin_delete" ON storage.objects;
CREATE POLICY "desenhos_tecnicos_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'desenhos-tecnicos' AND public.is_admin_user());


-- =============================================================================
-- REVISÃO GERAL (set/2026) — correções de segurança, integridade e keep-alive
-- =============================================================================
-- Tudo abaixo é IDEMPOTENTE (pode ser executado quantas vezes quiser).
-- Foi integrado nesta migration (a última) em vez de criar um arquivo novo.
-- Se este arquivo JÁ tinha sido aplicado no seu projeto antes desta revisão,
-- copie a partir deste cabeçalho até o fim e execute no SQL Editor do
-- Supabase (Dashboard → SQL Editor → New query → Run).

-- ── R1. Keep-alive: impede o Supabase (plano Free) de pausar o projeto ───────
-- Projetos Free são pausados após ~7 dias sem atividade. O workflow
-- .github/workflows/supabase-keepalive.yml (e o cron da Vercel em
-- api/keep-alive.js) chamam esta função periodicamente via REST.
-- Ela grava 1 linha de heartbeat (atividade real de escrita no banco) e
-- devolve apenas {ok, at} — nenhum dado de negócio é exposto.
CREATE TABLE IF NOT EXISTS public.system_heartbeat (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_ping   timestamptz NOT NULL DEFAULT now(),
  source      text,
  ping_count  bigint NOT NULL DEFAULT 0
);
ALTER TABLE public.system_heartbeat ENABLE ROW LEVEL SECURITY;
-- Sem policies: ninguém lê/escreve direto; só pela função abaixo.

CREATE OR REPLACE FUNCTION public.keep_alive(p_source text DEFAULT 'unknown')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $keepalive$
DECLARE
  v_now timestamptz := now();
BEGIN
  INSERT INTO public.system_heartbeat (id, last_ping, source, ping_count)
  VALUES (1, v_now, left(coalesce(p_source, 'unknown'), 40), 1)
  ON CONFLICT (id) DO UPDATE
    SET last_ping  = EXCLUDED.last_ping,
        source     = EXCLUDED.source,
        ping_count = public.system_heartbeat.ping_count + 1;
  RETURN jsonb_build_object('ok', true, 'at', v_now);
END;
$keepalive$;

COMMENT ON FUNCTION public.keep_alive(text) IS
  'Heartbeat chamado por GitHub Actions / Vercel Cron para evitar a pausa automática do projeto Supabase Free. Não expõe dados.';

-- ── R2. Funções: anon (chave pública do bundle) não executa NADA além do
--        keep_alive. Antes, funções SECURITY DEFINER sem checagem de auth
--        (calcular_oee, resumo_mensal_producao, get_lotes_intermediario,
--        peek/get_next_nf_number, sync_stock_items_from_devices...) podiam
--        ser chamadas por qualquer pessoa com a URL + anon key — vazando
--        dados de produção/estoque e permitindo "queimar" números de NF-e.
DO $revoke_anon$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
    WHERE n.nspname = 'public'
      AND d.objid IS NULL                 -- ignora funções de extensões
      AND p.proname <> 'keep_alive'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END;
$revoke_anon$;

GRANT EXECUTE ON FUNCTION public.keep_alive(text) TO anon, authenticated, service_role;

-- Funções criadas no futuro também não ficam expostas ao anon por padrão.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

-- ── R3. Numeração de NF-e: só usuário aprovado e não bloqueado reserva número
CREATE OR REPLACE FUNCTION public.get_next_nf_number(p_serie text DEFAULT '1', p_tipo text DEFAULT 'nfe')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_nfnum$
DECLARE v_num bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.nfe_sequencia (serie, tipo, ultimo_num) VALUES (p_serie, p_tipo, 1)
  ON CONFLICT (serie, tipo) DO UPDATE SET ultimo_num = nfe_sequencia.ultimo_num + 1, updated_at = now()
  RETURNING ultimo_num INTO v_num;
  RETURN v_num;
END;
$f_nfnum$;
REVOKE EXECUTE ON FUNCTION public.get_next_nf_number(text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_next_nf_number(text, text) TO authenticated;

-- ── R4. Buckets públicos: impede LISTAGEM anônima dos arquivos ───────────────
-- Em bucket público o download por URL pública NÃO depende de policy de
-- SELECT; a policy só servia para permitir listar/enumerar todos os arquivos
-- sem login. Agora listar exige usuário autenticado; as URLs públicas
-- (imagens dos componentes, assets de e-mail) continuam funcionando.
DROP POLICY IF EXISTS "devices_img_public_read" ON storage.objects;
CREATE POLICY "devices_img_public_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'devices-images');

DROP POLICY IF EXISTS "email_assets_public_read" ON storage.objects;
CREATE POLICY "email_assets_public_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'email-assets');

-- ── R5. Excluir usuário não falha mais por FK ────────────────────────────────
-- Várias colunas (created_by, vendedora_id, faturado_por...) referenciavam
-- auth.users SEM "ON DELETE": admin_delete_user() dava erro de foreign key
-- para qualquer usuário que já tivesse criado um pedido/lançamento. Agora a
-- referência vira NULL (o histórico é preservado; o nome continua nos campos
-- *_nome / audit_log).
DO $fk_auth$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.confrelid = 'auth.users'::regclass
      AND c.confdeltype = 'a'              -- NO ACTION
      AND array_length(c.conkey, 1) = 1
      AND c.connamespace = 'public'::regnamespace
      AND NOT a.attnotnull
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE SET NULL',
      r.tbl, r.conname, r.col);
  END LOOP;
END;
$fk_auth$;

-- ── R6. Limpeza de dados órfãos/inúteis ──────────────────────────────────────
-- Registros de rate limit antigos (só servem para a janela de alguns minutos).
DO $cleanup$
BEGIN
  IF to_regclass('public.rate_limit_log') IS NOT NULL THEN
    DELETE FROM public.rate_limit_log WHERE created_at < now() - interval '1 day';
  END IF;
EXCEPTION WHEN undefined_column THEN NULL;
END;
$cleanup$;

-- Perfis/roles sem usuário correspondente (sobra de exclusões antigas).
DELETE FROM public.user_roles ur WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = ur.user_id);
DELETE FROM public.profiles   p  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id);

-- Remove overloads antigos que o frontend não usa mais (se ainda existirem).
DROP FUNCTION IF EXISTS public.reserve_stock(uuid, jsonb);
DROP FUNCTION IF EXISTS public.get_lotes_intermediario(uuid);
DROP FUNCTION IF EXISTS public.admin_clear_history();
