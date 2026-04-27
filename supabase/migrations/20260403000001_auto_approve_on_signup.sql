-- =============================================================================
-- Aprovação automática imediata no cadastro
-- =============================================================================
-- Antes: handle_new_user() inseria approved = false e o usuário ficava preso
--        na tela PendingApproval até um timer de 60s ou aprovação manual.
-- Agora:  novos usuários já nascem com approved = true — acesso imediato.
--
-- A Edge Function auto-approve e a tela PendingApproval ficam como fallback
-- para casos onde o admin queira reativar aprovação manual no futuro,
-- bastando trocar DEFAULT true → false nesta função.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, email, display_name, approved)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    true   -- aprovação imediata: usuário acessa o site logo após o cadastro
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'funcionario');

  RETURN NEW;
END;
$function$;
