-- =============================================================================
-- 001: Extensões e tipos base
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enum de papéis do sistema
CREATE TYPE public.app_role AS ENUM ('admin', 'funcionario', 'vendedora', 'financeiro');
