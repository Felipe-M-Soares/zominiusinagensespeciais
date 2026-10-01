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

-- ── R2. Privilégios de execução: somente usuários autenticados executam
--        funções do schema public (exceto keep_alive). ─────────────────────
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

-- ── R3. Numeração de NF-e: exige usuário aprovado
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

-- ── R4. Buckets públicos: listagem somente para usuários autenticados ───────
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

-- ── R7. Diário da Produção: lançamento por DIA (sem turno) ──────────────────
-- O Diário passou a lançar o dia todo de uma vez (até 24h por máquina).
-- Acrescenta 'Dia inteiro' aos valores aceitos em apontamentos_producao.turno.
DO $turno_dia$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.apontamentos_producao'::regclass
      AND c.contype = 'c' AND a.attname = 'turno'
  LOOP
    EXECUTE format('ALTER TABLE public.apontamentos_producao DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE public.apontamentos_producao
    ADD CONSTRAINT apontamentos_producao_turno_check
    CHECK (turno IN ('1º Turno','2º Turno','3º Turno','Dia inteiro'));
END;
$turno_dia$;

-- ── R8. Correção de lançamentos (editar / excluir) ──────────────────────────
-- Permite corrigir um apontamento já salvo: peça, quantidade, horas,
-- operador, paradas e refugos — tudo numa transação, recalculando o
-- planejado e o tempo de ciclo. Também corrige turno, barra (matéria-prima)
-- e nº de barras gastas (× 3 m) — o estoque da barra é ajustado pelos
-- triggers de 20260030. Quem pode: admin, produção,
-- gerente ou quem lançou. O DROP remove a versão antiga de 10 parâmetros, para
-- não haver duas ("could not choose the best candidate function").
DROP FUNCTION IF EXISTS public.editar_apontamento_producao(uuid,text,text,text,numeric,numeric,integer,text,jsonb,jsonb);

CREATE OR REPLACE FUNCTION public.editar_apontamento_producao(
  p_id                 uuid,
  p_maquina            text,
  p_produto            text,
  p_descricao_produto  text,
  p_qtde_por_hora      numeric,
  p_horas_planejadas   numeric,
  p_qtde_produzida     integer,
  p_operador           text,
  p_paradas            jsonb DEFAULT '[]',
  p_refugos            jsonb DEFAULT '[]',
  p_materia_prima_id   uuid    DEFAULT NULL,
  p_barras             numeric DEFAULT NULL,
  p_turno              text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f_edit_ap$
DECLARE
  v_uid      uuid := auth.uid();
  v_ap       public.apontamentos_producao%ROWTYPE;
  v_hr_par   numeric;
  v_hr_prod  numeric;
  v_plan     numeric;
  v_mp_id    uuid;
  v_mp_desc  text;
  v_comp_m   numeric;
  v_nome     text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;
  SELECT * INTO v_ap FROM public.apontamentos_producao WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Lançamento não encontrado'); END IF;
  IF NOT (public.get_my_role() IN ('admin','producao','gerente') OR v_ap.user_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão para editar este lançamento');
  END IF;
  IF p_horas_planejadas IS NULL OR p_horas_planejadas <= 0 OR p_horas_planejadas > 24 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Horas devem estar entre 0 e 24');
  END IF;
  IF p_qtde_produzida IS NULL OR p_qtde_produzida < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Quantidade inválida');
  END IF;
  IF p_turno IS NOT NULL AND p_turno NOT IN ('1º Turno','2º Turno','3º Turno','Dia inteiro') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Turno inválido');
  END IF;
  IF p_barras IS NOT NULL AND (p_barras < 0 OR p_barras > 10000) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Quantidade de barras inválida');
  END IF;

  SELECT COALESCE(SUM((p->>'duracao_horas')::numeric), 0) INTO v_hr_par
  FROM jsonb_array_elements(COALESCE(p_paradas, '[]'::jsonb)) p;
  IF v_hr_par > p_horas_planejadas THEN
    RETURN jsonb_build_object('ok', false, 'error', 'As paradas passam das horas do lançamento');
  END IF;
  v_hr_prod := GREATEST(0, p_horas_planejadas - v_hr_par);
  v_plan := CASE WHEN COALESCE(p_qtde_por_hora, 0) > 0 AND v_hr_prod > 0
                 THEN round(p_qtde_por_hora * v_hr_prod, 2) ELSE p_qtde_produzida END;

  -- Barra: a informada; senão mantém a do lançamento.
  v_mp_id := COALESCE(p_materia_prima_id, v_ap.materia_prima_id);
  v_mp_desc := v_ap.descricao_mp;
  IF p_materia_prima_id IS NOT NULL THEN
    SELECT descricao INTO v_mp_desc FROM public.materias_primas_producao WHERE id = p_materia_prima_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Matéria-prima não encontrada'); END IF;
  END IF;
  SELECT comprimento_barra_m INTO v_comp_m FROM public.materias_primas_producao WHERE id = v_mp_id;

  UPDATE public.apontamentos_producao SET
    maquina = p_maquina, maquina_codigo = p_maquina, equipamento = p_maquina,
    turno = COALESCE(p_turno, turno),
    produto = p_produto, descricao_produto = p_descricao_produto,
    qtde_por_hora = COALESCE(p_qtde_por_hora, 0),
    horas_planejadas = p_horas_planejadas, lead_time_horas = p_horas_planejadas,
    qtde_plan_disp = v_plan, quantidade = p_qtde_produzida,
    cycle_time_min = CASE WHEN p_qtde_produzida > 0 AND v_hr_prod > 0
                          THEN round(v_hr_prod * 60 / p_qtde_produzida, 4) ELSE NULL END,
    operador = left(trim(p_operador), 120),
    materia_prima_id = v_mp_id,
    descricao_mp = v_mp_desc,
    -- Barras gastas × comprimento da barra (3 m). Sem p_barras, mantém o consumo.
    consumo_mp_metros = CASE WHEN p_barras IS NOT NULL
                             THEN round(p_barras * COALESCE(v_comp_m, 3), 3)
                             ELSE consumo_mp_metros END
  WHERE id = p_id;

  DELETE FROM public.apontamento_paradas WHERE apontamento_id = p_id;
  INSERT INTO public.apontamento_paradas (apontamento_id, tipo_parada_id, tipo_parada_nome, duracao_horas)
  SELECT p_id, (p->>'tipo_id')::integer, p->>'tipo_nome', (p->>'duracao_horas')::numeric
  FROM jsonb_array_elements(COALESCE(p_paradas, '[]'::jsonb)) p
  WHERE (p->>'duracao_horas')::numeric > 0;

  DELETE FROM public.apontamento_refugos WHERE apontamento_id = p_id;
  INSERT INTO public.apontamento_refugos (apontamento_id, tipo_refugo_id, tipo_refugo_nome, quantidade)
  SELECT p_id, (r->>'tipo_id')::integer, r->>'tipo_nome', (r->>'quantidade')::integer
  FROM jsonb_array_elements(COALESCE(p_refugos, '[]'::jsonb)) r
  WHERE (r->>'quantidade')::integer > 0;

  SELECT display_name INTO v_nome FROM public.profiles WHERE user_id = v_uid;
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (v_uid, COALESCE(v_nome, 'Desconhecido'), 'editar_apontamento', 'apontamento_producao', p_id,
    jsonb_build_object('produto', p_produto, 'quantidade', p_qtde_produzida, 'horas', p_horas_planejadas,
                       'materia_prima_id', v_mp_id, 'barras', p_barras));

  RETURN jsonb_build_object('ok', true);
END;
$f_edit_ap$;

CREATE OR REPLACE FUNCTION public.excluir_lancamento_producao(p_tipo text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f_del_ap$
DECLARE
  v_uid  uuid := auth.uid();
  v_dono uuid;
  v_nome text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;
  IF p_tipo = 'apontamento' THEN
    SELECT user_id INTO v_dono FROM public.apontamentos_producao WHERE id = p_id;
  ELSIF p_tipo = 'parada' THEN
    SELECT user_id INTO v_dono FROM public.paradas_producao WHERE id = p_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'Tipo inválido');
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Lançamento não encontrado'); END IF;
  IF NOT (public.get_my_role() IN ('admin','producao') OR v_dono = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão para excluir este lançamento');
  END IF;

  IF p_tipo = 'apontamento' THEN
    DELETE FROM public.apontamentos_producao WHERE id = p_id;   -- paradas/refugos vinculados: ON DELETE CASCADE
  ELSE
    DELETE FROM public.paradas_producao WHERE id = p_id;
  END IF;

  SELECT display_name INTO v_nome FROM public.profiles WHERE user_id = v_uid;
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (v_uid, COALESCE(v_nome, 'Desconhecido'), 'excluir_lancamento_producao', p_tipo, p_id, '{}'::jsonb);

  RETURN jsonb_build_object('ok', true);
END;
$f_del_ap$;

REVOKE EXECUTE ON FUNCTION public.editar_apontamento_producao(uuid,text,text,text,numeric,numeric,integer,text,jsonb,jsonb,uuid,numeric,text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.excluir_lancamento_producao(text, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.editar_apontamento_producao(uuid,text,text,text,numeric,numeric,integer,text,jsonb,jsonb,uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.excluir_lancamento_producao(text, uuid) TO authenticated;

-- ── R9. Tempo de peça aprendido automaticamente ─────────────────────────────
-- Todo apontamento com quantidade > 0 alimenta o "tempo padrão" da peça:
--   tempo produtivo = horas do lançamento − paradas do lançamento
--   ciclo (min/pç)  = tempo produtivo × 60 ÷ peças
-- O sistema guarda, por peça e por peça+máquina, a mediana dos últimos 30
-- lançamentos (resistente a lançamentos fora da curva), o melhor ciclo e as
-- peças/hora resultantes. O operador não precisa saber nem digitar nada: o
-- Diário usa esse padrão para calcular o "esperado" e a performance quando a
-- peça não tem peças/hora cadastrado, e a análise compara mês a mês.
CREATE TABLE IF NOT EXISTS public.tempo_peca_padrao (
  produto            text        NOT NULL,
  maquina            text        NOT NULL DEFAULT '*',   -- '*' = todas as máquinas
  amostras           integer     NOT NULL DEFAULT 0,
  pecas              bigint      NOT NULL DEFAULT 0,
  horas_produtivas   numeric(12,4) NOT NULL DEFAULT 0,
  ciclo_medio_min    numeric(12,4),
  ciclo_mediana_min  numeric(12,4),
  melhor_ciclo_min   numeric(12,4),
  pecas_hora         numeric(12,2),
  ultimo_lancamento  date,
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (produto, maquina)
);
ALTER TABLE public.tempo_peca_padrao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tempo_peca_select" ON public.tempo_peca_padrao;
CREATE POLICY "tempo_peca_select" ON public.tempo_peca_padrao
  FOR SELECT TO authenticated USING ((select auth.uid()) IS NOT NULL);
GRANT SELECT ON public.tempo_peca_padrao TO authenticated;

CREATE OR REPLACE FUNCTION public.recalcular_tempo_peca(p_produto text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f_tempo$
BEGIN
  IF p_produto IS NULL THEN RETURN; END IF;
  -- Serializa o recálculo por peça: dois lançamentos simultâneos da mesma
  -- peça não podem apagar/inserir a mesma linha ao mesmo tempo (dava erro de
  -- chave duplicada e derrubava o lançamento). O lock é liberado no commit.
  PERFORM pg_advisory_xact_lock(hashtext('tempo_peca:' || p_produto));
  DELETE FROM public.tempo_peca_padrao WHERE produto = p_produto;

  -- Só os últimos lançamentos (via índice) — o custo não cresce com o histórico.
  WITH ult_geral AS (
    SELECT a.id, a.maquina_codigo, a.data_apontamento, a.quantidade, a.horas_planejadas
    FROM public.apontamentos_producao a
    WHERE a.produto = p_produto AND a.quantidade > 0 AND a.horas_planejadas > 0
    ORDER BY a.data_apontamento DESC, a.created_at DESC
    LIMIT 30
  ), maqs AS (
    SELECT DISTINCT a.maquina_codigo FROM public.apontamentos_producao a
    WHERE a.produto = p_produto AND a.maquina_codigo IS NOT NULL
      AND a.data_apontamento >= CURRENT_DATE - 365
  ), ult_maq AS (
    SELECT u.* FROM maqs m CROSS JOIN LATERAL (
      SELECT a.id, a.maquina_codigo, a.data_apontamento, a.quantidade, a.horas_planejadas
      FROM public.apontamentos_producao a
      WHERE a.produto = p_produto AND a.maquina_codigo = m.maquina_codigo
        AND a.quantidade > 0 AND a.horas_planejadas > 0
      ORDER BY a.data_apontamento DESC, a.created_at DESC
      LIMIT 30
    ) u
  ), todos AS (
    SELECT '*'::text AS grupo, * FROM ult_geral
    UNION ALL
    SELECT maquina_codigo AS grupo, * FROM ult_maq
  ), grupos AS (
    SELECT t.grupo AS maquina, t.quantidade, t.data_apontamento,
           GREATEST(0, t.horas_planejadas - COALESCE((
             SELECT SUM(ap.duracao_horas) FROM public.apontamento_paradas ap WHERE ap.apontamento_id = t.id), 0)) AS h_prod
    FROM todos t
  ), validos AS (
    SELECT g.*, g.h_prod * 60.0 / g.quantidade AS ciclo FROM grupos g WHERE g.h_prod > 0
  )
  INSERT INTO public.tempo_peca_padrao
    (produto, maquina, amostras, pecas, horas_produtivas, ciclo_medio_min, ciclo_mediana_min,
     melhor_ciclo_min, pecas_hora, ultimo_lancamento, atualizado_em)
  SELECT p_produto, g.maquina, COUNT(*), SUM(g.quantidade), SUM(g.h_prod),
         round(SUM(g.h_prod) * 60.0 / NULLIF(SUM(g.quantidade), 0), 4),
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY g.ciclo))::numeric, 4),
         round(MIN(g.ciclo)::numeric, 4),
         round(60.0 / NULLIF((percentile_cont(0.5) WITHIN GROUP (ORDER BY g.ciclo))::numeric, 0), 2),
         MAX(g.data_apontamento), now()
  FROM validos g
  GROUP BY g.maquina;
END;
$f_tempo$;
REVOKE EXECUTE ON FUNCTION public.recalcular_tempo_peca(text) FROM anon, PUBLIC, authenticated;

-- Índice para o recálculo e para as análises por peça (antes não havia
-- índice por produto — cada recálculo varria a tabela inteira).
CREATE INDEX IF NOT EXISTS idx_ap_produto_data ON public.apontamentos_producao (produto, data_apontamento DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ap_produto_maq_data ON public.apontamentos_producao (produto, maquina_codigo, data_apontamento DESC, created_at DESC);

-- Dispara no COMMIT (constraint trigger adiada): nesse momento as paradas do
-- lançamento já foram gravadas, então o tempo produtivo sai correto.
CREATE OR REPLACE FUNCTION public.trg_tempo_peca()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f_trg_tempo$
DECLARE v_prod text;
BEGIN
  -- A estatística de tempo nunca pode impedir o lançamento de ser salvo:
  -- se o recálculo falhar por qualquer motivo, o lançamento segue e o tempo
  -- é recalculado no próximo lançamento da peça.
  BEGIN
    -- Trava as peças envolvidas SEMPRE na mesma ordem (alfabética) antes de
    -- recalcular — correção que troca a peça A→B concorrendo com outra B→A
    -- causava deadlock (encontrado no teste de carga com 50 usuários).
    FOR v_prod IN
      SELECT DISTINCT x FROM unnest(ARRAY[
        CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN OLD.produto END,
        CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN NEW.produto END]) AS x
      WHERE x IS NOT NULL ORDER BY x
    LOOP
      PERFORM pg_advisory_xact_lock(hashtext('tempo_peca:' || v_prod));
    END LOOP;
    FOR v_prod IN
      SELECT DISTINCT x FROM unnest(ARRAY[
        CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN OLD.produto END,
        CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN NEW.produto END]) AS x
      WHERE x IS NOT NULL ORDER BY x
    LOOP
      PERFORM public.recalcular_tempo_peca(v_prod);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tempo_peca: recálculo ignorado (%)', SQLERRM;
  END;
  RETURN NULL;
END;
$f_trg_tempo$;

DROP TRIGGER IF EXISTS trg_tempo_peca ON public.apontamentos_producao;
CREATE CONSTRAINT TRIGGER trg_tempo_peca
  AFTER INSERT OR UPDATE OR DELETE ON public.apontamentos_producao
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.trg_tempo_peca();

-- Tempo de peça mês a mês (para "rodou essa peça mais rápido que no mês
-- passado?"). security_invoker: respeita o RLS de quem consulta.
DROP VIEW IF EXISTS public.tempo_peca_mensal;
CREATE VIEW public.tempo_peca_mensal WITH (security_invoker = true) AS
WITH par AS (
  SELECT apontamento_id, SUM(duracao_horas) AS h FROM public.apontamento_paradas GROUP BY apontamento_id
), base AS (
  SELECT a.produto, MAX(a.descricao_produto) AS descricao_produto, a.maquina_codigo,
         date_trunc('month', a.data_apontamento)::date AS mes,
         COUNT(*) AS amostras, SUM(a.quantidade) AS pecas,
         SUM(GREATEST(0, a.horas_planejadas - COALESCE(par.h, 0))) AS horas_produtivas
  FROM public.apontamentos_producao a
  LEFT JOIN par ON par.apontamento_id = a.id
  WHERE a.quantidade > 0 AND a.horas_planejadas > 0
  GROUP BY a.produto, a.maquina_codigo, date_trunc('month', a.data_apontamento)
)
SELECT produto, descricao_produto, maquina_codigo, mes, amostras, pecas, horas_produtivas,
       round(horas_produtivas * 60.0 / NULLIF(pecas, 0), 4)       AS ciclo_min,
       round(pecas / NULLIF(horas_produtivas, 0), 2)              AS pecas_hora
FROM base
WHERE horas_produtivas > 0;
GRANT SELECT ON public.tempo_peca_mensal TO authenticated;

-- Carga inicial com o histórico que já existe.
DO $backfill_tempo$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT produto FROM public.apontamentos_producao WHERE quantidade > 0 LOOP
    PERFORM public.recalcular_tempo_peca(r.produto);
  END LOOP;
END;
$backfill_tempo$;

-- ── R10. Meta semestral padrão de 85% (OEE) ──────────────────────────────────
-- A meta do semestre é comparada com o OEE (disponibilidade × performance ×
-- qualidade), ou seja, as paradas entram no cálculo. Garante 85% para o
-- semestre atual se ainda não houver meta definida.
INSERT INTO public.metas_producao (mes, ano, maquina_codigo, meta_pecas, meta_oee_pct)
VALUES (CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) <= 6 THEN 1 ELSE 7 END,
        EXTRACT(YEAR FROM CURRENT_DATE)::int, 'SEMESTRE', 0, 85)
ON CONFLICT (mes, ano, maquina_codigo) DO NOTHING;

-- ── R11. Lote de produção único (sequência diária) ──────────────────────────
-- Encontrado no teste de carga: o número de lote se repetia a partir do 100º
-- apontamento (sequência global cortada em 2 dígitos). Mesma função, com a
-- numeração corrigida para "sequência do dia" — formato DDMMAAT-NN mantido.
-- Contador por dia (custo constante e seguro com lançamentos simultâneos:
-- a linha do dia fica travada só durante o próprio lançamento).
CREATE TABLE IF NOT EXISTS public.lote_sequencia_diaria (
  data   date PRIMARY KEY,
  ultimo integer NOT NULL DEFAULT 0
);
ALTER TABLE public.lote_sequencia_diaria ENABLE ROW LEVEL SECURITY;  -- só a função mexe
-- Parte do maior número já usado em cada dia (lotes existentes).
INSERT INTO public.lote_sequencia_diaria (data, ultimo)
SELECT a.data_apontamento, MAX(NULLIF(substring(a.lote FROM '^\d{7}-(\d+)'), '')::int)
FROM public.apontamentos_producao a
WHERE a.lote ~ '^\d{7}-\d+'
GROUP BY a.data_apontamento
ON CONFLICT (data) DO UPDATE SET ultimo = GREATEST(public.lote_sequencia_diaria.ultimo, EXCLUDED.ultimo);

-- Bancos antigos podem ter a função com tipos de parâmetro diferentes (ex.:
-- p_data text). O CREATE OR REPLACE abaixo criaria uma SEGUNDA versão com os
-- mesmos nomes de parâmetro — e o app deixaria de conseguir salvar
-- ("could not choose the best candidate function"). Remove as versões com
-- assinatura diferente antes de recriar; os nomes dos parâmetros são os mesmos,
-- então as telas Diário, Controle e Importador continuam compatíveis.
DO $limpa_overloads$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'criar_apontamento_ppi51'
      AND p.oid::regprocedure::text <> 'criar_apontamento_ppi51(date,text,text,text,text,text,numeric,numeric,numeric,integer,numeric,numeric,numeric,numeric,text,text,text,numeric,numeric,text,jsonb,jsonb)'
  LOOP
    RAISE NOTICE 'Removendo versão antiga: %', r.sig;
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END;
$limpa_overloads$;

CREATE OR REPLACE FUNCTION public.criar_apontamento_ppi51(
  p_data               date,
  p_turno              text,
  p_maquina            text,
  p_equipamento        text,
  p_produto            text,
  p_descricao_produto  text,
  p_qtde_por_hora      numeric,
  p_horas_planejadas   numeric,
  p_qtde_plan_disp     numeric,
  p_qtde_produzida     integer,
  p_horario_inicio     numeric,
  p_horario_fim        numeric,
  p_cycle_time_min     numeric,
  p_lead_time_horas    numeric,
  p_lote               text,
  p_lote_mp            text,
  p_descricao_mp       text,
  p_comprimento_mm     numeric,
  p_consumo_mp_metros  numeric,
  p_operador           text,
  p_paradas            jsonb DEFAULT '[]',
  p_refugos            jsonb DEFAULT '[]'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f01$
DECLARE
  v_seq  integer;
  v_id   uuid;
  v_lote text;
  v_seq_dia integer;
BEGIN
  IF (select auth.uid()) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado');
  END IF;

  v_seq  := nextval('public.seq_apontamento_producao');
  v_id   := gen_random_uuid();
  v_lote := NULLIF(trim(p_lote), '');
  IF v_lote IS NULL THEN
    -- Lote = DDMMAA + turno (1, 2, 3; 0 = dia inteiro) + '-' + sequência DO DIA.
    -- Antes usava a sequência global truncada em 2 dígitos (lpad corta!):
    -- a partir do 100º apontamento os lotes se repetiam. A trava por data
    -- garante números únicos mesmo com lançamentos simultâneos.
    INSERT INTO public.lote_sequencia_diaria AS l (data, ultimo) VALUES (p_data, 1)
    ON CONFLICT (data) DO UPDATE SET ultimo = l.ultimo + 1
    RETURNING l.ultimo INTO v_seq_dia;
    v_lote := to_char(p_data, 'DDMMYY') ||
      CASE WHEN p_turno LIKE '1%' THEN '1'
           WHEN p_turno LIKE '2%' THEN '2'
           WHEN p_turno LIKE '3%' THEN '3'
           ELSE '0' END || '-' || lpad(v_seq_dia::text, GREATEST(2, length(v_seq_dia::text)), '0');
  END IF;

  INSERT INTO public.apontamentos_producao (
    id, seq_producao, data_apontamento, turno,
    maquina, maquina_codigo, equipamento, grupo,
    produto, descricao_produto, unidade_medida,
    qtde_por_hora, horas_planejadas, qtde_plan_disp,
    quantidade, horario_inicio, horario_fim,
    cycle_time_min, lead_time_horas,
    lote, lote_mp, descricao_mp, comprimento_mm, consumo_mp_metros,
    operador, status, inicio, user_id
  ) VALUES (
    v_id, v_seq, p_data, p_turno,
    p_maquina, p_maquina, p_equipamento, 'TORNO CNC',
    p_produto, p_descricao_produto, 'PC',
    p_qtde_por_hora, p_horas_planejadas, p_qtde_plan_disp,
    p_qtde_produzida, p_horario_inicio, p_horario_fim,
    p_cycle_time_min, p_lead_time_horas,
    v_lote, p_lote_mp, p_descricao_mp, p_comprimento_mm, p_consumo_mp_metros,
    p_operador, 'concluido', p_horario_inicio::text, (select auth.uid())
  );

  INSERT INTO public.apontamento_paradas (apontamento_id, tipo_parada_id, tipo_parada_nome, duracao_horas)
  SELECT v_id, (p->>'tipo_id')::integer, p->>'tipo_nome', (p->>'duracao_horas')::numeric
  FROM jsonb_array_elements(p_paradas) p
  WHERE (p->>'duracao_horas')::numeric > 0;

  INSERT INTO public.apontamento_refugos (apontamento_id, tipo_refugo_id, tipo_refugo_nome, quantidade)
  SELECT v_id, (r->>'tipo_id')::integer, r->>'tipo_nome', (r->>'quantidade')::integer
  FROM jsonb_array_elements(p_refugos) r
  WHERE (r->>'quantidade')::integer > 0;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'seq', v_seq, 'lote', v_lote);
END;
$f01$;

REVOKE EXECUTE ON FUNCTION public.criar_apontamento_ppi51(date, text, text, text, text, text, numeric, numeric, numeric, integer, numeric, numeric, numeric, numeric, text, text, text, numeric, numeric, text, jsonb, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.criar_apontamento_ppi51(date, text, text, text, text, text, numeric, numeric, numeric, integer, numeric, numeric, numeric, numeric, text, text, text, numeric, numeric, text, jsonb, jsonb) TO authenticated;

-- ── R12. Planejamento por data e HORA (sem turno) ───────────────────────────
-- A ordem de produção pode atravessar os dois turnos: agora guarda início e
-- fim previstos com hora, e início/fim reais (para medir cumprimento de prazo).
-- As colunas antigas data_inicio/data_fim continuam preenchidas (compatibilidade).
ALTER TABLE public.ordens_planejamento
  ADD COLUMN IF NOT EXISTS inicio_previsto    timestamptz,
  ADD COLUMN IF NOT EXISTS fim_previsto       timestamptz,
  ADD COLUMN IF NOT EXISTS inicio_real        timestamptz,
  ADD COLUMN IF NOT EXISTS fim_real           timestamptz,
  ADD COLUMN IF NOT EXISTS descricao_produto  text,
  ADD COLUMN IF NOT EXISTS observacoes        text;
ALTER TABLE public.ordens_planejamento ALTER COLUMN turno SET DEFAULT 'Dia inteiro';

-- Ordens antigas: início às 06:00 do dia inicial, fim às 23:59 do dia final;
-- o produto era salvo como "CÓDIGO descrição" — separa o código.
UPDATE public.ordens_planejamento SET
  inicio_previsto = COALESCE(inicio_previsto, (data_inicio + time '06:00') AT TIME ZONE 'America/Sao_Paulo'),
  fim_previsto    = COALESCE(fim_previsto,    (data_fim    + time '23:59') AT TIME ZONE 'America/Sao_Paulo'),
  descricao_produto = COALESCE(descricao_produto, NULLIF(trim(substring(produto FROM position(' ' IN produto))), '')),
  produto = split_part(produto, ' ', 1)
WHERE inicio_previsto IS NULL OR fim_previsto IS NULL OR position(' ' IN produto) > 0;

CREATE INDEX IF NOT EXISTS idx_ordens_maquina_inicio ON public.ordens_planejamento (maquina, inicio_previsto);

-- Progresso de cada ordem: peças apontadas para a mesma peça e máquina
-- dentro do período da ordem (do início até o fim real, ou até hoje/fim previsto).
DROP VIEW IF EXISTS public.ordens_planejamento_progresso;
CREATE VIEW public.ordens_planejamento_progresso WITH (security_invoker = true) AS
SELECT o.id,
       COALESCE(SUM(a.quantidade), 0)::bigint           AS quantidade_produzida,
       COALESCE(SUM(a.horas_planejadas), 0)             AS horas_apontadas,
       MIN(a.data_apontamento)                          AS primeiro_apontamento,
       MAX(a.data_apontamento)                          AS ultimo_apontamento
FROM public.ordens_planejamento o
LEFT JOIN public.apontamentos_producao a
  ON a.produto = o.produto
 AND a.maquina_codigo = o.maquina
 AND a.data_apontamento >= (COALESCE(o.inicio_real, o.inicio_previsto) AT TIME ZONE 'America/Sao_Paulo')::date
 AND a.data_apontamento <= (COALESCE(o.fim_real, GREATEST(o.fim_previsto, now())) AT TIME ZONE 'America/Sao_Paulo')::date
GROUP BY o.id;
GRANT SELECT ON public.ordens_planejamento_progresso TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- R13. FISCAL / FINANCEIRO (set/2026)
-- ═════════════════════════════════════════════════════════════════════════════
-- • fiscal_config: dados do emitente + emissor (desativado até o token ser
--   cadastrado). O token fica no Vault, nunca em tabela.
-- • notas_fiscais: registro único e IMUTÁVEL de toda NF-e (venda, devolução,
--   troca), emitida pelo emissor integrado ou registrada de outro sistema.
--   Nota autorizada não pode ser editada nem apagada (guarda de 5 anos).
-- • Venda faturada gera conta a receber (parcelada) — antes nunca gerava.
-- • Limpezas de histórico não apagam mais pedidos/devoluções com NF.
-- • contas_financeiras deixou de ser visível para todos os perfis.

-- Colunas que existem no banco em produção mas faltavam nas migrations
-- (instalação nova quebrava o pedido/faturamento).
ALTER TABLE public.pedidos_comerciais
  ADD COLUMN IF NOT EXISTS forma_pagamento       text,
  ADD COLUMN IF NOT EXISTS parcelas              integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS endereco_entrega      text,
  ADD COLUMN IF NOT EXISTS usar_endereco_cliente boolean DEFAULT true;
ALTER TABLE public.pedido_itens
  ADD COLUMN IF NOT EXISTS preco_unitario numeric(12,4),
  ADD COLUMN IF NOT EXISTS valor_total    numeric(14,2);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS theme text;

-- ── Configuração fiscal (linha única) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fiscal_config (
  id                smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  razao_social      text,
  nome_fantasia     text,
  cnpj              text CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$'),
  ie                text,
  im                text,
  crt               smallint CHECK (crt IS NULL OR crt IN (1,2,3,4)),
  logradouro        text,
  numero            text,
  complemento       text,
  bairro            text,
  municipio         text,
  c_mun             text CHECK (c_mun IS NULL OR c_mun ~ '^[0-9]{7}$'),
  uf                text NOT NULL DEFAULT 'SP' CHECK (uf ~ '^[A-Z]{2}$'),
  cep               text CHECK (cep IS NULL OR cep ~ '^[0-9]{8}$'),
  telefone          text,
  email             text,
  provedor          text NOT NULL DEFAULT 'nenhum' CHECK (provedor IN ('nenhum','focusnfe')),
  ambiente          smallint NOT NULL DEFAULT 2 CHECK (ambiente IN (1,2)),
  serie_nfe         text NOT NULL DEFAULT '1' CHECK (serie_nfe ~ '^[0-9]{1,3}$'),
  natureza_padrao   text NOT NULL DEFAULT 'Venda de produção do estabelecimento',
  cfop_dentro_uf    text NOT NULL DEFAULT '5101' CHECK (cfop_dentro_uf ~ '^5[0-9]{3}$'),
  cfop_fora_uf      text NOT NULL DEFAULT '6101' CHECK (cfop_fora_uf ~ '^6[0-9]{3}$'),
  prazo_padrao_dias integer NOT NULL DEFAULT 30 CHECK (prazo_padrao_dias BETWEEN 0 AND 365),
  aliquota_icms_interna numeric(5,2) NOT NULL DEFAULT 18 CHECK (aliquota_icms_interna BETWEEN 0 AND 40),
  pis_aliquota      numeric(5,2) NOT NULL DEFAULT 0.65 CHECK (pis_aliquota BETWEEN 0 AND 10),
  cofins_aliquota   numeric(5,2) NOT NULL DEFAULT 3.00 CHECK (cofins_aliquota BETWEEN 0 AND 20),
  info_complementar text,
  token_secret_id   uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.fiscal_config
  ADD COLUMN IF NOT EXISTS aliquota_icms_interna numeric(5,2) NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS pis_aliquota          numeric(5,2) NOT NULL DEFAULT 0.65,
  ADD COLUMN IF NOT EXISTS cofins_aliquota       numeric(5,2) NOT NULL DEFAULT 3.00;
INSERT INTO public.fiscal_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.fiscal_config ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS fiscal_config_updated_at ON public.fiscal_config;
CREATE TRIGGER fiscal_config_updated_at BEFORE UPDATE ON public.fiscal_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP POLICY IF EXISTS "fiscal_config_select" ON public.fiscal_config;
CREATE POLICY "fiscal_config_select" ON public.fiscal_config FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','financeiro'));
DROP POLICY IF EXISTS "fiscal_config_update" ON public.fiscal_config;
CREATE POLICY "fiscal_config_update" ON public.fiscal_config FOR UPDATE TO authenticated
  USING (public.get_my_role() IN ('admin','financeiro'))
  WITH CHECK (public.get_my_role() IN ('admin','financeiro'));
REVOKE ALL ON public.fiscal_config FROM anon;
GRANT SELECT, UPDATE ON public.fiscal_config TO authenticated;
-- A referência do token não é editável pelo cliente (só pelas funções abaixo).
REVOKE UPDATE (token_secret_id) ON public.fiscal_config FROM authenticated;

-- Token do emissor → Vault (só admin grava; ninguém lê pelo app)
CREATE OR REPLACE FUNCTION public.set_fiscal_token(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_ftok$
DECLARE v_old uuid; v_new uuid;
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Somente o administrador pode ativar o emissor.');
  END IF;
  SELECT token_secret_id INTO v_old FROM public.fiscal_config WHERE id = 1;
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    UPDATE public.fiscal_config SET token_secret_id = NULL, provedor = 'nenhum', updated_by = auth.uid() WHERE id = 1;
  ELSE
    SELECT vault.create_secret(btrim(p_token), 'fiscal_token_' || extract(epoch FROM clock_timestamp())::text,
                               'Token do emissor de NF-e') INTO v_new;
    UPDATE public.fiscal_config SET token_secret_id = v_new, provedor = 'focusnfe', updated_by = auth.uid() WHERE id = 1;
  END IF;
  IF v_old IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = v_old; END IF;
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, details)
  VALUES (auth.uid(), COALESCE((SELECT display_name FROM public.profiles WHERE user_id = auth.uid()), '—'),
          CASE WHEN p_token IS NULL OR btrim(p_token) = '' THEN 'fiscal_emissor_desativado' ELSE 'fiscal_emissor_ativado' END,
          'fiscal_config', '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Não foi possível guardar o token com segurança (Vault indisponível).');
END;
$f_ftok$;
REVOKE EXECUTE ON FUNCTION public.set_fiscal_token(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_fiscal_token(text) TO authenticated;

-- Leitura do token: SOMENTE a edge function (service_role)
CREATE OR REPLACE FUNCTION public.get_fiscal_token()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_gtok$
DECLARE v_id uuid; v_tok text;
BEGIN
  SELECT token_secret_id INTO v_id FROM public.fiscal_config WHERE id = 1;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO v_tok FROM vault.decrypted_secrets WHERE id = v_id;
  RETURN v_tok;
END;
$f_gtok$;
REVOKE EXECUTE ON FUNCTION public.get_fiscal_token() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_fiscal_token() TO service_role;

-- ── Validação da chave de acesso (44 dígitos + dígito verificador mód. 11) ──
CREATE OR REPLACE FUNCTION public.chave_nfe_valida(p_chave text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $f_chv$
DECLARE s integer := 0; p integer := 2; i integer; r integer; dv integer;
BEGIN
  IF p_chave IS NULL OR p_chave !~ '^[0-9]{44}$' THEN RETURN false; END IF;
  FOR i IN REVERSE 43..1 LOOP
    s := s + substr(p_chave, i, 1)::int * p;
    p := CASE WHEN p = 9 THEN 2 ELSE p + 1 END;
  END LOOP;
  r := s % 11;
  dv := CASE WHEN r < 2 THEN 0 ELSE 11 - r END;
  RETURN dv = substr(p_chave, 44, 1)::int;
END;
$f_chv$;

-- ── Notas fiscais ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notas_fiscais (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                text NOT NULL CHECK (tipo IN ('venda','devolucao','troca')),
  origem              text NOT NULL CHECK (origem IN ('emissor','externa')),
  pedido_id           uuid REFERENCES public.pedidos_comerciais(id) ON DELETE RESTRICT,
  devolucao_id        uuid REFERENCES public.notas_devolucao_troca(id) ON DELETE RESTRICT,
  ref                 text UNIQUE,
  modelo              text NOT NULL DEFAULT '55' CHECK (modelo IN ('55','65')),
  serie               text,
  numero              integer CHECK (numero IS NULL OR numero BETWEEN 1 AND 999999999),
  chave               text UNIQUE CHECK (chave IS NULL OR public.chave_nfe_valida(chave)),
  protocolo           text,
  status              text NOT NULL CHECK (status IN ('processando','autorizada','rejeitada','cancelada','denegada')),
  ambiente            smallint NOT NULL DEFAULT 1 CHECK (ambiente IN (1,2)),
  natureza            text,
  destinatario_nome   text,
  destinatario_doc    text,
  valor_total         numeric(14,2),
  emitida_em          timestamptz,
  cancelada_em        timestamptz,
  motivo_cancelamento text,
  mensagem            text,
  xml_path            text,
  danfe_path          text,
  danfe_url           text,
  eventos             jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notas_fiscais ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS idx_nf_numero_unico ON public.notas_fiscais (modelo, serie, numero, ambiente)
  WHERE numero IS NOT NULL AND status IN ('processando','autorizada','cancelada','denegada');
CREATE INDEX IF NOT EXISTS idx_nf_pedido    ON public.notas_fiscais (pedido_id);
CREATE INDEX IF NOT EXISTS idx_nf_devolucao ON public.notas_fiscais (devolucao_id);
CREATE INDEX IF NOT EXISTS idx_nf_emitida   ON public.notas_fiscais (emitida_em DESC NULLS FIRST);
DROP TRIGGER IF EXISTS notas_fiscais_updated_at ON public.notas_fiscais;
CREATE TRIGGER notas_fiscais_updated_at BEFORE UPDATE ON public.notas_fiscais
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "nf_select" ON public.notas_fiscais;
CREATE POLICY "nf_select" ON public.notas_fiscais FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','financeiro'));
-- Sem políticas de INSERT/UPDATE/DELETE: só as funções fiscais abaixo gravam.
REVOKE ALL ON public.notas_fiscais FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.notas_fiscais FROM authenticated;
GRANT SELECT ON public.notas_fiscais TO authenticated;

-- Imutabilidade: nota autorizada/cancelada/denegada só muda para "cancelada"
-- e só recebe eventos e arquivos; nunca é apagada.
CREATE OR REPLACE FUNCTION public.nf_protege_nota()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $f_nfp$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'rejeitada' THEN
      RAISE EXCEPTION 'Nota fiscal % não pode ser apagada (guarda obrigatória de 5 anos).', COALESCE(OLD.numero::text, OLD.id::text)
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('autorizada','cancelada','denegada') THEN
    IF NEW.tipo IS DISTINCT FROM OLD.tipo OR NEW.origem IS DISTINCT FROM OLD.origem
       OR NEW.pedido_id IS DISTINCT FROM OLD.pedido_id OR NEW.devolucao_id IS DISTINCT FROM OLD.devolucao_id
       OR NEW.modelo IS DISTINCT FROM OLD.modelo OR NEW.serie IS DISTINCT FROM OLD.serie
       OR NEW.numero IS DISTINCT FROM OLD.numero OR NEW.chave IS DISTINCT FROM OLD.chave
       OR NEW.ambiente IS DISTINCT FROM OLD.ambiente OR NEW.valor_total IS DISTINCT FROM OLD.valor_total
       OR NEW.emitida_em IS DISTINCT FROM OLD.emitida_em OR NEW.destinatario_doc IS DISTINCT FROM OLD.destinatario_doc
       OR (OLD.xml_path IS NOT NULL AND NEW.xml_path IS DISTINCT FROM OLD.xml_path)
       OR NOT (NEW.status = OLD.status OR (OLD.status = 'autorizada' AND NEW.status = 'cancelada')) THEN
      RAISE EXCEPTION 'Nota fiscal autorizada não pode ser alterada — use cancelamento ou carta de correção.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$f_nfp$;
DROP TRIGGER IF EXISTS trg_nf_protege ON public.notas_fiscais;
CREATE TRIGGER trg_nf_protege BEFORE UPDATE OR DELETE ON public.notas_fiscais
  FOR EACH ROW EXECUTE FUNCTION public.nf_protege_nota();

-- Pedido faturado: os campos fiscais só mudam pelas funções fiscais.
CREATE OR REPLACE FUNCTION public.pedido_protege_fiscal()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $f_pfp$
BEGIN
  IF current_setting('app.fiscal', true) = 'on' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.notas_fiscais n WHERE n.pedido_id = OLD.id AND n.status IN ('autorizada','processando'))
     AND (NEW.nota_fiscal IS DISTINCT FROM OLD.nota_fiscal OR NEW.chave_acesso_nfe IS DISTINCT FROM OLD.chave_acesso_nfe
          OR NEW.protocolo_sefaz IS DISTINCT FROM OLD.protocolo_sefaz OR NEW.xml_nfe IS DISTINCT FROM OLD.xml_nfe
          OR NEW.dh_autorizacao_nfe IS DISTINCT FROM OLD.dh_autorizacao_nfe
          OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id
          OR (NEW.status IN ('pendente','separando','pronto','cancelado') AND NEW.status IS DISTINCT FROM OLD.status)) THEN
    RAISE EXCEPTION 'Pedido com NF-e autorizada: dados fiscais não podem ser alterados (cancele a NF-e antes).'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$f_pfp$;
DROP TRIGGER IF EXISTS trg_pedido_protege_fiscal ON public.pedidos_comerciais;
CREATE TRIGGER trg_pedido_protege_fiscal BEFORE UPDATE ON public.pedidos_comerciais
  FOR EACH ROW EXECUTE FUNCTION public.pedido_protege_fiscal();

-- ── Conta a receber ao faturar (corrigido) ─────────────────────────────────
-- Antes só disparava em status 'faturado', mas o faturamento vai direto para
-- 'enviado' → nenhuma venda gerava conta a receber. Agora: dispara ao entrar
-- em faturado/enviado, divide em parcelas e não duplica.
CREATE OR REPLACE FUNCTION public.criar_conta_receber_nfe()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f02$
DECLARE
  v_bruto numeric; v_total numeric; v_cliente text; v_parc integer; v_prazo integer; i integer;
  v_valor numeric; v_acum numeric := 0; v_nf text;
BEGIN
  IF NEW.status IN ('faturado','enviado') AND OLD.status NOT IN ('faturado','enviado')
     AND NOT EXISTS (SELECT 1 FROM public.contas_financeiras c
                     WHERE c.pedido_id = NEW.id AND c.tipo = 'receber' AND c.status <> 'cancelado') THEN
    SELECT COALESCE(SUM(pi.quantidade * COALESCE(pi.valor_unitario, 0)), 0) INTO v_bruto
    FROM public.pedido_itens pi WHERE pi.pedido_id = NEW.id;
    -- valor_unitario já é o preço LÍQUIDO (desconto por peça aplicado na criação
    -- do pedido); desconto_pct do pedido é só informativo (média ponderada).
    v_total := round(v_bruto, 2) + COALESCE(NEW.frete, 0);
    IF v_total <= 0 THEN RETURN NEW; END IF;
    SELECT c.nome INTO v_cliente FROM public.clientes c WHERE c.id = NEW.cliente_id;
    SELECT prazo_padrao_dias INTO v_prazo FROM public.fiscal_config WHERE id = 1;
    v_prazo := COALESCE(v_prazo, 30);
    v_parc := GREATEST(1, LEAST(COALESCE(NEW.parcelas, 1), 48));
    v_nf := COALESCE(NEW.nota_fiscal, 's/ NF');
    FOR i IN 1..v_parc LOOP
      v_valor := CASE WHEN i < v_parc THEN round(v_total / v_parc, 2) ELSE v_total - v_acum END;
      v_acum := v_acum + v_valor;
      INSERT INTO public.contas_financeiras (
        tipo, descricao, valor, data_emissao, data_vencimento, status, categoria, pedido_id, nota_fiscal, created_by
      ) VALUES (
        'receber',
        'NF-e ' || v_nf || ' — ' || COALESCE(v_cliente, 'Cliente') || CASE WHEN v_parc > 1 THEN ' (' || i || '/' || v_parc || ')' ELSE '' END,
        v_valor,
        (now() AT TIME ZONE 'America/Sao_Paulo')::date,
        (now() AT TIME ZONE 'America/Sao_Paulo')::date +
          CASE WHEN NEW.forma_pagamento IN ('pix','dinheiro','cartao_debito') AND v_parc = 1 THEN 0
               WHEN v_parc > 1 THEN 30 * i ELSE v_prazo END,
        'aberto', 'venda', NEW.id, NEW.nota_fiscal, COALESCE(NEW.nf_criada_por, NEW.faturado_por)
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$f02$;

-- ── Registrar NF-e emitida em outro sistema ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_nf_externa(
  p_tipo text, p_pedido_id uuid, p_devolucao_id uuid,
  p_chave text, p_emitida_em timestamptz, p_valor numeric,
  p_xml_path text DEFAULT NULL, p_danfe_path text DEFAULT NULL, p_protocolo text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_rnf$
DECLARE
  v_uid uuid := auth.uid(); v_nome text; v_cnpj text; v_ped record; v_dev record;
  v_serie text; v_num integer; v_id uuid; v_dest_nome text; v_dest_doc text;
BEGIN
  IF public.get_my_role() NOT IN ('admin','financeiro') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão.');
  END IF;
  IF p_tipo NOT IN ('venda','devolucao','troca') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Tipo inválido.');
  END IF;
  p_chave := regexp_replace(COALESCE(p_chave, ''), '\D', '', 'g');
  IF NOT public.chave_nfe_valida(p_chave) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Chave de acesso inválida (confira os 44 números).');
  END IF;
  IF substr(p_chave, 21, 2) NOT IN ('55','65') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A chave não é de NF-e/NFC-e.');
  END IF;
  SELECT cnpj INTO v_cnpj FROM public.fiscal_config WHERE id = 1;
  IF v_cnpj IS NOT NULL AND substr(p_chave, 7, 14) <> v_cnpj THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esta chave é de outro CNPJ emitente — confira a nota.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.notas_fiscais WHERE chave = p_chave) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esta nota já está registrada.');
  END IF;
  v_serie := ltrim(substr(p_chave, 23, 3), '0'); IF v_serie = '' THEN v_serie := '0'; END IF;
  v_num   := substr(p_chave, 26, 9)::int;
  SELECT display_name INTO v_nome FROM public.profiles WHERE user_id = v_uid;

  IF p_tipo = 'venda' THEN
    SELECT p.*, c.nome AS cli_nome, c.documento AS cli_doc INTO v_ped
    FROM public.pedidos_comerciais p JOIN public.clientes c ON c.id = p.cliente_id WHERE p.id = p_pedido_id FOR UPDATE OF p;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado.'); END IF;
    IF v_ped.status NOT IN ('pronto','faturado') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'O pedido precisa estar "pronto" para faturar (status atual: ' || v_ped.status || ').');
    END IF;
    IF EXISTS (SELECT 1 FROM public.notas_fiscais WHERE pedido_id = p_pedido_id AND tipo = 'venda' AND ambiente = 1 AND status IN ('autorizada','processando')) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Este pedido já tem NF-e.');
    END IF;
    v_dest_nome := v_ped.cli_nome; v_dest_doc := v_ped.cli_doc;
  ELSE
    SELECT * INTO v_dev FROM public.notas_devolucao_troca WHERE id = p_devolucao_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Devolução/troca não encontrada.'); END IF;
    IF v_dev.status = 'autorizada' THEN RETURN jsonb_build_object('ok', false, 'error', 'Esta devolução já tem nota.'); END IF;
    v_dest_nome := v_dev.cliente_nome; v_dest_doc := v_dev.cliente_documento;
  END IF;

  INSERT INTO public.notas_fiscais (tipo, origem, pedido_id, devolucao_id, modelo, serie, numero, chave, protocolo,
    status, ambiente, destinatario_nome, destinatario_doc, valor_total, emitida_em, xml_path, danfe_path, created_by)
  VALUES (p_tipo, 'externa', CASE WHEN p_tipo = 'venda' THEN p_pedido_id END, CASE WHEN p_tipo <> 'venda' THEN p_devolucao_id END,
    substr(p_chave, 21, 2), v_serie, v_num, p_chave, NULLIF(btrim(COALESCE(p_protocolo, '')), ''),
    'autorizada', 1, v_dest_nome, v_dest_doc, round(COALESCE(p_valor, 0), 2), COALESCE(p_emitida_em, now()),
    p_xml_path, p_danfe_path, v_uid)
  RETURNING id INTO v_id;

  PERFORM set_config('app.fiscal', 'on', true);
  IF p_tipo = 'venda' THEN
    UPDATE public.pedidos_comerciais SET
      status = 'enviado', nota_fiscal = v_num::text, chave_acesso_nfe = p_chave,
      protocolo_sefaz = NULLIF(btrim(COALESCE(p_protocolo, '')), ''), dh_autorizacao_nfe = COALESCE(p_emitida_em, now()),
      tipo_nf = CASE WHEN substr(p_chave, 21, 2) = '65' THEN 'nfce' ELSE 'nfe' END,
      nf_criada_por = v_uid, nf_criada_em = now(), faturado_por = v_uid, faturado_em = now(),
      enviado_em = COALESCE(enviado_em, now())
    WHERE id = p_pedido_id;
  ELSE
    UPDATE public.notas_devolucao_troca SET
      status = 'autorizada', numero = v_num::text, serie = v_serie, chave_acesso = p_chave,
      dh_autorizacao = COALESCE(p_emitida_em, now()), status_msg = 'Registrada (emitida em outro sistema)', modo_teste = false
    WHERE id = p_devolucao_id;
  END IF;
  PERFORM set_config('app.fiscal', 'off', true);

  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (v_uid, COALESCE(v_nome, '—'), 'registrar_nf_externa', 'nota_fiscal', v_id,
          jsonb_build_object('tipo', p_tipo, 'numero', v_num, 'serie', v_serie, 'chave', p_chave));
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'numero', v_num, 'serie', v_serie);
END;
$f_rnf$;
REVOKE EXECUTE ON FUNCTION public.registrar_nf_externa(text,uuid,uuid,text,timestamptz,numeric,text,text,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_nf_externa(text,uuid,uuid,text,timestamptz,numeric,text,text,text) TO authenticated;

-- Anexar XML/DANFE depois (somente se ainda não houver)
CREATE OR REPLACE FUNCTION public.anexar_arquivo_nf(p_nf_id uuid, p_xml_path text, p_danfe_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_anx$
BEGIN
  IF public.get_my_role() NOT IN ('admin','financeiro') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão.');
  END IF;
  UPDATE public.notas_fiscais SET
    xml_path   = COALESCE(xml_path, NULLIF(p_xml_path, '')),
    danfe_path = COALESCE(NULLIF(p_danfe_path, ''), danfe_path)
  WHERE id = p_nf_id;
  RETURN jsonb_build_object('ok', FOUND);
END;
$f_anx$;
REVOKE EXECUTE ON FUNCTION public.anexar_arquivo_nf(uuid,text,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.anexar_arquivo_nf(uuid,text,text) TO authenticated;

-- Resultado vindo do emissor integrado (somente a edge function)
CREATE OR REPLACE FUNCTION public.fiscal_aplicar_resultado(
  p_nf_id uuid, p_status text, p_numero integer, p_serie text, p_chave text, p_protocolo text,
  p_emitida_em timestamptz, p_mensagem text, p_xml_path text, p_danfe_url text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_far$
DECLARE v_nf record;
BEGIN
  SELECT * INTO v_nf FROM public.notas_fiscais WHERE id = p_nf_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'nota não encontrada'); END IF;
  IF v_nf.status IN ('autorizada','cancelada','denegada') THEN
    UPDATE public.notas_fiscais SET xml_path = COALESCE(xml_path, p_xml_path), danfe_url = COALESCE(danfe_url, p_danfe_url)
    WHERE id = p_nf_id;
    RETURN jsonb_build_object('ok', true, 'ja_finalizada', true);
  END IF;
  UPDATE public.notas_fiscais SET status = p_status, numero = COALESCE(p_numero, numero), serie = COALESCE(p_serie, serie),
    chave = COALESCE(p_chave, chave), protocolo = COALESCE(p_protocolo, protocolo), emitida_em = COALESCE(p_emitida_em, emitida_em),
    mensagem = p_mensagem, xml_path = COALESCE(p_xml_path, xml_path), danfe_url = COALESCE(p_danfe_url, danfe_url)
  WHERE id = p_nf_id;
  IF p_status = 'autorizada' THEN
    PERFORM set_config('app.fiscal', 'on', true);
    IF v_nf.tipo = 'venda' THEN
      UPDATE public.pedidos_comerciais SET status = 'enviado', nota_fiscal = p_numero::text, chave_acesso_nfe = p_chave,
        protocolo_sefaz = p_protocolo, dh_autorizacao_nfe = p_emitida_em, tipo_nf = 'nfe',
        nf_criada_por = v_nf.created_by, nf_criada_em = now(), faturado_por = v_nf.created_by, faturado_em = now(),
        enviado_em = COALESCE(enviado_em, now())
      WHERE id = v_nf.pedido_id;
    ELSE
      UPDATE public.notas_devolucao_troca SET status = 'autorizada', numero = p_numero::text, serie = p_serie,
        chave_acesso = p_chave, protocolo_sefaz = p_protocolo, dh_autorizacao = p_emitida_em, status_msg = p_mensagem, modo_teste = false
      WHERE id = v_nf.devolucao_id;
    END IF;
    PERFORM set_config('app.fiscal', 'off', true);
  ELSIF p_status IN ('rejeitada','denegada') AND v_nf.tipo <> 'venda' THEN
    UPDATE public.notas_devolucao_troca SET status = 'rejeitada', status_msg = p_mensagem WHERE id = v_nf.devolucao_id;
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$f_far$;
REVOKE EXECUTE ON FUNCTION public.fiscal_aplicar_resultado(uuid,text,integer,text,text,text,timestamptz,text,text,text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fiscal_aplicar_resultado(uuid,text,integer,text,text,text,timestamptz,text,text,text) TO service_role;

-- Cancelamento homologado pela SEFAZ (edge function) ou registrado (externa)
CREATE OR REPLACE FUNCTION public.fiscal_aplicar_cancelamento(p_nf_id uuid, p_protocolo text, p_motivo text, p_uid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_fac$
DECLARE v_nf record;
BEGIN
  SELECT * INTO v_nf FROM public.notas_fiscais WHERE id = p_nf_id FOR UPDATE;
  IF NOT FOUND OR v_nf.status <> 'autorizada' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Só nota autorizada pode ser cancelada.');
  END IF;
  UPDATE public.notas_fiscais SET status = 'cancelada', cancelada_em = now(), motivo_cancelamento = p_motivo,
    eventos = eventos || jsonb_build_array(jsonb_build_object('tipo','cancelamento','em',now(),'protocolo',p_protocolo,'texto',p_motivo,'por',p_uid))
  WHERE id = p_nf_id;
  PERFORM set_config('app.fiscal', 'on', true);
  IF v_nf.tipo = 'venda' THEN
    -- Pedido volta para "pronto" (pode ser faturado de novo) e as contas em aberto são canceladas.
    UPDATE public.pedidos_comerciais SET status = 'pronto', nota_fiscal = NULL, chave_acesso_nfe = NULL,
      protocolo_sefaz = NULL, dh_autorizacao_nfe = NULL, xml_nfe = NULL, enviado_em = NULL
    WHERE id = v_nf.pedido_id;
    UPDATE public.contas_financeiras SET status = 'cancelado',
      observacoes = COALESCE(observacoes || ' · ', '') || 'NF-e cancelada'
    WHERE pedido_id = v_nf.pedido_id AND tipo = 'receber' AND status IN ('aberto','vencido');
  ELSE
    UPDATE public.notas_devolucao_troca SET status = 'cancelada', status_msg = 'NF-e cancelada' WHERE id = v_nf.devolucao_id;
  END IF;
  PERFORM set_config('app.fiscal', 'off', true);
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (p_uid, COALESCE((SELECT display_name FROM public.profiles WHERE user_id = p_uid), '—'),
          'cancelar_nf', 'nota_fiscal', p_nf_id, jsonb_build_object('numero', v_nf.numero, 'motivo', p_motivo));
  RETURN jsonb_build_object('ok', true);
END;
$f_fac$;
REVOKE EXECUTE ON FUNCTION public.fiscal_aplicar_cancelamento(uuid,text,text,uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fiscal_aplicar_cancelamento(uuid,text,text,uuid) TO service_role;

-- Cancelamento de nota REGISTRADA (emitida fora): o cancelamento na SEFAZ é
-- feito no sistema emissor; aqui só se registra o protocolo.
CREATE OR REPLACE FUNCTION public.registrar_cancelamento_externo(p_nf_id uuid, p_protocolo text, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_rce$
BEGIN
  IF public.get_my_role() NOT IN ('admin','financeiro') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notas_fiscais WHERE id = p_nf_id AND origem = 'externa') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nota emitida pelo emissor integrado: cancele pelo botão do sistema.');
  END IF;
  IF length(btrim(COALESCE(p_motivo, ''))) < 15 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe o motivo (mínimo 15 caracteres).');
  END IF;
  RETURN public.fiscal_aplicar_cancelamento(p_nf_id, p_protocolo, btrim(p_motivo), auth.uid());
END;
$f_rce$;
REVOKE EXECUTE ON FUNCTION public.registrar_cancelamento_externo(uuid,text,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_cancelamento_externo(uuid,text,text) TO authenticated;

-- ── Bucket privado para XML/DANFE (sem política de UPDATE/DELETE) ───────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('fiscal', 'fiscal', false, 10485760,
        ARRAY['application/xml','text/xml','application/pdf','application/octet-stream'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS "fiscal_read" ON storage.objects;
CREATE POLICY "fiscal_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'fiscal' AND public.get_my_role() IN ('admin','financeiro'));
DROP POLICY IF EXISTS "fiscal_insert" ON storage.objects;
CREATE POLICY "fiscal_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fiscal' AND public.get_my_role() IN ('admin','financeiro'));

-- ── Guarda de documentos fiscais nas limpezas de histórico ─────────────────
CREATE OR REPLACE FUNCTION public.admin_clear_comercial()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_cc$
DECLARE v_count integer; v_mantidos integer; v_uid uuid := auth.uid(); v_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado: apenas administradores.');
  END IF;
  SELECT COUNT(*) INTO v_mantidos FROM public.pedidos_comerciais p
  WHERE EXISTS (SELECT 1 FROM public.notas_fiscais n WHERE n.pedido_id = p.id);
  WITH del AS (
    DELETE FROM public.pedidos_comerciais p
    WHERE NOT EXISTS (SELECT 1 FROM public.notas_fiscais n WHERE n.pedido_id = p.id)
    RETURNING 1
  ) SELECT COUNT(*) INTO v_count FROM del;
  -- Reservas: recalculadas a partir dos pedidos que continuam abertos
  UPDATE public.stock_items s SET quantity_reserved = COALESCE((
    SELECT SUM(pi.quantidade_reservada) FROM public.pedido_itens pi
    JOIN public.pedidos_comerciais p ON p.id = pi.pedido_id
    WHERE pi.stock_item_id = s.id AND p.status IN ('pendente','separando','pronto')), 0)
  WHERE true;
  SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid;
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, details)
  VALUES (v_uid, COALESCE(v_name, 'Desconhecido'), 'admin_clear_comercial', 'pedidos_comerciais',
    jsonb_build_object('deleted', v_count, 'mantidos_com_nf', v_mantidos));
  RETURN jsonb_build_object('ok', true, 'deleted', v_count, 'mantidos_com_nf', v_mantidos);
END;
$f_cc$;
GRANT EXECUTE ON FUNCTION public.admin_clear_comercial() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_clear_financeiro()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_cf$
DECLARE v_count integer; v_count_dev integer; v_uid uuid := auth.uid(); v_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado: apenas administradores.');
  END IF;
  WITH d AS (DELETE FROM public.contas_financeiras WHERE true RETURNING 1) SELECT COUNT(*) INTO v_count FROM d;
  WITH d AS (
    DELETE FROM public.notas_devolucao_troca t
    WHERE NOT EXISTS (SELECT 1 FROM public.notas_fiscais n WHERE n.devolucao_id = t.id)
    RETURNING 1
  ) SELECT COUNT(*) INTO v_count_dev FROM d;
  SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid;
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, details)
  VALUES (v_uid, COALESCE(v_name, 'Desconhecido'), 'admin_clear_financeiro', 'contas_financeiras',
    jsonb_build_object('deleted', v_count, 'devolucoes_trocas_deleted', v_count_dev));
  RETURN jsonb_build_object('ok', true, 'deleted', v_count + v_count_dev);
END;
$f_cf$;
GRANT EXECUTE ON FUNCTION public.admin_clear_financeiro() TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_stock_item(p_stock_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f05$
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Apenas administradores podem excluir peças.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.pedido_itens pi JOIN public.notas_fiscais n ON n.pedido_id = pi.pedido_id
             WHERE pi.stock_item_id = p_stock_item_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esta peça consta em nota fiscal emitida e não pode ser excluída — desative-a.');
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

-- ── Contas a pagar/receber: só financeiro, admin e comercial (histórico do cliente)
DROP POLICY IF EXISTS "cf_select" ON public.contas_financeiras;
CREATE POLICY "cf_select" ON public.contas_financeiras FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','financeiro','comercial'));

-- Clientes: base única da empresa — comercial e financeiro podem completar
-- cadastros de qualquer cliente (endereço/IE para a NF-e), não só os próprios.
DROP POLICY IF EXISTS "clientes_update" ON public.clientes;
CREATE POLICY "clientes_update" ON public.clientes FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = created_by OR public.get_my_role() IN ('admin','comercial','financeiro'))
  WITH CHECK ((SELECT auth.uid()) = created_by OR public.get_my_role() IN ('admin','comercial','financeiro'));

-- Clientes sem duplicidade: mesmo CPF/CNPJ (com ou sem pontuação) não entra
-- duas vezes; sem documento, bloqueia nome idêntico. Cadastros duplicados
-- antigos continuam lá (não são apagados) — só impede novos.
CREATE OR REPLACE FUNCTION public.clientes_sem_duplicado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_csd$
DECLARE v_doc text := regexp_replace(COALESCE(NEW.documento, ''), '\D', '', 'g'); v_nome text;
BEGIN
  IF length(v_doc) IN (11, 14) THEN
    SELECT nome INTO v_nome FROM public.clientes
    WHERE id <> NEW.id AND regexp_replace(COALESCE(documento, ''), '\D', '', 'g') = v_doc LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Cliente já cadastrado com este CPF/CNPJ: %', v_nome USING ERRCODE = '23505';
    END IF;
  ELSIF v_doc = '' THEN
    SELECT nome INTO v_nome FROM public.clientes
    WHERE id <> NEW.id AND regexp_replace(COALESCE(documento, ''), '\D', '', 'g') = ''
      AND lower(btrim(regexp_replace(nome, '\s+', ' ', 'g'))) = lower(btrim(regexp_replace(NEW.nome, '\s+', ' ', 'g')))
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Já existe um cliente com este nome: %', v_nome USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$f_csd$;
DROP TRIGGER IF EXISTS trg_clientes_sem_duplicado ON public.clientes;
CREATE TRIGGER trg_clientes_sem_duplicado BEFORE INSERT OR UPDATE OF documento, nome ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.clientes_sem_duplicado();
CREATE INDEX IF NOT EXISTS idx_clientes_doc_digitos ON public.clientes ((regexp_replace(COALESCE(documento, ''), '\D', '', 'g')));

-- Numeração manual antiga: só admin/financeiro
CREATE OR REPLACE FUNCTION public.get_next_nf_number(p_serie text DEFAULT '1', p_tipo text DEFAULT 'nfe')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_nfnum$
DECLARE v_num bigint;
BEGIN
  IF public.get_my_role() NOT IN ('admin','financeiro') THEN
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

-- ── Contas a pagar/receber como lugar único do dinheiro ─────────────────────
-- Os "lançamentos" (compras/custos) viram contas a pagar já pagas, para que
-- Visão geral, Contas e Fluxo de caixa enxerguem tudo num lugar só. A tabela
-- financeiro_lancamentos fica como histórico (não é apagada).
ALTER TABLE public.contas_financeiras
  ADD COLUMN IF NOT EXISTS lancamento_origem_id uuid,
  ADD COLUMN IF NOT EXISTS favorecido           text,
  ADD COLUMN IF NOT EXISTS forma_pagamento      text,
  ADD COLUMN IF NOT EXISTS valor_pago           numeric(14,2);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_lancamento_origem ON public.contas_financeiras (lancamento_origem_id)
  WHERE lancamento_origem_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cf_tipo_status_venc ON public.contas_financeiras (tipo, status, data_vencimento);
INSERT INTO public.contas_financeiras (tipo, descricao, valor, data_emissao, data_vencimento, data_pagamento, status,
  categoria, nota_fiscal, observacoes, favorecido, created_by, lancamento_origem_id, valor_pago)
SELECT 'pagar', l.descricao, l.valor, l.data_lancamento, l.data_lancamento, l.data_lancamento, 'pago',
  COALESCE(NULLIF(l.categoria, ''), 'outros'), COALESCE(l.nota_fiscal_manual, l.chave_nfe), l.observacoes, l.fornecedor,
  l.created_by, l.id, l.valor
FROM public.financeiro_lancamentos l
WHERE COALESCE(l.modo_teste, false) = false AND l.valor > 0
  AND NOT EXISTS (SELECT 1 FROM public.contas_financeiras c WHERE c.lancamento_origem_id = l.id);

-- Contas vencidas: atualizadas automaticamente na leitura do painel
CREATE OR REPLACE FUNCTION public.atualizar_contas_vencidas()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_acv$
DECLARE v integer;
BEGIN
  IF public.get_my_role() NOT IN ('admin','financeiro','comercial') THEN RETURN 0; END IF;
  UPDATE public.contas_financeiras SET status = 'vencido'
  WHERE status = 'aberto' AND data_vencimento < (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END;
$f_acv$;
REVOKE EXECUTE ON FUNCTION public.atualizar_contas_vencidas() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.atualizar_contas_vencidas() TO authenticated;

-- ── R13b. Endurecimento do faturamento (revisão independente) ───────────────

-- Configuração fiscal: financeiro edita os dados, mas a referência do token e o
-- provedor só mudam por set_fiscal_token (admin). Revoga o UPDATE da tabela
-- inteira e concede só as colunas liberadas.
REVOKE UPDATE ON public.fiscal_config FROM authenticated;
GRANT UPDATE (razao_social, nome_fantasia, cnpj, ie, im, crt, logradouro, numero, complemento, bairro, municipio, c_mun,
  uf, cep, telefone, email, ambiente, serie_nfe, natureza_padrao, cfop_dentro_uf, cfop_fora_uf, prazo_padrao_dias,
  aliquota_icms_interna, pis_aliquota, cofins_aliquota, info_complementar) ON public.fiscal_config TO authenticated;

-- Uma única NF-e de venda (de produção) por pedido e por devolução — impede
-- emissão dupla por clique duplo ou dois usuários ao mesmo tempo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nf_uma_venda_por_pedido ON public.notas_fiscais (pedido_id)
  WHERE tipo = 'venda' AND ambiente = 1 AND status IN ('processando','autorizada');
CREATE UNIQUE INDEX IF NOT EXISTS idx_nf_uma_por_devolucao ON public.notas_fiscais (devolucao_id)
  WHERE devolucao_id IS NOT NULL AND ambiente = 1 AND status IN ('processando','autorizada');

-- Proteção do pedido faturado: roda como dono (enxerga notas_fiscais mesmo
-- para perfis sem acesso ao Financeiro) e impede "faturar" sem nota.
CREATE OR REPLACE FUNCTION public.pedido_protege_fiscal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_pfp$
BEGIN
  IF current_setting('app.fiscal', true) = 'on' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.notas_fiscais n WHERE n.pedido_id = OLD.id AND n.ambiente = 1 AND n.status IN ('autorizada','processando'))
     AND (NEW.nota_fiscal IS DISTINCT FROM OLD.nota_fiscal OR NEW.chave_acesso_nfe IS DISTINCT FROM OLD.chave_acesso_nfe
          OR NEW.protocolo_sefaz IS DISTINCT FROM OLD.protocolo_sefaz OR NEW.xml_nfe IS DISTINCT FROM OLD.xml_nfe
          OR NEW.dh_autorizacao_nfe IS DISTINCT FROM OLD.dh_autorizacao_nfe OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id
          OR NEW.frete IS DISTINCT FROM OLD.frete
          OR (NEW.status IN ('pendente','separando','pronto','cancelado','retorno') AND NEW.status IS DISTINCT FROM OLD.status)) THEN
    RAISE EXCEPTION 'Pedido com NF-e autorizada: dados fiscais não podem ser alterados (cancele a NF-e antes).' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IN ('faturado','enviado') AND OLD.status NOT IN ('faturado','enviado')
     AND COALESCE(public.get_my_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'O faturamento é feito no Financeiro (emitir ou registrar a NF-e).' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$f_pfp$;

-- Itens de pedido com NF-e não mudam (quantidade/preço/peça).
CREATE OR REPLACE FUNCTION public.pedido_itens_protege_fiscal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_pip$
DECLARE v_pid uuid := COALESCE(NEW.pedido_id, OLD.pedido_id);
BEGIN
  IF current_setting('app.fiscal', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF EXISTS (SELECT 1 FROM public.notas_fiscais n WHERE n.pedido_id = v_pid AND n.ambiente = 1 AND n.status IN ('autorizada','processando')) THEN
    IF TG_OP = 'UPDATE' AND NEW.quantidade IS NOT DISTINCT FROM OLD.quantidade AND NEW.valor_unitario IS NOT DISTINCT FROM OLD.valor_unitario
       AND NEW.stock_item_id IS NOT DISTINCT FROM OLD.stock_item_id THEN
      RETURN NEW;  -- ajustes de separação (lote/reserva) continuam liberados
    END IF;
    RAISE EXCEPTION 'Itens de pedido com NF-e autorizada não podem ser alterados.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$f_pip$;
DROP TRIGGER IF EXISTS trg_pedido_itens_protege_fiscal ON public.pedido_itens;
CREATE TRIGGER trg_pedido_itens_protege_fiscal BEFORE INSERT OR UPDATE OR DELETE ON public.pedido_itens
  FOR EACH ROW EXECUTE FUNCTION public.pedido_itens_protege_fiscal();

-- Conta a receber: inclui IPI destacado (regime normal) e evita parcela de R$ 0,00.
CREATE OR REPLACE FUNCTION public.criar_conta_receber_nfe()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f02$
DECLARE
  v_total numeric; v_cliente text; v_parc integer; v_prazo integer; v_crt smallint; i integer;
  v_valor numeric; v_acum numeric := 0; v_nf text;
BEGIN
  IF NEW.status IN ('faturado','enviado') AND OLD.status NOT IN ('faturado','enviado')
     AND NOT EXISTS (SELECT 1 FROM public.contas_financeiras c
                     WHERE c.pedido_id = NEW.id AND c.tipo = 'receber' AND c.status <> 'cancelado'
                       AND c.categoria <> 'credito_devolucao_cliente') THEN
    SELECT prazo_padrao_dias, crt INTO v_prazo, v_crt FROM public.fiscal_config WHERE id = 1;
    -- valor_unitario já é LÍQUIDO (desconto por peça aplicado no pedido)
    SELECT COALESCE(SUM(round(pi.quantidade * COALESCE(pi.valor_unitario, 0), 2)
             * CASE WHEN v_crt = 3 THEN 1 + COALESCE(d.ipi_pct, 0) / 100.0 ELSE 1 END), 0)
      INTO v_total
    FROM public.pedido_itens pi
    LEFT JOIN public.stock_items si ON si.id = pi.stock_item_id
    LEFT JOIN public.devices d ON d.id = si.device_id
    WHERE pi.pedido_id = NEW.id;
    -- crédito de devolução usado no pedido abate o valor a receber (a NF-e sai cheia)
    v_total := round(v_total, 2) + COALESCE(NEW.frete, 0) - COALESCE(NEW.credito_aplicado, 0);
    IF v_total <= 0 THEN RETURN NEW; END IF;
    SELECT c.nome INTO v_cliente FROM public.clientes c WHERE c.id = NEW.cliente_id;
    v_prazo := COALESCE(v_prazo, 30);
    v_parc := GREATEST(1, LEAST(COALESCE(NEW.parcelas, 1), 48));
    IF round(v_total / v_parc, 2) < 0.01 THEN v_parc := 1; END IF;
    v_nf := COALESCE(NEW.nota_fiscal, 's/ NF');
    FOR i IN 1..v_parc LOOP
      v_valor := CASE WHEN i < v_parc THEN round(v_total / v_parc, 2) ELSE v_total - v_acum END;
      v_acum := v_acum + v_valor;
      INSERT INTO public.contas_financeiras (
        tipo, descricao, valor, data_emissao, data_vencimento, status, categoria, pedido_id, nota_fiscal, created_by
      ) VALUES (
        'receber',
        'NF-e ' || v_nf || ' — ' || COALESCE(v_cliente, 'Cliente') || CASE WHEN v_parc > 1 THEN ' (' || i || '/' || v_parc || ')' ELSE '' END,
        v_valor,
        (now() AT TIME ZONE 'America/Sao_Paulo')::date,
        (now() AT TIME ZONE 'America/Sao_Paulo')::date +
          CASE WHEN NEW.forma_pagamento IN ('pix','dinheiro','cartao_debito') AND v_parc = 1 THEN 0
               WHEN v_parc > 1 THEN 30 * i ELSE v_prazo END,
        'aberto', 'venda', NEW.id, NEW.nota_fiscal, COALESCE(NEW.nf_criada_por, NEW.faturado_por)
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$f02$;

-- Rastreabilidade pós-venda: não duplica quando o pedido é refaturado.
CREATE OR REPLACE FUNCTION public.criar_rastreabilidade_pos_venda()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f03$
BEGIN
  IF NEW.status = 'enviado' AND OLD.status != 'enviado' THEN
    INSERT INTO public.rastreabilidade_pos_venda (
      pedido_id, pedido_item_id, stock_item_id, lote, device_id, device_ref, device_model, udi_di,
      quantidade, cliente_id, cliente_nome, data_envio
    )
    SELECT NEW.id, pi.id, pi.stock_item_id, COALESCE(pi.lote, ''), d.id, d.reference, d.model, d.udi_di,
      pi.quantidade, NEW.cliente_id, COALESCE((SELECT nome FROM public.clientes WHERE id = NEW.cliente_id), ''), CURRENT_DATE
    FROM public.pedido_itens pi
    JOIN public.stock_items si ON si.id = pi.stock_item_id
    JOIN public.devices d ON d.id = si.device_id
    WHERE pi.pedido_id = NEW.id
      AND NOT EXISTS (SELECT 1 FROM public.rastreabilidade_pos_venda r WHERE r.pedido_item_id = pi.id);
  END IF;
  RETURN NEW;
END;
$f03$;

-- Homologação não mexe no pedido/contas; cancelamento exige estornar baixas antes.
CREATE OR REPLACE FUNCTION public.fiscal_aplicar_resultado(
  p_nf_id uuid, p_status text, p_numero integer, p_serie text, p_chave text, p_protocolo text,
  p_emitida_em timestamptz, p_mensagem text, p_xml_path text, p_danfe_url text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_far$
DECLARE v_nf record;
BEGIN
  SELECT * INTO v_nf FROM public.notas_fiscais WHERE id = p_nf_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'nota não encontrada'); END IF;
  IF v_nf.status IN ('autorizada','cancelada','denegada') THEN
    UPDATE public.notas_fiscais SET xml_path = COALESCE(xml_path, p_xml_path), danfe_url = COALESCE(danfe_url, p_danfe_url)
    WHERE id = p_nf_id;
    RETURN jsonb_build_object('ok', true, 'ja_finalizada', true);
  END IF;
  UPDATE public.notas_fiscais SET status = p_status, numero = COALESCE(p_numero, numero), serie = COALESCE(p_serie, serie),
    chave = COALESCE(p_chave, chave), protocolo = COALESCE(p_protocolo, protocolo), emitida_em = COALESCE(p_emitida_em, emitida_em),
    mensagem = p_mensagem, xml_path = COALESCE(p_xml_path, xml_path), danfe_url = COALESCE(p_danfe_url, danfe_url)
  WHERE id = p_nf_id;
  IF v_nf.ambiente = 1 THEN
    PERFORM set_config('app.fiscal', 'on', true);
    IF p_status = 'autorizada' AND v_nf.tipo = 'venda' THEN
      UPDATE public.pedidos_comerciais SET status = 'enviado', nota_fiscal = p_numero::text, chave_acesso_nfe = p_chave,
        protocolo_sefaz = p_protocolo, dh_autorizacao_nfe = p_emitida_em, tipo_nf = 'nfe',
        nf_criada_por = v_nf.created_by, nf_criada_em = now(), faturado_por = v_nf.created_by, faturado_em = now(),
        enviado_em = COALESCE(enviado_em, now())
      WHERE id = v_nf.pedido_id;
    ELSIF p_status = 'autorizada' THEN
      UPDATE public.notas_devolucao_troca SET status = 'autorizada', numero = p_numero::text, serie = p_serie,
        chave_acesso = p_chave, protocolo_sefaz = p_protocolo, dh_autorizacao = p_emitida_em, status_msg = p_mensagem, modo_teste = false
      WHERE id = v_nf.devolucao_id;
    ELSIF p_status IN ('rejeitada','denegada') AND v_nf.tipo <> 'venda' THEN
      UPDATE public.notas_devolucao_troca SET status = 'rejeitada', status_msg = p_mensagem WHERE id = v_nf.devolucao_id;
    END IF;
    PERFORM set_config('app.fiscal', 'off', true);
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$f_far$;
REVOKE EXECUTE ON FUNCTION public.fiscal_aplicar_resultado(uuid,text,integer,text,text,text,timestamptz,text,text,text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fiscal_aplicar_resultado(uuid,text,integer,text,text,text,timestamptz,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.fiscal_aplicar_cancelamento(p_nf_id uuid, p_protocolo text, p_motivo text, p_uid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_fac$
DECLARE v_nf record;
BEGIN
  SELECT * INTO v_nf FROM public.notas_fiscais WHERE id = p_nf_id FOR UPDATE;
  IF NOT FOUND OR v_nf.status <> 'autorizada' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Só nota autorizada pode ser cancelada.');
  END IF;
  UPDATE public.notas_fiscais SET status = 'cancelada', cancelada_em = now(), motivo_cancelamento = p_motivo,
    eventos = eventos || jsonb_build_array(jsonb_build_object('tipo','cancelamento','em',now(),'protocolo',p_protocolo,'texto',p_motivo,'por',p_uid))
  WHERE id = p_nf_id;
  IF v_nf.ambiente = 1 THEN
    PERFORM set_config('app.fiscal', 'on', true);
    IF v_nf.tipo = 'venda' THEN
      UPDATE public.pedidos_comerciais SET status = 'pronto', nota_fiscal = NULL, chave_acesso_nfe = NULL,
        protocolo_sefaz = NULL, dh_autorizacao_nfe = NULL, xml_nfe = NULL, enviado_em = NULL
      WHERE id = v_nf.pedido_id;
      UPDATE public.contas_financeiras SET status = 'cancelado',
        observacoes = COALESCE(observacoes || ' · ', '') || 'NF-e cancelada'
      WHERE pedido_id = v_nf.pedido_id AND tipo = 'receber' AND status IN ('aberto','vencido') AND categoria <> 'credito_devolucao_cliente';
    ELSE
      UPDATE public.notas_devolucao_troca SET status = 'cancelada', status_msg = 'NF-e cancelada' WHERE id = v_nf.devolucao_id;
    END IF;
    PERFORM set_config('app.fiscal', 'off', true);
  END IF;
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (p_uid, COALESCE((SELECT display_name FROM public.profiles WHERE user_id = p_uid), '—'),
          'cancelar_nf', 'nota_fiscal', p_nf_id, jsonb_build_object('numero', v_nf.numero, 'motivo', p_motivo));
  RETURN jsonb_build_object('ok', true);
END;
$f_fac$;
REVOKE EXECUTE ON FUNCTION public.fiscal_aplicar_cancelamento(uuid,text,text,uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fiscal_aplicar_cancelamento(uuid,text,text,uuid) TO service_role;

-- Antes de cancelar uma NF-e de venda: nenhuma parcela pode estar recebida.
CREATE OR REPLACE FUNCTION public.nf_pode_cancelar(p_nf_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $f_npc$
DECLARE v_nf record; v_pagas integer;
BEGIN
  IF public.get_my_role() NOT IN ('admin','financeiro') AND current_user <> 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão.');
  END IF;
  SELECT * INTO v_nf FROM public.notas_fiscais WHERE id = p_nf_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Nota não encontrada.'); END IF;
  IF v_nf.tipo = 'venda' AND v_nf.ambiente = 1 THEN
    SELECT COUNT(*) INTO v_pagas FROM public.contas_financeiras
    WHERE pedido_id = v_nf.pedido_id AND tipo = 'receber' AND status = 'pago' AND categoria <> 'credito_devolucao_cliente';
    IF v_pagas > 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Há parcela(s) já recebida(s) desta nota. Estorne a baixa em Contas antes de cancelar a NF-e.');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$f_npc$;
REVOKE EXECUTE ON FUNCTION public.nf_pode_cancelar(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.nf_pode_cancelar(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.registrar_cancelamento_externo(p_nf_id uuid, p_protocolo text, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_rce$
DECLARE v_ok jsonb;
BEGIN
  IF public.get_my_role() NOT IN ('admin','financeiro') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notas_fiscais WHERE id = p_nf_id AND origem = 'externa') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nota emitida pelo emissor integrado: cancele pelo botão do sistema.');
  END IF;
  IF length(btrim(COALESCE(p_motivo, ''))) < 15 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe o motivo (mínimo 15 caracteres).');
  END IF;
  v_ok := public.nf_pode_cancelar(p_nf_id);
  IF NOT (v_ok->>'ok')::boolean THEN RETURN v_ok; END IF;
  RETURN public.fiscal_aplicar_cancelamento(p_nf_id, p_protocolo, btrim(p_motivo), auth.uid());
END;
$f_rce$;
REVOKE EXECUTE ON FUNCTION public.registrar_cancelamento_externo(uuid,text,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_cancelamento_externo(uuid,text,text) TO authenticated;

-- Anexos: não substitui arquivo já guardado e só aceita caminhos do bucket fiscal/nfe.
CREATE OR REPLACE FUNCTION public.anexar_arquivo_nf(p_nf_id uuid, p_xml_path text, p_danfe_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_anx$
BEGIN
  IF public.get_my_role() NOT IN ('admin','financeiro') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão.');
  END IF;
  IF (NULLIF(p_xml_path, '') IS NOT NULL AND p_xml_path !~ '^nfe/[0-9]{4}/[0-9]{44}\.xml$')
     OR (NULLIF(p_danfe_path, '') IS NOT NULL AND p_danfe_path !~ '^nfe/[0-9]{4}/[0-9]{44}-danfe\.pdf$') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Arquivo inválido.');
  END IF;
  UPDATE public.notas_fiscais SET
    xml_path   = COALESCE(xml_path, NULLIF(p_xml_path, '')),
    danfe_path = COALESCE(danfe_path, NULLIF(p_danfe_path, ''))
  WHERE id = p_nf_id;
  RETURN jsonb_build_object('ok', FOUND);
END;
$f_anx$;
REVOKE EXECUTE ON FUNCTION public.anexar_arquivo_nf(uuid,text,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.anexar_arquivo_nf(uuid,text,text) TO authenticated;

-- Créditos de devolução não "vencem".
CREATE OR REPLACE FUNCTION public.atualizar_contas_vencidas()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_acv$
DECLARE v integer;
BEGIN
  IF public.get_my_role() NOT IN ('admin','financeiro','comercial') THEN RETURN 0; END IF;
  UPDATE public.contas_financeiras SET status = 'vencido'
  WHERE status = 'aberto' AND categoria <> 'credito_devolucao_cliente'
    AND data_vencimento < (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END;
$f_acv$;
CREATE OR REPLACE FUNCTION public.atualizar_status_vencido()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f_asv$
  UPDATE public.contas_financeiras SET status = 'vencido', updated_at = now()
  WHERE status = 'aberto' AND categoria <> 'credito_devolucao_cliente' AND data_vencimento < CURRENT_DATE;
$f_asv$;
UPDATE public.contas_financeiras SET status = 'aberto'
WHERE categoria = 'credito_devolucao_cliente' AND status = 'vencido';

-- Clientes antigos duplicados continuam editáveis (só bloqueia quando o
-- documento/nome realmente muda para um que já existe).
CREATE OR REPLACE FUNCTION public.clientes_sem_duplicado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_csd$
DECLARE v_doc text := regexp_replace(COALESCE(NEW.documento, ''), '\D', '', 'g'); v_nome text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND regexp_replace(COALESCE(NEW.documento, ''), '\D', '', 'g') = regexp_replace(COALESCE(OLD.documento, ''), '\D', '', 'g')
     AND lower(btrim(NEW.nome)) = lower(btrim(OLD.nome)) THEN
    RETURN NEW;
  END IF;
  IF length(v_doc) IN (11, 14) THEN
    SELECT nome INTO v_nome FROM public.clientes
    WHERE id <> NEW.id AND regexp_replace(COALESCE(documento, ''), '\D', '', 'g') = v_doc LIMIT 1;
    IF FOUND THEN RAISE EXCEPTION 'Cliente já cadastrado com este CPF/CNPJ: %', v_nome USING ERRCODE = '23505'; END IF;
  ELSIF v_doc = '' THEN
    SELECT nome INTO v_nome FROM public.clientes
    WHERE id <> NEW.id AND regexp_replace(COALESCE(documento, ''), '\D', '', 'g') = ''
      AND lower(btrim(regexp_replace(nome, '\s+', ' ', 'g'))) = lower(btrim(regexp_replace(NEW.nome, '\s+', ' ', 'g')))
    LIMIT 1;
    IF FOUND THEN RAISE EXCEPTION 'Já existe um cliente com este nome: %', v_nome USING ERRCODE = '23505'; END IF;
  END IF;
  RETURN NEW;
END;
$f_csd$;

-- "Apagar histórico financeiro" preserva as contas das vendas com NF-e.
CREATE OR REPLACE FUNCTION public.admin_clear_financeiro()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_cf$
DECLARE v_count integer; v_count_dev integer; v_uid uuid := auth.uid(); v_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado: apenas administradores.');
  END IF;
  WITH d AS (
    DELETE FROM public.contas_financeiras c
    WHERE NOT EXISTS (SELECT 1 FROM public.notas_fiscais n WHERE n.pedido_id = c.pedido_id AND c.pedido_id IS NOT NULL)
    RETURNING 1
  ) SELECT COUNT(*) INTO v_count FROM d;
  WITH d AS (
    DELETE FROM public.notas_devolucao_troca t
    WHERE NOT EXISTS (SELECT 1 FROM public.notas_fiscais n WHERE n.devolucao_id = t.id)
    RETURNING 1
  ) SELECT COUNT(*) INTO v_count_dev FROM d;
  SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid;
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, details)
  VALUES (v_uid, COALESCE(v_name, 'Desconhecido'), 'admin_clear_financeiro', 'contas_financeiras',
    jsonb_build_object('deleted', v_count, 'devolucoes_trocas_deleted', v_count_dev));
  RETURN jsonb_build_object('ok', true, 'deleted', v_count + v_count_dev);
END;
$f_cf$;
GRANT EXECUTE ON FUNCTION public.admin_clear_financeiro() TO authenticated;

-- Editar pedido que voltou do estoque: tudo numa transação só (libera a
-- reserva antiga, troca os itens, reserva de novo e volta para "pendente").
CREATE OR REPLACE FUNCTION public.editar_pedido_retorno(p_pedido_id uuid, p_itens jsonb, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_epr$
DECLARE v_ped record; v_uid uuid := auth.uid(); v_it jsonb; v_upd integer; v_nome text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;
  SELECT * INTO v_ped FROM public.pedidos_comerciais WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado.'); END IF;
  IF NOT (public.get_my_role() IN ('admin') OR public.eh_gerente() OR v_ped.vendedora_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão para editar este pedido.');
  END IF;
  IF v_ped.status NOT IN ('retorno','pendente') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Só pedidos pendentes ou devolvidos pelo estoque podem ser editados.');
  END IF;
  IF jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'O pedido precisa ter ao menos 1 peça.');
  END IF;
  -- 1. libera reservas atuais
  UPDATE public.stock_items si SET quantity_reserved = GREATEST(0, si.quantity_reserved - pi.quantidade_reservada)
  FROM public.pedido_itens pi WHERE pi.pedido_id = p_pedido_id AND pi.stock_item_id = si.id;
  -- 2. troca os itens
  DELETE FROM public.pedido_itens WHERE pedido_id = p_pedido_id;
  FOR v_it IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    IF COALESCE((v_it->>'quantidade')::int, 0) <= 0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;
    UPDATE public.stock_items SET quantity_reserved = quantity_reserved + (v_it->>'quantidade')::int
    WHERE id = (v_it->>'stock_item_id')::uuid AND quantity - quantity_reserved >= (v_it->>'quantidade')::int;
    GET DIAGNOSTICS v_upd = ROW_COUNT;
    IF v_upd = 0 THEN
      SELECT d.model INTO v_nome FROM public.stock_items s JOIN public.devices d ON d.id = s.device_id WHERE s.id = (v_it->>'stock_item_id')::uuid;
      RAISE EXCEPTION 'Estoque insuficiente para %', COALESCE(v_nome, 'uma das peças') USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.pedido_itens (pedido_id, stock_item_id, lote, quantidade, quantidade_reservada, valor_unitario)
    VALUES (p_pedido_id, (v_it->>'stock_item_id')::uuid, NULLIF(v_it->>'lote', ''), (v_it->>'quantidade')::int,
            (v_it->>'quantidade')::int, GREATEST(0, COALESCE((v_it->>'valor_unitario')::numeric, 0)));
  END LOOP;
  -- 3. cabeçalho
  UPDATE public.pedidos_comerciais SET
    status = 'pendente', lotes_separados = NULL,
    desconto_pct = LEAST(100, GREATEST(0, COALESCE((p_dados->>'desconto_pct')::numeric, 0))),
    frete = GREATEST(0, COALESCE((p_dados->>'frete')::numeric, 0)),
    observacoes = NULLIF(p_dados->>'observacoes', ''), prazo_entrega = NULLIF(p_dados->>'prazo_entrega', '')::date,
    forma_pagamento = NULLIF(p_dados->>'forma_pagamento', ''), parcelas = GREATEST(1, COALESCE((p_dados->>'parcelas')::int, 1)),
    endereco_entrega = NULLIF(p_dados->>'endereco_entrega', ''),
    usar_endereco_cliente = COALESCE((p_dados->>'usar_endereco_cliente')::boolean, true)
  WHERE id = p_pedido_id;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$f_epr$;
REVOKE EXECUTE ON FUNCTION public.editar_pedido_retorno(uuid, jsonb, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.editar_pedido_retorno(uuid, jsonb, jsonb) TO authenticated;

-- ── R13c. Pedido de venda atômico, desconto máximo no banco, mescla de clientes

ALTER TABLE public.pedidos_comerciais ADD COLUMN IF NOT EXISTS credito_aplicado numeric(14,2) NOT NULL DEFAULT 0;

-- Desconto máximo por peça garantido no banco (a tela já limita; aqui ninguém
-- contorna pela API). Admin, gerente e financeiro podem exceder.
CREATE OR REPLACE FUNCTION public.pedido_itens_desconto_maximo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_pdm$
DECLARE v_preco numeric; v_max numeric; v_modelo text; v_min numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.valor_unitario IS NOT DISTINCT FROM OLD.valor_unitario
     AND NEW.stock_item_id IS NOT DISTINCT FROM OLD.stock_item_id THEN RETURN NEW; END IF;
  IF current_setting('app.fiscal', true) = 'on' THEN RETURN NEW; END IF;
  IF COALESCE(public.get_my_role(), '') IN ('admin','financeiro','gerente') THEN RETURN NEW; END IF;
  SELECT d.preco_venda, d.desconto_max_pct, d.model INTO v_preco, v_max, v_modelo
  FROM public.stock_items s JOIN public.devices d ON d.id = s.device_id WHERE s.id = NEW.stock_item_id;
  IF COALESCE(v_preco, 0) <= 0 THEN RETURN NEW; END IF;
  v_min := round(v_preco * (1 - COALESCE(v_max, 0) / 100.0), 2);
  IF COALESCE(NEW.valor_unitario, 0) < v_min - 0.01 THEN
    RAISE EXCEPTION 'Desconto acima do permitido para % (máximo %, preço mínimo R$ %).',
      COALESCE(v_modelo, 'a peça'), COALESCE(v_max, 0)::text || '%', replace(to_char(v_min, 'FM999999990.00'), '.', ',') USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$f_pdm$;
DROP TRIGGER IF EXISTS trg_pedido_itens_desconto_maximo ON public.pedido_itens;
CREATE TRIGGER trg_pedido_itens_desconto_maximo BEFORE INSERT OR UPDATE ON public.pedido_itens
  FOR EACH ROW EXECUTE FUNCTION public.pedido_itens_desconto_maximo();

-- Consome crédito de devolução do cliente (usado dentro das funções abaixo).
CREATE OR REPLACE FUNCTION public._consumir_credito(p_cliente_id uuid, p_valor numeric, p_pedido_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_cc2$
DECLARE v_rest numeric := round(COALESCE(p_valor, 0), 2); v_c record; v_usa numeric;
BEGIN
  IF v_rest <= 0 THEN RETURN 0; END IF;
  FOR v_c IN
    SELECT cf.id, cf.valor FROM public.contas_financeiras cf
    JOIN public.pedidos_comerciais pc ON pc.id = cf.pedido_id
    WHERE pc.cliente_id = p_cliente_id AND cf.categoria = 'credito_devolucao_cliente' AND cf.status IN ('aberto','vencido')
    ORDER BY cf.data_emissao, cf.created_at FOR UPDATE OF cf
  LOOP
    EXIT WHEN v_rest <= 0;
    v_usa := LEAST(v_c.valor, v_rest);
    IF v_usa >= v_c.valor THEN
      UPDATE public.contas_financeiras SET status = 'pago', data_pagamento = CURRENT_DATE, valor_pago = v_c.valor,
        observacoes = COALESCE(observacoes || ' | ', '') || 'Usado no pedido ' || p_pedido_id::text WHERE id = v_c.id;
    ELSE
      UPDATE public.contas_financeiras SET valor = valor - v_usa,
        observacoes = COALESCE(observacoes || ' | ', '') || 'Uso parcial (R$ ' || v_usa::text || ') no pedido ' || p_pedido_id::text WHERE id = v_c.id;
    END IF;
    v_rest := v_rest - v_usa;
  END LOOP;
  IF v_rest > 0.009 THEN RAISE EXCEPTION 'Cliente não tem crédito suficiente para esse valor.' USING ERRCODE = 'P0001'; END IF;
  RETURN round(p_valor, 2);
END;
$f_cc2$;
REVOKE EXECUTE ON FUNCTION public._consumir_credito(uuid, numeric, uuid) FROM anon, authenticated, PUBLIC;

-- Cria o pedido inteiro numa transação: cabeçalho, itens, reservas e crédito.
-- Se qualquer passo falhar (estoque, desconto, crédito), nada fica gravado.
CREATE OR REPLACE FUNCTION public.criar_pedido_venda(p_cliente_id uuid, p_itens jsonb, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_cpv$
DECLARE v_uid uuid := auth.uid(); v_nome text; v_id uuid; v_it jsonb; v_upd integer; v_mod text; v_cred numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;
  IF COALESCE(public.get_my_role(), '') NOT IN ('admin','comercial') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão para criar pedidos.');
  END IF;
  IF jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Adicione ao menos uma peça.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cliente não encontrado.');
  END IF;
  SELECT COALESCE(display_name, 'Vendedora') INTO v_nome FROM public.profiles WHERE user_id = v_uid;
  INSERT INTO public.pedidos_comerciais (cliente_id, vendedora_id, vendedora_nome, status, observacoes, desconto_pct, frete,
    prazo_entrega, forma_pagamento, parcelas, endereco_entrega, usar_endereco_cliente)
  VALUES (p_cliente_id, v_uid, COALESCE(v_nome, 'Vendedora'), 'pendente', NULLIF(p_dados->>'observacoes', ''),
    LEAST(100, GREATEST(0, COALESCE((p_dados->>'desconto_pct')::numeric, 0))), GREATEST(0, COALESCE((p_dados->>'frete')::numeric, 0)),
    NULLIF(p_dados->>'prazo_entrega', '')::date, NULLIF(p_dados->>'forma_pagamento', ''),
    CASE WHEN p_dados->>'forma_pagamento' IN ('boleto','cartao_credito') THEN GREATEST(1, COALESCE((p_dados->>'parcelas')::int, 1)) ELSE 1 END,
    NULLIF(p_dados->>'endereco_entrega', ''), COALESCE((p_dados->>'usar_endereco_cliente')::boolean, true))
  RETURNING id INTO v_id;
  FOR v_it IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    IF COALESCE((v_it->>'quantidade')::int, 0) <= 0 THEN RAISE EXCEPTION 'Quantidade inválida.' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.stock_items SET quantity_reserved = quantity_reserved + (v_it->>'quantidade')::int
    WHERE id = (v_it->>'stock_item_id')::uuid AND quantity - quantity_reserved >= (v_it->>'quantidade')::int;
    GET DIAGNOSTICS v_upd = ROW_COUNT;
    IF v_upd = 0 THEN
      SELECT d.model INTO v_mod FROM public.stock_items s JOIN public.devices d ON d.id = s.device_id WHERE s.id = (v_it->>'stock_item_id')::uuid;
      RAISE EXCEPTION 'Estoque insuficiente para %', COALESCE(v_mod, 'uma das peças') USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.pedido_itens (pedido_id, stock_item_id, lote, quantidade, quantidade_reservada, valor_unitario)
    VALUES (v_id, (v_it->>'stock_item_id')::uuid, NULLIF(v_it->>'lote', ''), (v_it->>'quantidade')::int,
            (v_it->>'quantidade')::int, GREATEST(0, round(COALESCE((v_it->>'valor_unitario')::numeric, 0), 4)));
  END LOOP;
  v_cred := COALESCE((p_dados->>'credito')::numeric, 0);
  IF v_cred > 0 THEN
    v_cred := public._consumir_credito(p_cliente_id, v_cred, v_id);
    UPDATE public.pedidos_comerciais SET credito_aplicado = v_cred,
      observacoes = COALESCE(observacoes || ' — ', '') || 'Crédito de devolução aplicado: R$ ' || replace(to_char(v_cred, 'FM999999990.00'), '.', ',')
    WHERE id = v_id;
  END IF;
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (v_uid, COALESCE(v_nome, '—'), 'criar_pedido', 'pedido_comercial', v_id, jsonb_build_object('itens', jsonb_array_length(p_itens), 'credito', v_cred));
  RETURN jsonb_build_object('ok', true, 'pedido_id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$f_cpv$;
REVOKE EXECUTE ON FUNCTION public.criar_pedido_venda(uuid, jsonb, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.criar_pedido_venda(uuid, jsonb, jsonb) TO authenticated;

-- Adicionar peça a pedido pendente (item + reserva juntos).
CREATE OR REPLACE FUNCTION public.adicionar_item_pedido(p_pedido_id uuid, p_stock_item_id uuid, p_quantidade integer, p_valor_unitario numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_aip$
DECLARE v_ped record; v_uid uuid := auth.uid(); v_upd integer;
BEGIN
  SELECT * INTO v_ped FROM public.pedidos_comerciais WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado.'); END IF;
  IF NOT (COALESCE(public.get_my_role(), '') IN ('admin') OR public.eh_gerente() OR v_ped.vendedora_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão para editar este pedido.');
  END IF;
  IF v_ped.status <> 'pendente' THEN RETURN jsonb_build_object('ok', false, 'error', 'Só pedidos pendentes aceitam novas peças.'); END IF;
  IF COALESCE(p_quantidade, 0) <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'Quantidade inválida.'); END IF;
  UPDATE public.stock_items SET quantity_reserved = quantity_reserved + p_quantidade
  WHERE id = p_stock_item_id AND quantity - quantity_reserved >= p_quantidade;
  GET DIAGNOSTICS v_upd = ROW_COUNT;
  IF v_upd = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'Estoque insuficiente.'); END IF;
  INSERT INTO public.pedido_itens (pedido_id, stock_item_id, lote, quantidade, quantidade_reservada, valor_unitario)
  VALUES (p_pedido_id, p_stock_item_id, NULL, p_quantidade, p_quantidade, GREATEST(0, round(COALESCE(p_valor_unitario, 0), 4)));
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$f_aip$;
REVOKE EXECUTE ON FUNCTION public.adicionar_item_pedido(uuid, uuid, integer, numeric) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.adicionar_item_pedido(uuid, uuid, integer, numeric) TO authenticated;

-- Mesclar clientes duplicados (admin/gerente): move pedidos e rastreabilidade
-- para o cadastro mantido, completa os campos vazios e apaga o duplicado.
CREATE OR REPLACE FUNCTION public.mesclar_clientes(p_manter uuid, p_remover uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_mc$
DECLARE v_m record; v_r record; v_ped integer; v_uid uuid := auth.uid();
BEGIN
  IF NOT (COALESCE(public.get_my_role(), '') = 'admin' OR public.eh_gerente()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Somente administrador ou gerente.');
  END IF;
  IF p_manter = p_remover THEN RETURN jsonb_build_object('ok', false, 'error', 'Escolha dois cadastros diferentes.'); END IF;
  SELECT * INTO v_m FROM public.clientes WHERE id = p_manter FOR UPDATE;
  SELECT * INTO v_r FROM public.clientes WHERE id = p_remover FOR UPDATE;
  IF v_m.id IS NULL OR v_r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Cliente não encontrado.'); END IF;
  PERFORM set_config('app.fiscal', 'on', true);  -- permite trocar o cliente de pedidos já faturados (mesmo cliente, cadastro duplicado)
  UPDATE public.pedidos_comerciais SET cliente_id = p_manter WHERE cliente_id = p_remover;
  GET DIAGNOSTICS v_ped = ROW_COUNT;
  UPDATE public.rastreabilidade_pos_venda SET cliente_id = p_manter, cliente_nome = v_m.nome WHERE cliente_id = p_remover;
  PERFORM set_config('app.fiscal', 'off', true);
  DELETE FROM public.clientes WHERE id = p_remover;
  UPDATE public.clientes SET
    documento = COALESCE(NULLIF(documento, ''), v_r.documento), ie = COALESCE(NULLIF(ie, ''), v_r.ie),
    telefone = COALESCE(NULLIF(telefone, ''), v_r.telefone), email = COALESCE(NULLIF(email, ''), v_r.email),
    cep = COALESCE(NULLIF(cep, ''), v_r.cep), logradouro = COALESCE(NULLIF(logradouro, ''), v_r.logradouro),
    numero = COALESCE(NULLIF(numero, ''), v_r.numero), bairro = COALESCE(NULLIF(bairro, ''), v_r.bairro),
    municipio = COALESCE(NULLIF(municipio, ''), v_r.municipio), uf = COALESCE(NULLIF(uf, ''), v_r.uf),
    c_mun = COALESCE(NULLIF(c_mun, ''), v_r.c_mun), endereco = COALESCE(NULLIF(endereco, ''), v_r.endereco),
    observacoes = CASE WHEN v_r.observacoes IS NULL OR v_r.observacoes = '' THEN observacoes
                       ELSE COALESCE(observacoes || E'\n', '') || v_r.observacoes END
  WHERE id = p_manter;
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (v_uid, COALESCE((SELECT display_name FROM public.profiles WHERE user_id = v_uid), '—'), 'mesclar_clientes', 'cliente', p_manter,
          jsonb_build_object('removido', p_remover, 'nome_removido', v_r.nome, 'pedidos_movidos', v_ped));
  RETURN jsonb_build_object('ok', true, 'pedidos_movidos', v_ped);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$f_mc$;
REVOKE EXECUTE ON FUNCTION public.mesclar_clientes(uuid, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mesclar_clientes(uuid, uuid) TO authenticated;

-- Registrar NF-e externa: valor muito diferente do pedido exige confirmação.
CREATE OR REPLACE FUNCTION public.valor_pedido(p_pedido_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f_vp$
  SELECT round(COALESCE((SELECT SUM(quantidade * valor_unitario) FROM public.pedido_itens WHERE pedido_id = p_pedido_id), 0)
         + COALESCE((SELECT frete FROM public.pedidos_comerciais WHERE id = p_pedido_id), 0), 2)
$f_vp$;
REVOKE EXECUTE ON FUNCTION public.valor_pedido(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.valor_pedido(uuid) TO authenticated;

-- Catálogo de venda: TODAS as peças cadastradas (Componentes) com o saldo real
-- na expedição. Antes o Comercial usava a lista do Estoque, limitada a 500
-- linhas de todas as fases — peças ficavam de fora da busca do novo pedido.
CREATE OR REPLACE FUNCTION public.catalogo_venda()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $f_cv$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND approved AND NOT COALESCE(blocked, false)) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'device_id', d.id, 'model', d.model, 'reference', d.reference, 'internal_code', d.internal_code,
      'preco_venda', d.preco_venda, 'desconto_max_pct', d.desconto_max_pct, 'unidade', d.unidade,
      'stock_item_id', e.id, 'disponivel', COALESCE(e.disp, 0), 'disponivel_total', COALESCE(e.total, 0),
      'em_producao', COALESCE(i.qtd, 0)
    ) ORDER BY d.model, d.reference)
    FROM public.devices d
    LEFT JOIN LATERAL (
      SELECT si.id, GREATEST(si.quantity - si.quantity_reserved, 0) AS disp,
             SUM(GREATEST(si.quantity - si.quantity_reserved, 0)) OVER () AS total
      FROM public.stock_items si
      WHERE si.device_id = d.id AND si.fase = 'expedicao'
      ORDER BY si.quantity - si.quantity_reserved DESC, si.updated_at DESC
      LIMIT 1
    ) e ON true
    LEFT JOIN LATERAL (
      SELECT SUM(si.quantity) AS qtd FROM public.stock_items si
      WHERE si.device_id = d.id AND si.fase IN ('intermediaria', 'retrabalho')
    ) i ON true
    WHERE COALESCE(d.ativo, true)
  ), '[]'::jsonb);
END;
$f_cv$;
REVOKE EXECUTE ON FUNCTION public.catalogo_venda() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalogo_venda() TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- R15. Estoque e Qualidade — permissões da reformulação
-- ═════════════════════════════════════════════════════════════════════════════
-- Estoque: perfil "gerente" (= tudo menos admin) também pode gravar no estoque.
-- Hoje can_write_stock() só aceita admin/estoque/comercial, então o gerente vê os
-- botões (temPapel libera) mas o servidor recusa entradas, saídas e ajustes.
CREATE OR REPLACE FUNCTION public.can_write_stock()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f_cws$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = (SELECT auth.uid())
      AND role IN ('admin', 'estoque', 'comercial', 'gerente')
  )
$f_cws$;
GRANT EXECUTE ON FUNCTION public.can_write_stock() TO authenticated;

-- Opcional (rastreabilidade): cancel_movement APAGA a movimentação. O front não
-- usa mais essa RPC (correção agora é por estorno). Para impedir uso direto:
REVOKE EXECUTE ON FUNCTION public.cancel_movement(uuid, uuid) FROM authenticated;


-- 1) Qualidade/Gerente editarem SÓ os campos regulatórios de devices
--    (a policy devices_admin_update libera apenas admin/financeiro).
--    O front já chama esta RPC para perfis não-admin e mostra aviso claro se ela não existir.
CREATE OR REPLACE FUNCTION public.qualidade_atualizar_regularizacao(p_device_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fq1$
DECLARE
  v_role text := public.get_my_role();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'gerente', 'qualidade') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão para alterar a regularização.');
  END IF;
  IF p_dados->>'status_regularizacao' IS NOT NULL
     AND p_dados->>'status_regularizacao' NOT IN ('pendente','em_processo','notificado','registrado','cancelado') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Situação inválida.');
  END IF;

  UPDATE public.devices SET
    empresa_lf             = COALESCE((p_dados->>'empresa_lf')::boolean, empresa_lf),
    empresa_afe            = COALESCE((p_dados->>'empresa_afe')::boolean, empresa_afe),
    empresa_bpf            = COALESCE((p_dados->>'empresa_bpf')::boolean, empresa_bpf),
    risk_class             = COALESCE(p_dados->>'risk_class', risk_class),
    classification_code    = COALESCE(p_dados->>'classification_code', classification_code),
    status_regularizacao   = COALESCE(p_dados->>'status_regularizacao', status_regularizacao),
    anvisa_registration    = CASE WHEN p_dados ? 'anvisa_registration' THEN NULLIF(p_dados->>'anvisa_registration', '') ELSE anvisa_registration END,
    numero_processo_anvisa = CASE WHEN p_dados ? 'numero_processo_anvisa' THEN NULLIF(p_dados->>'numero_processo_anvisa', '') ELSE numero_processo_anvisa END,
    data_registro_anvisa   = CASE WHEN p_dados ? 'data_registro_anvisa' THEN NULLIF(p_dados->>'data_registro_anvisa', '')::date ELSE data_registro_anvisa END,
    data_vencimento_anvisa = CASE WHEN p_dados ? 'data_vencimento_anvisa' THEN NULLIF(p_dados->>'data_vencimento_anvisa', '')::date ELSE data_vencimento_anvisa END,
    udi_di                 = CASE WHEN p_dados ? 'udi_di' THEN NULLIF(p_dados->>'udi_di', '') ELSE udi_di END,
    gtin                   = CASE WHEN p_dados ? 'gtin' THEN NULLIF(p_dados->>'gtin', '') ELSE gtin END,
    rotulo_udi_ok          = COALESCE((p_dados->>'rotulo_udi_ok')::boolean, rotulo_udi_ok),
    siud_transmitido_em    = CASE WHEN p_dados ? 'siud_transmitido_em' THEN NULLIF(p_dados->>'siud_transmitido_em', '')::timestamptz ELSE siud_transmitido_em END
  WHERE id = p_device_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Peça não encontrada.');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$fq1$;
REVOKE ALL ON FUNCTION public.qualidade_atualizar_regularizacao(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.qualidade_atualizar_regularizacao(uuid, jsonb) TO authenticated;

-- 2) Perfil gerente também pode atualizar status de recall/destino clínico
--    (hoje rastr_write só aceita admin/qualidade/comercial; o front detecta 0 linhas e avisa).
DROP POLICY IF EXISTS "rastr_write" ON public.rastreabilidade_pos_venda;
CREATE POLICY "rastr_write" ON public.rastreabilidade_pos_venda FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin','gerente','qualidade','comercial'))
  WITH CHECK (public.get_my_role() IN ('admin','gerente','qualidade','comercial'));

-- ═════════════════════════════════════════════════════════════════════════════
-- R16. Perfis de usuário — corrige "infinite recursion detected in policy"
-- A policy profiles_own_update consultava a própria tabela profiles; o Postgres
-- recusava QUALQUER update em profiles (bloquear, aprovar, trocar nome, tema).
-- A proteção dos campos sensíveis passa para um trigger.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.profiles_protege_campos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f_ppc$
BEGIN
  -- Sem usuário (service role, SQL editor, funções do servidor): livre.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(auth.uid(), 'admin') THEN
    IF NEW.user_id = auth.uid() AND COALESCE(NEW.blocked, false) AND NOT COALESCE(OLD.blocked, false) THEN
      RAISE EXCEPTION 'Você não pode bloquear a si mesmo.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.approved IS DISTINCT FROM OLD.approved
     OR NEW.blocked  IS DISTINCT FROM OLD.blocked
     OR NEW.email    IS DISTINCT FROM OLD.email
     OR NEW.login    IS DISTINCT FROM OLD.login THEN
    RAISE EXCEPTION 'Sem permissão para alterar aprovação, bloqueio, e-mail ou login.';
  END IF;
  RETURN NEW;
END;
$f_ppc$;
REVOKE EXECUTE ON FUNCTION public.profiles_protege_campos() FROM anon, PUBLIC;
DROP TRIGGER IF EXISTS profiles_protege_campos ON public.profiles;
CREATE TRIGGER profiles_protege_campos BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_protege_campos();

DROP POLICY IF EXISTS "profiles_own_update" ON public.profiles;
CREATE POLICY "profiles_own_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- R14. PERFIL "GERENTE" — tudo menos Admin
-- ═════════════════════════════════════════════════════════════════════════════
-- Recebe as permissões de TODOS os perfis operacionais (estoque, qualidade,
-- comercial, financeiro, produção, processos). Não recebe nada que seja só
-- do admin (usuários, limpezas de histórico, configurações de sistema,
-- ativação do emissor fiscal).
-- Como funciona (idempotente — deve ficar SEMPRE no fim deste arquivo):
--  1. Políticas RLS que citam algum perfil operacional ganham "OR eh_gerente()".
--  2. Funções que checam "IN ('admin','financeiro'...)" ganham 'gerente' na lista.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'gerente';

CREATE OR REPLACE FUNCTION public.eh_gerente()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f_eg$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role::text = 'gerente')
$f_eg$;
REVOKE EXECUTE ON FUNCTION public.eh_gerente() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.eh_gerente() TO authenticated;

DO $f_ger$
DECLARE
  r record; def text; novo text; lista text; m text[];
  v_ops constant text := '''(estoque|qualidade|comercial|financeiro|producao|processos)''';
  v_cmd text;
BEGIN
  PERFORM set_config('check_function_bodies', 'off', true);

  -- 1. Políticas
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname IN ('public','storage')
      AND (COALESCE(qual,'') || ' ' || COALESCE(with_check,'')) ~ v_ops
      AND (COALESCE(qual,'') || ' ' || COALESCE(with_check,'')) !~ 'eh_gerente'
  LOOP
    v_cmd := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    IF r.qual IS NOT NULL AND r.cmd <> 'INSERT' THEN
      v_cmd := v_cmd || format(' USING ((%s) OR public.eh_gerente())', r.qual);
    END IF;
    IF r.with_check IS NOT NULL AND r.cmd IN ('INSERT','UPDATE','ALL') THEN
      v_cmd := v_cmd || format(' WITH CHECK ((%s) OR public.eh_gerente())', r.with_check);
    END IF;
    IF v_cmd <> format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename) THEN
      EXECUTE v_cmd;
    END IF;
  END LOOP;

  -- 2. Funções com listas de perfis
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname NOT IN ('handle_new_user','eh_gerente')
      AND p.prosrc ~* ('IN\s*\([^)]*' || v_ops)
  LOOP
    def := pg_get_functiondef(r.oid);
    novo := def;
    FOR m IN SELECT regexp_matches(def, '(IN\s*\(\s*''[a-z_]+''(?:\s*,\s*''[a-z_]+'')*\s*\))', 'gi') LOOP
      lista := m[1];
      IF lista ~ v_ops AND lista !~ 'gerente' THEN
        novo := replace(novo, lista, regexp_replace(lista, '\s*\)$', ',''gerente'')'));
      END IF;
    END LOOP;
    IF novo <> def THEN EXECUTE novo; END IF;
  END LOOP;

  -- 3. Checagens "admin OU dono do pedido" (cancelar pedido, remover peça)
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosrc ~ 'NOT public\.is_admin_user\(\) AND'
  LOOP
    def := pg_get_functiondef(r.oid);
    EXECUTE replace(def, 'NOT public.is_admin_user() AND', 'NOT (public.is_admin_user() OR public.eh_gerente()) AND');
  END LOOP;
END;
$f_ger$;
