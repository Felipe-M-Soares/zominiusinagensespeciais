-- =============================================================================
-- BASE — Extensões, tipos, tabelas core (users/devices/roles), funções auxiliares
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 20260001000000_extensions_and_base_types.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enum de papéis do sistema
-- Roles: admin, estoque, qualidade, comercial, financeiro, producao
DO $f01$ BEGIN
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
END $f01$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260002000000_core_tables_users_devices.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Tabela de papéis ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_roles (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role    app_role NOT NULL DEFAULT 'estoque',
  UNIQUE (user_id)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ── Perfis ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  display_name         text,
  email                text,
  login                text,
  approved             boolean NOT NULL DEFAULT true,
  blocked              boolean NOT NULL DEFAULT false,
  must_change_password boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_login_unique
  ON public.profiles (lower(login)) WHERE login IS NOT NULL;

-- ── Dispositivos ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.devices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  udi_di                text NOT NULL UNIQUE,
  model                 text NOT NULL,
  reference             text NOT NULL,
  internal_code         text NOT NULL,
  anvisa_registration   text NOT NULL,
  primary_material      text NOT NULL,
  secondary_material    text,
  surface_treatment     text,
  classification_code   text NOT NULL,
  risk_class            text NOT NULL,
  sterile               boolean NOT NULL DEFAULT false,
  single_use            boolean NOT NULL DEFAULT false,
  implantable           boolean NOT NULL DEFAULT true,
  intended_use          text NOT NULL,
  body_region           text NOT NULL,
  compatible_systems    jsonb DEFAULT '[]'::jsonb,
  icon_url              text,
  brand_name            text NOT NULL DEFAULT '',
  manufacturer_country  text NOT NULL DEFAULT '',
  exocad_compatibility  text NOT NULL DEFAULT '',
  -- Campos financeiros / NF-e
  preco_venda           numeric(14,2) NOT NULL DEFAULT 0,
  preco_custo           numeric(14,2) NOT NULL DEFAULT 0,
  desconto_max_pct      integer NOT NULL DEFAULT 0 CHECK (desconto_max_pct BETWEEN 0 AND 100),
  margem_minima_pct     integer NOT NULL DEFAULT 0 CHECK (margem_minima_pct BETWEEN 0 AND 100),
  ncm                   text NOT NULL DEFAULT '90213990',
  cfop_padrao           text NOT NULL DEFAULT '5102',
  unidade               text NOT NULL DEFAULT 'UN',
  ativo                 boolean NOT NULL DEFAULT true,
  observacoes_preco     text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

-- ── Contatos ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  contact    text NOT NULL,
  location   text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

-- ── Manuais ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.manuals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text DEFAULT '',
  file_path   text NOT NULL,
  file_size   bigint DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manuals ENABLE ROW LEVEL SECURITY;

-- ── Catálogos ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.catalogs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  file_path   text NOT NULL,
  file_size   bigint DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.catalogs ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260003000000_helper_functions.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── updated_at genérico ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $f01$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$f01$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $f02$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$f02$;

-- ── Triggers updated_at ───────────────────────────────────────────────────────
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_devices_updated_at
  BEFORE UPDATE ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_manuals_updated_at
  BEFORE UPDATE ON public.manuals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Verificadores de role ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f03$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$f03$;

CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $f04$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
$f04$;

CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $f05$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND approved = true AND blocked = false
  )
$f05$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f06$
  SELECT role::text FROM user_roles WHERE user_id = auth.uid() LIMIT 1
$f06$;

-- ── Trigger: cria perfil automaticamente no cadastro ─────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $f07$
BEGIN
  INSERT INTO public.profiles (user_id, email, display_name, approved, must_change_password)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    true,
    true
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'estoque');
  RETURN NEW;
END;
$f07$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
