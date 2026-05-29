-- Financeiro Zomini: tabelas de lançamentos e contas bancárias

-- Sequência de NF-e por série
CREATE TABLE IF NOT EXISTS public.nfe_sequencia (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serie       text NOT NULL DEFAULT '1',
  tipo        text NOT NULL DEFAULT 'nfe',
  ultimo_num  bigint NOT NULL DEFAULT 0,
  updated_at  timestamptz DEFAULT now(),
  UNIQUE(serie, tipo)
);

-- RPC para obter o próximo número de NF-e (atômico)
CREATE OR REPLACE FUNCTION public.get_next_nf_number(p_serie text DEFAULT '1', p_tipo text DEFAULT 'nfe')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_num bigint;
BEGIN
  INSERT INTO public.nfe_sequencia (serie, tipo, ultimo_num)
  VALUES (p_serie, p_tipo, 1)
  ON CONFLICT (serie, tipo) DO UPDATE
    SET ultimo_num = nfe_sequencia.ultimo_num + 1, updated_at = now()
  RETURNING ultimo_num INTO v_num;
  RETURN v_num;
END;
$$;

-- Lançamentos financeiros (compras e custos)
CREATE TABLE IF NOT EXISTS public.financeiro_lancamentos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                text NOT NULL CHECK (tipo IN ('compra_producao','compra_empresa','custo_operacional')),
  categoria           text NOT NULL,
  descricao           text NOT NULL,
  fornecedor          text,
  valor               numeric(14,2) NOT NULL CHECK (valor > 0),
  data_lancamento     date NOT NULL DEFAULT CURRENT_DATE,
  nota_fiscal_manual  text,
  chave_nfe           text,
  xml_nfe             text,
  status_nf           text NOT NULL DEFAULT 'sem_nf' CHECK (status_nf IN ('sem_nf','manual','autorizada','pendente')),
  observacoes         text,
  recorrente          boolean NOT NULL DEFAULT false,
  periodicidade       text CHECK (periodicidade IN ('mensal','bimestral','trimestral','anual')),
  modo_teste          boolean NOT NULL DEFAULT true,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE public.financeiro_lancamentos ENABLE ROW LEVEL SECURITY;

drop policy if exists "financeiro_lancamentos_select" on public.financeiro_lancamentos;
CREATE POLICY "financeiro_lancamentos_select" ON public.financeiro_lancamentos
  FOR SELECT USING (true);
drop policy if exists "financeiro_lancamentos_insert" on public.financeiro_lancamentos;
CREATE POLICY "financeiro_lancamentos_insert" ON public.financeiro_lancamentos
  FOR INSERT WITH CHECK (true);
drop policy if exists "financeiro_lancamentos_update" on public.financeiro_lancamentos;
CREATE POLICY "financeiro_lancamentos_update" ON public.financeiro_lancamentos
  FOR UPDATE USING (true);
drop policy if exists "financeiro_lancamentos_delete" on public.financeiro_lancamentos;
CREATE POLICY "financeiro_lancamentos_delete" ON public.financeiro_lancamentos
  FOR DELETE USING (true);

-- Contas bancárias e integração Open Finance
CREATE TABLE IF NOT EXISTS public.financeiro_contas_bancarias (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banco               text NOT NULL,
  agencia             text NOT NULL,
  conta               text NOT NULL,
  tipo                text NOT NULL DEFAULT 'corrente' CHECK (tipo IN ('corrente','poupanca','pagamentos')),
  saldo_atual         numeric(14,2) NOT NULL DEFAULT 0,
  webhook_url         text,
  integracao_ativa    boolean NOT NULL DEFAULT false,
  token_api           text,
  envio_automatico_nf boolean NOT NULL DEFAULT false,
  open_finance_ativo  boolean NOT NULL DEFAULT false,
  pix_chave           text,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE public.financeiro_contas_bancarias ENABLE ROW LEVEL SECURITY;

drop policy if exists "financeiro_contas_select" on public.financeiro_contas_bancarias;
CREATE POLICY "financeiro_contas_select" ON public.financeiro_contas_bancarias
  FOR SELECT USING (true);
drop policy if exists "financeiro_contas_insert" on public.financeiro_contas_bancarias;
CREATE POLICY "financeiro_contas_insert" ON public.financeiro_contas_bancarias
  FOR INSERT WITH CHECK (true);
drop policy if exists "financeiro_contas_update" on public.financeiro_contas_bancarias;
CREATE POLICY "financeiro_contas_update" ON public.financeiro_contas_bancarias
  FOR UPDATE USING (true);
drop policy if exists "financeiro_contas_delete" on public.financeiro_contas_bancarias;
CREATE POLICY "financeiro_contas_delete" ON public.financeiro_contas_bancarias
  FOR DELETE USING (true);

-- Colunas extras em pedidos_comerciais (se não existirem)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pedidos_comerciais' AND column_name='protocolo_sefaz') THEN
    ALTER TABLE public.pedidos_comerciais ADD COLUMN protocolo_sefaz text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pedidos_comerciais' AND column_name='chave_acesso_nfe') THEN
    ALTER TABLE public.pedidos_comerciais ADD COLUMN chave_acesso_nfe text;
  END IF;
END $$;
