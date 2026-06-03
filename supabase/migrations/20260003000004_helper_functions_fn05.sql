CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND approved = true AND blocked = false
  )
$$;
