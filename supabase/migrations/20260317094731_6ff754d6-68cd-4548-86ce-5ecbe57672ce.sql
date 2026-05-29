
-- Add approved column to profiles (existing users are auto-approved)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false;

-- Approve all existing users
UPDATE public.profiles SET approved = true;

-- Update handle_new_user to set approved = false for new registrations
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, email, display_name, approved)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email), false);
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'funcionario');
  
  RETURN NEW;
END;
$function$;

-- Drop existing permissive SELECT policies on data tables and replace with approved-only
DROP POLICY IF EXISTS "Authenticated users can view devices" ON public.devices;
drop policy if exists "Approved users can view devices" on public.devices;
CREATE POLICY "Approved users can view devices" ON public.devices FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND approved = true)
    OR has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Authenticated users can view contacts" ON public.contacts;
drop policy if exists "Approved users can view contacts" on public.contacts;
CREATE POLICY "Approved users can view contacts" ON public.contacts FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND approved = true)
    OR has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Authenticated users can view manuals" ON public.manuals;
drop policy if exists "Approved users can view manuals" on public.manuals;
CREATE POLICY "Approved users can view manuals" ON public.manuals FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND approved = true)
    OR has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Authenticated users can view catalogs" ON public.catalogs;
drop policy if exists "Approved users can view catalogs" on public.catalogs;
CREATE POLICY "Approved users can view catalogs" ON public.catalogs FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND approved = true)
    OR has_role(auth.uid(), 'admin'::app_role)
  );
