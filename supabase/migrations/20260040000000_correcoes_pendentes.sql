-- =============================================================================
-- CORREÇÕES PENDENTES — backup automático, Vault do token bancário, limpeza
-- =============================================================================
-- Esta migration existe porque as correções abaixo foram originalmente
-- escritas DENTRO de 20260027000000_estoque.sql e 20260029000000_seguranca.sql
-- — mas como esses dois arquivos JÁ TINHAM SIDO aplicados anteriormente (o
-- Supabase CLI rastreia migrations já feitas pelo NOME do arquivo, não pelo
-- conteúdo), o `supabase db push` nunca as reaplicou e mostrou
-- "Remote database is up to date" mesmo com correções pendentes.
--
-- A partir de agora, toda correção nova vai sempre em um arquivo com
-- timestamp novo como este, nunca editando um arquivo já aplicado.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Backup automático real via pg_cron
-- ─────────────────────────────────────────────────────────────────────────────
-- Gera o mesmo snapshot que o botão "Fazer backup agora" do frontend
-- (stock_items + devices + últimos 500 stock_movements), mas grava direto em
-- stock_backups.payload em vez de subir um arquivo no Storage — assim a
-- função roda inteiramente dentro do banco e pode ser chamada por pg_cron
-- sem precisar de service role key nem de uma Edge Function HTTP.
-- O frontend (downloadBackup em useStock.ts) já sabe ler de payload quando
-- file_path é nulo — nenhuma mudança necessária no app para isto funcionar.
CREATE OR REPLACE FUNCTION public.run_scheduled_backup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f01c$
DECLARE
  v_cfg          record;
  v_dow          int;        -- 1=segunda ... 6=sábado (ISO weekday)
  v_dias         int[];
  v_items        jsonb;
  v_movs         jsonb;
  v_item_count   int;
  v_backup_id    uuid;
  v_max_backups  int := 30;  -- retenção: mantém só os 30 mais recentes
BEGIN
  SELECT * INTO v_cfg FROM public.backup_configs LIMIT 1;
  IF v_cfg IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'backup_configs vazia — nenhum schedule definido');
  END IF;

  -- Já rodou hoje? Evita duplicar se o cron disparar mais de uma vez no dia
  -- ou se alguém também clicou em "Fazer backup agora" hoje.
  IF v_cfg.last_backup IS NOT NULL AND v_cfg.last_backup::date = now()::date THEN
    RETURN jsonb_build_object('ok', true, 'motivo', 'backup já realizado hoje, ignorando');
  END IF;

  -- Mapeia o schedule textual para os dias ISO (1=seg ... 6=sáb) em que deve rodar
  v_dias := CASE v_cfg.schedule
    WHEN 'mon_thu' THEN ARRAY[1,4]
    WHEN 'tue_fri' THEN ARRAY[2,5]
    WHEN 'wed_sat' THEN ARRAY[3,6]
    WHEN 'mon_fri' THEN ARRAY[1,5]
    ELSE ARRAY[1,4]
  END;

  v_dow := extract(isodow FROM now())::int;
  IF NOT (v_dow = ANY(v_dias)) THEN
    RETURN jsonb_build_object('ok', true, 'motivo', 'hoje não é dia de backup agendado');
  END IF;

  -- Snapshot de stock_items + device (mesmos campos que o frontend já busca)
  SELECT jsonb_agg(jsonb_build_object(
    'id', si.id, 'quantity', si.quantity, 'min_quantity', si.min_quantity,
    'location', si.location, 'notes', si.notes, 'fase', si.fase,
    'updated_at', si.updated_at,
    'device', jsonb_build_object(
      'model', d.model, 'reference', d.reference,
      'udi_di', d.udi_di, 'internal_code', d.internal_code
    )
  )), count(*)
  INTO v_items, v_item_count
  FROM public.stock_items si
  JOIN public.devices d ON d.id = si.device_id;

  -- Últimos 500 movimentos (mesmo limite usado pelo backup manual)
  SELECT jsonb_agg(jsonb_build_object(
    'id', sm.id, 'stock_item_id', sm.stock_item_id, 'type', sm.type,
    'quantity', sm.quantity, 'reason', sm.reason,
    'user_display_name', sm.user_display_name, 'created_at', sm.created_at
  ) ORDER BY sm.created_at DESC)
  INTO v_movs
  FROM (
    SELECT * FROM public.stock_movements ORDER BY created_at DESC LIMIT 500
  ) sm;

  INSERT INTO public.stock_backups (created_by, created_name, item_count, payload)
  VALUES (
    NULL, 'Backup automático (agendado)', coalesce(v_item_count, 0),
    jsonb_build_object(
      'generated_at', now(),
      'items', coalesce(v_items, '[]'::jsonb),
      'recent_movements', coalesce(v_movs, '[]'::jsonb)
    )
  )
  RETURNING id INTO v_backup_id;

  UPDATE public.backup_configs SET last_backup = now() WHERE id = v_cfg.id;

  -- Retenção: apaga backups além dos v_max_backups mais recentes (mantém o banco saudável)
  DELETE FROM public.stock_backups
  WHERE id IN (
    SELECT id FROM public.stock_backups
    ORDER BY created_at DESC
    OFFSET v_max_backups
  );

  RETURN jsonb_build_object('ok', true, 'backup_id', v_backup_id, 'item_count', v_item_count);
END;
$f01c$;

GRANT EXECUTE ON FUNCTION public.run_scheduled_backup() TO authenticated;

-- Agendamento real via pg_cron. ATENÇÃO: pg_cron exige habilitação manual
-- no Supabase hospedado (Database → Extensions → pg_cron → Enable) antes
-- de rodar esta migration — não pode ser feito por SQL comum, exige
-- superuser. Se ainda não habilitou, o bloco abaixo apenas avisa e não
-- falha a migration; rode esta migration de novo depois de habilitar.
DO $f01d$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run_scheduled_backup_diario') THEN
      PERFORM cron.unschedule('run_scheduled_backup_diario');
    END IF;
    PERFORM cron.schedule(
      'run_scheduled_backup_diario',
      '0 3 * * *',
      $job$SELECT public.run_scheduled_backup();$job$
    );
    RAISE NOTICE 'Cron job "run_scheduled_backup_diario" agendado (todo dia às 3h, roda conforme o schedule configurado).';
  ELSE
    RAISE NOTICE 'pg_cron não está habilitada — backup automático NÃO foi agendado. Habilite em Database > Extensions > pg_cron e rode esta migration de novo.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Não foi possível agendar run_scheduled_backup via pg_cron: %. Agende manualmente em Database > Cron Jobs.', SQLERRM;
END;
$f01d$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Token de integração bancária via Supabase Vault (substitui texto puro)
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
-- 3. Limpeza automática de audit_log via pg_cron
-- ─────────────────────────────────────────────────────────────────────────────
-- A função cleanup_audit_log() já existe no banco (aplicada anteriormente);
-- só o agendamento via pg_cron ficou pendente. Mesma ressalva de ativação
-- manual da extensão explicada no bloco 1 acima.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Remove admin_clear_history (versão antiga, substituída pelas funções
--    granulares admin_clear_* com auditoria — sem uso no frontend)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_clear_history();
