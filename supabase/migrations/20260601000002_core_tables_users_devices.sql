-- =============================================================================
-- 002: Tabelas core — usuários, perfis, dispositivos
-- =============================================================================

-- ── Tabela de papéis ──────────────────────────────────────────────────────────
CREATE TABLE public.user_roles (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role    app_role NOT NULL DEFAULT 'funcionario',
  UNIQUE (user_id)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ── Perfis ────────────────────────────────────────────────────────────────────
CREATE TABLE public.profiles (
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
CREATE TABLE public.devices (
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
CREATE TABLE public.contacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  contact    text NOT NULL,
  location   text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

-- ── Manuais ───────────────────────────────────────────────────────────────────
CREATE TABLE public.manuals (
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
CREATE TABLE public.catalogs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  file_path   text NOT NULL,
  file_size   bigint DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.catalogs ENABLE ROW LEVEL SECURITY;
