-- =============================================================================
-- SEC: A função is_approved_user() verifica apenas approved=true mas não
-- verifica blocked=false. As políticas de stock_items e stock_movements
-- usam esta função, então usuários bloqueados ainda podem ler e inserir
-- movimentos de estoque.
--
-- CORREÇÃO: Adiciona AND blocked = false na função.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid()
      AND approved = true
      AND blocked  = false   -- FIX: bloqueados não têm acesso ao estoque
  );
$$;
