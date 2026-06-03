CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.rate_limit_log
  WHERE created_at < now() - interval '5 minutes';
  RETURN NULL;
END; $$;
