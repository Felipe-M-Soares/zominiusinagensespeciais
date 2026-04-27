-- Migration: migra registros 'client' -> 'funcionario' e atualiza default
-- Deve rodar APÓS 20260427000001 (ADD VALUE precisa ser commitado antes).

-- Migrar registros existentes
UPDATE public.user_roles SET role = 'funcionario' WHERE role = 'client';

-- Atualizar default da coluna
ALTER TABLE public.user_roles ALTER COLUMN role SET DEFAULT 'funcionario';
