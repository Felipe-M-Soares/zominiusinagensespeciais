-- =============================================================================
-- CRITICAL SEC FIX: Coluna `blocked` não estava protegida pelo WITH CHECK da
-- policy de UPDATE de perfil.
--
-- VULNERABILIDADE:
--   A migration 20260324000001 criou a policy "Users can update own display_name only"
--   com WITH CHECK que verifica `approved` e `email`, mas NÃO verifica `blocked`.
--   A coluna `blocked` foi adicionada DEPOIS (migration 20260403000002), então
--   ficou desprotegida.
--
--   Um usuário bloqueado (blocked = true) podia se auto-desbloquear chamando:
--     supabase.from('profiles').update({ blocked: false }).eq('user_id', self_id)
--   O WITH CHECK não bloqueava essa operação porque só verificava approved e email.
--
-- IMPACTO: Usuários bloqueados por administrador podiam recuperar acesso ao sistema.
--
-- CORREÇÃO: Recriar a policy incluindo `blocked` no WITH CHECK.
-- =============================================================================

DROP POLICY IF EXISTS "Users can update own display_name only" ON public.profiles;

CREATE POLICY "Users can update own display_name only"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    -- Campos sensíveis não podem ser alterados pelo próprio usuário.
    -- As sub-queries comparam o valor NOVO (na linha sendo escrita)
    -- com o valor ATUAL no banco — se diferirem, o WITH CHECK falha.
    AND approved = (SELECT approved FROM public.profiles WHERE user_id = auth.uid())
    AND email    = (SELECT email    FROM public.profiles WHERE user_id = auth.uid())
    AND blocked  = (SELECT blocked  FROM public.profiles WHERE user_id = auth.uid())
  );

-- Garante que admins mantêm acesso total (incluindo aprovar/bloquear/desbloquear)
DROP POLICY IF EXISTS "Admins can manage all profiles" ON public.profiles;
CREATE POLICY "Admins can manage all profiles"
  ON public.profiles
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
