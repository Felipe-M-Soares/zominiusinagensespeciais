-- ─────────────────────────────────────────────────────────────────────────────
-- Auto-preenchimento de NCM e CFOP para componentes dentários Zomini
-- Lógica baseada nos campos já existentes: risk_class, implantable,
-- body_region, classification_code e primary_material
-- ─────────────────────────────────────────────────────────────────────────────

-- Função: resolve NCM correto para o dispositivo
CREATE OR REPLACE FUNCTION public.resolve_ncm_device(
  p_risk_class        text,
  p_implantable       boolean,
  p_body_region       text,
  p_classification    text,
  p_primary_material  text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_body      text := lower(coalesce(p_body_region, ''));
  v_class     text := lower(coalesce(p_classification, ''));
  v_material  text := lower(coalesce(p_primary_material, ''));
BEGIN
  -- ── Implantes intraósseos (parafusos, fixtures, pilares de titânio) ──
  IF p_implantable = true
     AND (v_body LIKE '%oral%' OR v_body LIKE '%dent%' OR v_body LIKE '%buc%')
  THEN
    -- Implante intraósseo puro (fixture, parafuso de fixação)
    IF v_class LIKE '%implant%' OR v_class LIKE '%fixture%' OR v_class LIKE '%parafus%' THEN
      RETURN '9021.29.10'; -- Implantes dentários intraósseos
    END IF;
    -- Pilar / abutment / componente protético sobre implante
    IF v_class LIKE '%pilar%' OR v_class LIKE '%abutment%' OR v_class LIKE '%proteti%'
       OR v_class LIKE '%protese%' OR v_class LIKE '%prótese%' THEN
      RETURN '9021.39.90'; -- Próteses e artigos e aparelhos de prótese dentária
    END IF;
    -- Parafusos / componentes de titânio genéricos para implante
    IF v_material LIKE '%titani%' OR v_material LIKE '%ti-6%' OR v_material LIKE '%titanium%' THEN
      RETURN '9021.29.10';
    END IF;
    -- Componente dentário implantável não classificado acima
    RETURN '9021.39.90';
  END IF;

  -- ── Próteses e componentes protéticos não implantáveis ──
  IF v_body LIKE '%oral%' OR v_body LIKE '%dent%' OR v_body LIKE '%buc%' THEN
    IF v_class LIKE '%instrumen%' OR v_class LIKE '%tool%' OR v_class LIKE '%broca%'
       OR v_class LIKE '%fresa%' OR v_class LIKE '%kit%' THEN
      RETURN '9018.49.90'; -- Instrumentos e aparelhos de odontologia
    END IF;
    RETURN '9021.39.90'; -- Próteses dentárias em geral
  END IF;

  -- ── Dispositivos cirúrgicos / instrumentos médicos gerais ──
  IF p_risk_class IN ('III', 'IV') AND p_implantable = true THEN
    RETURN '9021.39.90'; -- Próteses e artigos de prótese
  END IF;

  IF p_risk_class IN ('I', 'II') THEN
    RETURN '9018.90.99'; -- Outros instrumentos e aparelhos para medicina/cirurgia
  END IF;

  -- Padrão seguro para componentes dentários Zomini
  RETURN '9021.39.90';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Função: resolve CFOP padrão (5102 = venda intra-estadual, mais comum para SP)
-- O CFOP depende do estado destino, mas gravamos o padrão SP→SP e o financeiro
-- pode alterar para 6102 quando a venda for interestadual.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_cfop_device(
  p_implantable boolean
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  -- 5102 = Venda de mercadoria industrializada (intra-estadual)
  -- Produto implantável ou não, a operação de venda padrão é sempre 5102 para SP
  SELECT '5102';
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: ao inserir ou atualizar um device, preenche NCM/CFOP automaticamente
-- SE ncm ainda for o placeholder padrão OU estiver vazio
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_auto_ncm_cfop()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Só preenche se NCM não foi explicitamente customizado pelo financeiro
  -- (considera "90213990" e vazios como "não definido pelo usuário")
  IF NEW.ncm IS NULL OR NEW.ncm = '' OR NEW.ncm = '90213990' THEN
    NEW.ncm := replace(
      public.resolve_ncm_device(
        NEW.risk_class,
        NEW.implantable,
        NEW.body_region,
        NEW.classification_code,
        NEW.primary_material
      ),
      '.', ''  -- remove pontos: '9021.29.10' -> '90212910'
    );
  END IF;

  IF NEW.cfop_padrao IS NULL OR NEW.cfop_padrao = '' OR NEW.cfop_padrao = '5102' THEN
    NEW.cfop_padrao := public.resolve_cfop_device(NEW.implantable);
  END IF;

  -- Define unidade padrão se não informada
  IF NEW.unidade IS NULL OR NEW.unidade = '' THEN
    NEW.unidade := 'UN';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_devices_auto_ncm_cfop ON public.devices;
CREATE TRIGGER trg_devices_auto_ncm_cfop
  BEFORE INSERT OR UPDATE OF risk_class, implantable, body_region, classification_code, primary_material
  ON public.devices
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_auto_ncm_cfop();

-- ─────────────────────────────────────────────────────────────────────────────
-- Atualiza TODAS as peças existentes com o NCM/CFOP correto
-- (respeita customizações: só atualiza onde NCM é padrão ou vazio)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.devices
SET
  ncm = replace(
    public.resolve_ncm_device(risk_class, implantable, body_region, classification_code, primary_material),
    '.', ''
  ),
  cfop_padrao = public.resolve_cfop_device(implantable),
  unidade     = COALESCE(NULLIF(unidade, ''), 'UN')
WHERE
  ncm IS NULL OR ncm = '' OR ncm = '90213990';

-- Para as que já têm NCM customizado, apenas garante CFOP e unidade
UPDATE public.devices
SET
  cfop_padrao = COALESCE(NULLIF(cfop_padrao, ''), '5102'),
  unidade     = COALESCE(NULLIF(unidade, ''), 'UN')
WHERE
  ncm IS NOT NULL AND ncm != '' AND ncm != '90213990';

-- Garante que preco_venda, desconto_max_pct etc existem (migration anterior pode não ter rodado)
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

COMMENT ON FUNCTION public.resolve_ncm_device IS
  'Retorna o NCM correto para componentes dentários Zomini com base em risk_class, implantable, body_region e primary_material.
   Tabela de referência:
   9021.29.10 = Implantes dentários intraósseos (fixtures, parafusos de fixação de titânio)
   9021.39.90 = Próteses/artigos de prótese dentária (pilares, abutments, componentes protéticos)
   9018.49.90 = Instrumentos de odontologia (brocas, fresas, kits)
   9018.90.99 = Outros instrumentos médicos/cirúrgicos';
