-- =============================================================================
-- PERF-03: Configuração automática de limpeza de tabelas de log
-- =============================================================================
--
-- OPÇÃO A (recomendado): pg_cron via Supabase
-- Requer pg_cron habilitado: Dashboard → Database → Extensions → pg_cron
--
-- OPÇÃO B: chamar manualmente via Dashboard:
--   Database → Cron Jobs → New Cron Job
--   Schedule: 0 2 * * *  (todo dia às 2h)
--   Command: SELECT public.cleanup_audit_log();
-- =============================================================================

-- ── Tenta criar jobs via pg_cron se estiver disponível ───────────────────────
DO $cron01$
BEGIN
  -- Verifica se pg_cron está instalado
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN

    -- Remove jobs antigos se existirem (idempotente)
    PERFORM cron.unschedule('cleanup_audit_log_daily')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup_audit_log_daily');

    PERFORM cron.unschedule('cleanup_rate_limit_log_hourly')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup_rate_limit_log_hourly');

    -- Limpeza do audit_log: todo dia às 2h (mantém 90 dias)
    PERFORM cron.schedule(
      'cleanup_audit_log_daily',
      '0 2 * * *',
      'SELECT public.cleanup_audit_log()'
    );

    -- Limpeza do rate_limit_log: a cada hora (já tem trigger, mas cron garante)
    PERFORM cron.schedule(
      'cleanup_rate_limit_log_hourly',
      '0 * * * *',
      'DELETE FROM public.rate_limit_log WHERE created_at < now() - interval ''5 minutes'''
    );

    RAISE NOTICE 'Jobs pg_cron criados com sucesso';

  ELSE
    RAISE NOTICE '⚠ pg_cron não está instalado. Configure manualmente:';
    RAISE NOTICE '  Dashboard → Database → Cron Jobs → New Cron Job';
    RAISE NOTICE '  Schedule: 0 2 * * * | Command: SELECT public.cleanup_audit_log();';
  END IF;

EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Erro ao criar cron jobs: %. Configure manualmente.', SQLERRM;
END $cron01$;

-- ── Função de limpeza do rate_limit_log mais agressiva (manutenção) ───────────
CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_log()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $cron02$
  DELETE FROM public.rate_limit_log
  WHERE created_at < now() - INTERVAL '5 minutes';
$cron02$;

GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_log() TO authenticated;

-- ── Índice para cleanup eficiente do audit_log ────────────────────────────────
-- Já existe idx_audit_log_created_at da migration anterior, mas garantimos aqui
CREATE INDEX IF NOT EXISTS idx_rate_limit_created_at
  ON public.rate_limit_log (created_at ASC);

COMMENT ON FUNCTION public.cleanup_audit_log() IS
  'Remove registros de audit_log com mais de 90 dias. Executado diariamente às 2h via pg_cron.';

COMMENT ON FUNCTION public.cleanup_rate_limit_log() IS
  'Remove registros de rate_limit_log com mais de 5 minutos. Executado a cada hora via pg_cron.';
