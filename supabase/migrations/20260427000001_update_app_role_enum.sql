-- Migration: renomeia 'client' -> 'funcionario' e adiciona 'vendedora' ao enum app_role
-- Necessário para bancos já existentes que tinham o enum anterior

-- Passo 1: Adicionar novos valores ao enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'funcionario';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'vendedora';

-- Passo 2: Migrar registros existentes de 'client' para 'funcionario'
UPDATE public.user_roles SET role = 'funcionario' WHERE role = 'client';

-- Passo 3: Alterar o default da coluna
ALTER TABLE public.user_roles ALTER COLUMN role SET DEFAULT 'funcionario';

-- Passo 4: Atualizar triggers que atribuíam 'client'
-- (os triggers já foram atualizados nas migrations anteriores para novos usuários)

-- Nota: O valor 'client' não pode ser removido do ENUM no PostgreSQL sem recriar o tipo.
-- Os registros foram migrados acima, então 'client' ficará como valor legado sem uso.
