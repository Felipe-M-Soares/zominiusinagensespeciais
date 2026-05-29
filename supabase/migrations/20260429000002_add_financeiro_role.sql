-- Adiciona role "financeiro" ao enum app_role
alter type public.app_role add value if not exists 'financeiro';
