-- ─────────────────────────────────────────────────────────────────────────────
-- Tabela de Preços: adiciona campos de preço e desconto por tipo de peça
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS preco_venda       numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS desconto_max_pct  integer       NOT NULL DEFAULT 0  CHECK (desconto_max_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS ncm               text          NOT NULL DEFAULT '90213990',
  ADD COLUMN IF NOT EXISTS cfop_padrao       text          NOT NULL DEFAULT '5102',
  ADD COLUMN IF NOT EXISTS unidade           text          NOT NULL DEFAULT 'UN',
  ADD COLUMN IF NOT EXISTS ativo             boolean       NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS preco_custo       numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS margem_minima_pct integer       NOT NULL DEFAULT 0  CHECK (margem_minima_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS observacoes_preco text;

-- RLS: financeiro pode editar preços
DROP POLICY IF EXISTS "devices_financeiro_update" ON public.devices;
CREATE POLICY "devices_financeiro_update" ON public.devices
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('admin', 'financeiro')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Função peek: retorna o PRÓXIMO número sem incrementar (para exibir no modal)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.peek_next_nf_number(
  p_serie text DEFAULT '1',
  p_tipo  text DEFAULT 'nfe'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_num bigint;
BEGIN
  SELECT COALESCE(ultimo_num, 0) + 1
    INTO v_num
    FROM public.nfe_sequencia
   WHERE serie = p_serie AND tipo = p_tipo;

  IF NOT FOUND THEN
    v_num := 1;
  END IF;

  RETURN v_num;
END;
$$;

GRANT EXECUTE ON FUNCTION public.peek_next_nf_number(text, text) TO authenticated;
