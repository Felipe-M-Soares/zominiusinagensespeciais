-- =============================================================================
-- SAÚDE DO SISTEMA — visão consolidada para o admin acompanhar
-- =============================================================================
-- Como em outras correções recentes, vai em arquivo novo (timestamp maior)
-- em vez de editar um arquivo já aplicado — ver nota em
-- 20260040000000_correcoes_pendentes.sql sobre por que isso é necessário.

CREATE OR REPLACE FUNCTION public.obter_saude_sistema()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f01$
DECLARE
  v_last_backup       timestamptz;
  v_backup_schedule   text;
  v_last_apontamento  timestamptz;
  v_audit_log_count   integer;
  v_audit_log_oldest  timestamptz;
  v_cron_jobs         jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso não autorizado.');
  END IF;

  SELECT last_backup, schedule INTO v_last_backup, v_backup_schedule
  FROM public.backup_configs LIMIT 1;

  SELECT max(created_at) INTO v_last_apontamento
  FROM public.apontamentos_producao;

  SELECT count(*), min(created_at) INTO v_audit_log_count, v_audit_log_oldest
  FROM public.audit_log;

  -- Lista os cron jobs reais (se pg_cron estiver habilitada) — confirma ao
  -- admin que o backup automático e a limpeza de audit_log estão de fato
  -- agendados, não só "deveriam estar". Se pg_cron não estiver habilitada,
  -- retorna lista vazia em vez de falhar (mesma tolerância usada nas
  -- migrations de backup automático).
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
      SELECT jsonb_agg(jsonb_build_object(
        'jobname', jobname, 'schedule', schedule, 'active', active
      )) INTO v_cron_jobs
      FROM cron.job
      WHERE jobname IN ('run_scheduled_backup_diario', 'cleanup_audit_log_diario');
    ELSE
      v_cron_jobs := '[]'::jsonb;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_cron_jobs := '[]'::jsonb;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'last_backup', v_last_backup,
    'backup_schedule', v_backup_schedule,
    'last_apontamento', v_last_apontamento,
    'audit_log_count', coalesce(v_audit_log_count, 0),
    'audit_log_oldest', v_audit_log_oldest,
    'cron_jobs', coalesce(v_cron_jobs, '[]'::jsonb),
    'checked_at', now()
  );
END;
$f01$;

GRANT EXECUTE ON FUNCTION public.obter_saude_sistema() TO authenticated;

COMMENT ON FUNCTION public.obter_saude_sistema() IS
  'Visão consolidada de saúde do sistema para o painel admin: último backup, último apontamento sincronizado, tamanho do audit_log, e se os cron jobs de manutenção estão de fato agendados. Restrita a admin.';
