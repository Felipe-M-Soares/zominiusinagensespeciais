-- =============================================================================
-- SEC-CRIT-01: Previne auto-aprovação de usuário via UPDATE direto no perfil
-- =============================================================================
-- VULNERABILIDADE: A política "Users can update their own profile" permitia que
-- qualquer usuário autenticado fizesse:
--   supabase.from("profiles").update({ approved: true }).eq("user_id", self_id)
-- e se auto-aprovasse, bypassando completamente o fluxo de aprovação de admins.
--
-- A política WITH CHECK (auth.uid() = user_id) só verifica QUEM está atualizando,
-- não QUAIS CAMPOS podem ser atualizados. Precisamos de um UPDATE policy mais restrito.
-- =============================================================================

-- Remove a política permissiva de update de perfil
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

-- Recria como política que só permite update de campos não-sensíveis.
-- Usuários só podem alterar display_name — approved e email são gerenciados
-- exclusivamente pelo sistema ou por admins.
CREATE POLICY "Users can update own display_name only"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    -- O campo approved não pode ser alterado pelo próprio usuário.
    -- Esta sub-query garante que o valor de approved não mudou na operação.
    AND approved = (SELECT approved FROM public.profiles WHERE user_id = auth.uid())
    AND email = (SELECT email FROM public.profiles WHERE user_id = auth.uid())
  );

-- Garante que admins ainda conseguem fazer tudo (incluindo aprovar usuários)
-- A política ALL para admins já existe, mas reforçamos explicitamente.
DROP POLICY IF EXISTS "Admins can manage all profiles" ON public.profiles;
CREATE POLICY "Admins can manage all profiles"
  ON public.profiles
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
