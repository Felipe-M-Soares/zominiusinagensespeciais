-- Migration: adiciona novos valores ao enum app_role
-- IMPORTANTE: ADD VALUE não pode ser usado na mesma transação que faz UPDATE.
-- Por isso esta migration só adiciona os valores; a próxima faz o UPDATE.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'funcionario';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'vendedora';
