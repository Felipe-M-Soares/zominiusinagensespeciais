-- ── Trigger: cria perfil automaticamente no cadastro ─────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, display_name, approved, must_change_password)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    true,
    true
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'funcionario');
  RETURN NEW;
END;
$$;
