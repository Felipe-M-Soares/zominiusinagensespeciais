-- =============================================================================
-- SEC-CRIT: A migration de autenticação por username (última) adicionou a
-- policy "profiles_user_own_update" com WITH CHECK (auth.uid() = user_id)
-- sem restrição de campos. Como o PostgreSQL RLS avalia políticas PERMISSIVE
-- em OR lógico (basta uma passar), essa policy anula completamente a policy
-- mais restrita "Users can update own display_name only".
--
-- IMPACTO: Qualquer usuário autenticado pode chamar:
--   supabase.from('profiles').update({ approved: true, blocked: false }).eq('user_id', self_id)
-- e se auto-aprovar ou se auto-desbloquear, bypassando o controle de admins.
--
-- CORREÇÃO: Remove a policy fraca; mantém apenas a restrita com todos os
-- campos sensíveis protegidos (approved, email, blocked, login).
-- =============================================================================

-- Remove a policy permissiva fraca introduzida pela migration de username
DROP POLICY IF EXISTS "profiles_user_own_update" ON public.profiles;

-- Remove e recria a policy restrita garantindo que login também não pode ser
-- trocado pelo próprio usuário (campo gerenciado pelo admin via Edge Function)
DROP POLICY IF EXISTS "Users can update own display_name only" ON public.profiles;

CREATE POLICY "Users can update own display_name only"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    -- Campos sensíveis: o valor da linha NOVA deve ser idêntico ao valor
    -- atual no banco. Se qualquer um diferir, o WITH CHECK falha e o UPDATE
    -- é rejeitado pelo RLS antes de chegar ao dado.
    AND approved = (SELECT approved FROM public.profiles WHERE user_id = auth.uid())
    AND email    = (SELECT email    FROM public.profiles WHERE user_id = auth.uid())
    AND blocked  = (SELECT blocked  FROM public.profiles WHERE user_id = auth.uid())
    AND login    = (SELECT login    FROM public.profiles WHERE user_id = auth.uid())
  );

-- Garante que admins mantêm acesso total (aprovar/bloquear/trocar login etc.)
DROP POLICY IF EXISTS "Admins can manage all profiles" ON public.profiles;
CREATE POLICY "Admins can manage all profiles"
  ON public.profiles
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
