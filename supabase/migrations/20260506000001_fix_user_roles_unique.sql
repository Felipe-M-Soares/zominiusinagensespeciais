-- SEG-03: Fix UNIQUE(user_id, role) → UNIQUE(user_id)
-- Prevent users from having multiple roles

-- First clean up any duplicates (keep the one with lower id)
DELETE FROM public.user_roles a
USING public.user_roles b
WHERE a.id > b.id AND a.user_id = b.user_id;

-- Replace compound unique constraint with single-column unique
ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key,
  ADD CONSTRAINT user_roles_user_id_key UNIQUE (user_id);
