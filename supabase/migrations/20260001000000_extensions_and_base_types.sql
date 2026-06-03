-- =============================================================================
-- 001: Extensões e tipos base
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enum de papéis do sistema
-- Roles: admin, estoque, qualidade, comercial, financeiro, producao
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.app_role AS ENUM (
      'admin',
      'estoque',
      'qualidade',
      'comercial',
      'financeiro',
      'producao'
    );
  END IF;
END $$;
