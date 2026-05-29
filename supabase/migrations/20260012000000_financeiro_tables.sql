-- =============================================================================
-- 012: Módulo Financeiro — lançamentos, contas, NF sequencial
-- =============================================================================

-- ── Lançamentos financeiros ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.financeiro_lancamentos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo               text NOT NULL CHECK (tipo IN ('compra_producao','compra_empresa','custo_operacional')),
  categoria          text NOT NULL,
  descricao          text NOT NULL,
  fornecedor         text,
  valor              numeric(14,2) NOT NULL CHECK (valor > 0),
  data_lancamento    date NOT NULL DEFAULT CURRENT_DATE,
  nota_fiscal_manual text,
  chave_nfe          text,
  xml_nfe            text,
  status_nf          text NOT NULL DEFAULT 'sem_nf' CHECK (status_nf IN ('sem_nf','manual','autorizada','pendente')),
  observacoes        text,
  recorrente         boolean NOT NULL DEFAULT false,
  periodicidade      text CHECK (periodicidade IN ('mensal','bimestral','trimestral','anual')),
  modo_teste         boolean NOT NULL DEFAULT true,
  created_by         uuid REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.financeiro_lancamentos ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS financeiro_lancamentos_updated_at ON public.financeiro_lancamentos;
CREATE TRIGGER financeiro_lancamentos_updated_at BEFORE UPDATE ON public.financeiro_lancamentos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "financeiro_lanc_select" ON public.financeiro_lancamentos;
CREATE POLICY "financeiro_lanc_select" ON public.financeiro_lancamentos FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "financeiro_lanc_insert" ON public.financeiro_lancamentos;
CREATE POLICY "financeiro_lanc_insert" ON public.financeiro_lancamentos FOR INSERT TO authenticated WITH CHECK (
  auth.uid() = created_by OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','financeiro'))
);
DROP POLICY IF EXISTS "financeiro_lanc_update" ON public.financeiro_lancamentos;
CREATE POLICY "financeiro_lanc_update" ON public.financeiro_lancamentos FOR UPDATE TO authenticated USING (
  auth.uid() = created_by OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','financeiro'))
);
DROP POLICY IF EXISTS "financeiro_lanc_delete" ON public.financeiro_lancamentos;
CREATE POLICY "financeiro_lanc_delete" ON public.financeiro_lancamentos FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','financeiro'))
);

-- ── Contas bancárias ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.financeiro_contas_bancarias (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banco               text NOT NULL,
  agencia             text NOT NULL,
  conta               text NOT NULL,
  tipo                text NOT NULL DEFAULT 'corrente' CHECK (tipo IN ('corrente','poupanca','pagamentos')),
  saldo_atual         numeric(14,2) NOT NULL DEFAULT 0,
  webhook_url         text,
  token_api           text,
  integracao_ativa    boolean NOT NULL DEFAULT false,
  envio_automatico_nf boolean NOT NULL DEFAULT false,
  open_finance_ativo  boolean NOT NULL DEFAULT false,
  pix_chave           text,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.financeiro_contas_bancarias ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS fin_contas_updated_at ON public.financeiro_contas_bancarias;
CREATE TRIGGER fin_contas_updated_at BEFORE UPDATE ON public.financeiro_contas_bancarias FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "fin_contas_select" ON public.financeiro_contas_bancarias;
CREATE POLICY "fin_contas_select" ON public.financeiro_contas_bancarias FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','financeiro'))
);
DROP POLICY IF EXISTS "fin_contas_write" ON public.financeiro_contas_bancarias;
CREATE POLICY "fin_contas_write" ON public.financeiro_contas_bancarias FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','financeiro'))
);

-- ── NF Sequencial ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nfe_sequencia (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serie      text NOT NULL DEFAULT '1',
  tipo       text NOT NULL DEFAULT 'nfe',
  ultimo_num bigint NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(serie, tipo)
);
ALTER TABLE public.nfe_sequencia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nfe_seq_select" ON public.nfe_sequencia;
CREATE POLICY "nfe_seq_select" ON public.nfe_sequencia FOR SELECT TO authenticated USING (true);

INSERT INTO public.nfe_sequencia (serie, tipo, ultimo_num) VALUES ('1','nfe',0),('1','nfce',0) ON CONFLICT (serie,tipo) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_next_nf_number(p_serie text DEFAULT '1', p_tipo text DEFAULT 'nfe')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_num bigint;
BEGIN
  INSERT INTO public.nfe_sequencia (serie, tipo, ultimo_num) VALUES (p_serie, p_tipo, 1)
  ON CONFLICT (serie, tipo) DO UPDATE SET ultimo_num = nfe_sequencia.ultimo_num + 1, updated_at = now()
  RETURNING ultimo_num INTO v_num;
  RETURN v_num;
END;
$$;

CREATE OR REPLACE FUNCTION public.peek_next_nf_number(p_serie text DEFAULT '1', p_tipo text DEFAULT 'nfe')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_num bigint;
BEGIN
  SELECT COALESCE(ultimo_num, 0) + 1 INTO v_num FROM public.nfe_sequencia WHERE serie = p_serie AND tipo = p_tipo;
  IF NOT FOUND THEN v_num := 1; END IF;
  RETURN v_num;
END;
$$;
GRANT EXECUTE ON FUNCTION public.peek_next_nf_number(text,text) TO authenticated;

-- ── Índices ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fin_lanc_data ON public.financeiro_lancamentos(data_lancamento DESC);
CREATE INDEX IF NOT EXISTS idx_fin_lanc_tipo ON public.financeiro_lancamentos(tipo);
