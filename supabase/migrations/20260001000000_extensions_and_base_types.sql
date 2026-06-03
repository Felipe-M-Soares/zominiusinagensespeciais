-- =============================================================================
-- 001: Extensões e tipos base
-- =============================================================================

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Enum de papéis do sistema
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.app_role AS ENUM ('admin', 'funcionario', 'vendedora', 'financeiro');
  END IF;
END $$;
