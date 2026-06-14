-- =============================================================================
-- PERF-03: Configuração automática de limpeza de tabelas de log
-- =============================================================================

-- ── DROP do trigger dependente ANTES de dropar a função ──────────────────────
-- Erro 2BP01: "cannot drop function because other objects depend on it"
-- O trigger trg_cleanup_rate_limit usa esta função — precisa ser removido primeiro.
-- Em seguida recriamos o trigger apontando para a nova função.
DROP TRIGGER IF EXISTS trg_cleanup_rate_limit ON public.rate_limit_log;
DROP FUNCTION IF EXISTS public.cleanup_rate_limit_log();

-- ── Recria a função de limpeza do rate_limit_log ──────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.rate_limit_log
  WHERE created_at < now() - INTERVAL '5 minutes';
  RETURN NULL;
END;
$$;

-- ── Recria o trigger (AFTER INSERT, FOR EACH STATEMENT) ───────────────────────
CREATE TRIGGER trg_cleanup_rate_limit
  AFTER INSERT ON public.rate_limit_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.cleanup_rate_limit_log();

GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_log() TO authenticated;

-- ── Índice para cleanup eficiente ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rate_limit_created_at
  ON public.rate_limit_log (created_at ASC);

-- ── Tenta criar jobs via pg_cron se estiver disponível ───────────────────────
DO $cron01$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup_audit_log_daily') THEN
      PERFORM cron.unschedule('cleanup_audit_log_daily');
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup_rate_limit_log_hourly') THEN
      PERFORM cron.unschedule('cleanup_rate_limit_log_hourly');
    END IF;

    PERFORM cron.schedule(
      'cleanup_audit_log_daily',
      '0 2 * * *',
      'SELECT public.cleanup_audit_log()'
    );
    PERFORM cron.schedule(
      'cleanup_rate_limit_log_hourly',
      '0 * * * *',
      'SELECT public.cleanup_rate_limit_log()'
    );

    RAISE NOTICE 'Jobs pg_cron criados com sucesso';
  ELSE
    RAISE NOTICE 'pg_cron não instalado. Configure manualmente em Dashboard → Database → Cron Jobs';
    RAISE NOTICE 'Job 1: Schedule "0 2 * * *" → SELECT public.cleanup_audit_log()';
    RAISE NOTICE 'Job 2: Schedule "0 * * * *" → SELECT public.cleanup_rate_limit_log()';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Erro ao criar cron jobs: %. Configure manualmente.', SQLERRM;
END $cron01$;

COMMENT ON FUNCTION public.cleanup_rate_limit_log() IS
  'Trigger AFTER INSERT na rate_limit_log: remove entradas > 5 min. Também chamada pelo pg_cron a cada hora.';
COMMENT ON FUNCTION public.cleanup_audit_log() IS
  'Remove registros de audit_log com mais de 90 dias. Executado diariamente às 2h via pg_cron.';
