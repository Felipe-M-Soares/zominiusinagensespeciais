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

-- ── DROP explícito antes de recriar (evita erro 42P13) ───────────────────────
-- O erro "cannot change return type of existing function" ocorre quando a função
-- já existe com assinatura diferente. DROP IF EXISTS garante idempotência.
DROP FUNCTION IF EXISTS public.cleanup_rate_limit_log();

-- ── Função de limpeza do rate_limit_log ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_log()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.rate_limit_log
  WHERE created_at < now() - INTERVAL '5 minutes';
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_log() TO authenticated;

-- ── Índice para cleanup eficiente ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rate_limit_created_at
  ON public.rate_limit_log (created_at ASC);

-- ── Tenta criar jobs via pg_cron se estiver disponível ───────────────────────
DO $cron01$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN

    -- Remove jobs antigos se existirem (idempotente)
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup_audit_log_daily') THEN
      PERFORM cron.unschedule('cleanup_audit_log_daily');
    END IF;

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup_rate_limit_log_hourly') THEN
      PERFORM cron.unschedule('cleanup_rate_limit_log_hourly');
    END IF;

    -- Limpeza do audit_log: todo dia às 2h (mantém 90 dias)
    PERFORM cron.schedule(
      'cleanup_audit_log_daily',
      '0 2 * * *',
      'SELECT public.cleanup_audit_log()'
    );

    -- Limpeza do rate_limit_log: a cada hora
    PERFORM cron.schedule(
      'cleanup_rate_limit_log_hourly',
      '0 * * * *',
      'SELECT public.cleanup_rate_limit_log()'
    );

    RAISE NOTICE 'Jobs pg_cron criados com sucesso';

  ELSE
    RAISE NOTICE 'pg_cron não instalado. Configure manualmente em Dashboard → Database → Cron Jobs';
    RAISE NOTICE 'Job 1: Schedule "0 2 * * *"  → SELECT public.cleanup_audit_log()';
    RAISE NOTICE 'Job 2: Schedule "0 * * * *"  → SELECT public.cleanup_rate_limit_log()';
  END IF;

EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Erro ao criar cron jobs: %. Configure manualmente.', SQLERRM;
END $cron01$;

COMMENT ON FUNCTION public.cleanup_audit_log() IS
  'Remove registros de audit_log com mais de 90 dias. Executado diariamente às 2h via pg_cron.';

COMMENT ON FUNCTION public.cleanup_rate_limit_log() IS
  'Remove registros de rate_limit_log com mais de 5 minutos. Executado a cada hora via pg_cron.';
