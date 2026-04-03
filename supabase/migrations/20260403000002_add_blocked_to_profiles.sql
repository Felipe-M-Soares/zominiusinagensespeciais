-- Adiciona coluna blocked na tabela profiles
-- Quando blocked = true, o usuário não pode acessar o sistema mesmo com aprovação
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false;

-- Índice para acelerar checagem de bloqueio no login
CREATE INDEX IF NOT EXISTS profiles_blocked_idx ON public.profiles(blocked) WHERE blocked = true;

COMMENT ON COLUMN public.profiles.blocked IS
  'Quando true, o acesso do usuário está bloqueado pelo administrador. '
  'O usuário vê mensagem de email bloqueado ao tentar acessar.';
