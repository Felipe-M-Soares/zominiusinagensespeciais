-- =============================================================================
-- 007: Índices de performance
-- =============================================================================

CREATE INDEX IF NOT EXISTS profiles_user_id_approved_blocked_idx ON public.profiles (user_id, approved, blocked);
CREATE INDEX IF NOT EXISTS profiles_email_idx   ON public.profiles (email);
CREATE INDEX IF NOT EXISTS profiles_login_idx   ON public.profiles (login) WHERE login IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_roles_user_id_idx ON public.user_roles (user_id);
CREATE INDEX IF NOT EXISTS devices_model_idx    ON public.devices (model);
CREATE INDEX IF NOT EXISTS devices_model_trgm_idx     ON public.devices USING GIN (model gin_trgm_ops);
CREATE INDEX IF NOT EXISTS devices_reference_trgm_idx ON public.devices USING GIN (reference gin_trgm_ops);
CREATE INDEX IF NOT EXISTS devices_udi_di_trgm_idx    ON public.devices USING GIN (udi_di gin_trgm_ops);
CREATE INDEX IF NOT EXISTS devices_brand_name_trgm_idx   ON public.devices USING GIN (brand_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS devices_internal_code_trgm_idx ON public.devices USING GIN (internal_code gin_trgm_ops);

ANALYZE public.profiles;
ANALYZE public.user_roles;
ANALYZE public.devices;
