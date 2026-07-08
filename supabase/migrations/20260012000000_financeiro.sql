-- =============================================================================
-- FINANCEIRO — Lançamentos, contas bancárias, sequencial NF-e
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 20260012000000_financeiro_tables.sql
-- ─────────────────────────────────────────────────────────────────────────────

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
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f01$
DECLARE v_num bigint;
BEGIN
  INSERT INTO public.nfe_sequencia (serie, tipo, ultimo_num) VALUES (p_serie, p_tipo, 1)
  ON CONFLICT (serie, tipo) DO UPDATE SET ultimo_num = nfe_sequencia.ultimo_num + 1, updated_at = now()
  RETURNING ultimo_num INTO v_num;
  RETURN v_num;
END;
$f01$;

CREATE OR REPLACE FUNCTION public.peek_next_nf_number(p_serie text DEFAULT '1', p_tipo text DEFAULT 'nfe')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f02$
DECLARE v_num bigint;
BEGIN
  SELECT COALESCE(ultimo_num, 0) + 1 INTO v_num FROM public.nfe_sequencia WHERE serie = p_serie AND tipo = p_tipo;
  IF NOT FOUND THEN v_num := 1; END IF;
  RETURN v_num;
END;
$f02$;
GRANT EXECUTE ON FUNCTION public.peek_next_nf_number(text,text) TO authenticated;

-- ── Índices ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fin_lanc_data ON public.financeiro_lancamentos(data_lancamento DESC);
CREATE INDEX IF NOT EXISTS idx_fin_lanc_tipo ON public.financeiro_lancamentos(tipo);

-- =============================================================================
-- DEVOLUÇÃO / TROCA — NF-e de devolução de mercadoria e de troca
-- =============================================================================
-- Adicionado depois, nesta mesma migration (não em arquivo novo) a pedido —
-- por isso a tabela referencia pedidos_comerciais SEM foreign key (essa
-- tabela só é criada em 20260018000000_comercial.sql, que roda DEPOIS desta
-- migration financeira; uma FK aqui quebraria uma instalação nova do zero).
-- A validação de que pedido_id aponta para um pedido real é feita no
-- frontend (o combobox só deixa escolher pedidos já faturados existentes).
--
-- As RPCs de emissão/cancelamento (registrar_devolucao_troca e
-- cancelar_devolucao_troca) ficam em 20260044000000_seguranca_revisao_final.sql
-- em vez de aqui, porque dependem de audit_log (criada em
-- 20260027000000_estoque.sql) e de rate_limit_log/check_rate_limit (criadas
-- em 20260029000000_seguranca.sql) — ambas posteriores a este arquivo.

-- ── Sequenciais próprios de numeração (série separada da venda) ──────────────
INSERT INTO public.nfe_sequencia (serie, tipo, ultimo_num)
VALUES ('2','devolucao',0), ('2','troca',0)
ON CONFLICT (serie, tipo) DO NOTHING;

-- ── Tabela principal ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notas_devolucao_troca (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo               text NOT NULL CHECK (tipo IN ('devolucao','troca')),

  -- Vínculo opcional com o pedido/NF de venda original. Sem FK — ver nota
  -- no cabeçalho desta seção.
  pedido_id          uuid,
  avulsa             boolean NOT NULL DEFAULT false,

  -- Dados do cliente (preenchidos automaticamente se vinculado a um pedido,
  -- ou manualmente quando avulsa)
  cliente_nome       text NOT NULL,
  cliente_documento  text,
  cliente_ie         text,
  cliente_endereco   text,
  cliente_telefone   text,
  cliente_email      text,

  -- Referência à nota fiscal original (obrigatória para NF-e de devolução/troca
  -- de verdade — o SEFAZ exige o campo NFref/refNFe apontando pra chave de 44
  -- dígitos da nota de venda que está sendo devolvida/trocada)
  nf_original_numero text,
  nf_original_chave  text CHECK (nf_original_chave IS NULL OR nf_original_chave ~ '^[0-9]{44}$'),

  motivo             text NOT NULL,
  itens              jsonb NOT NULL DEFAULT '[]'::jsonb,
  valor_frete        numeric(14,2) NOT NULL DEFAULT 0,
  valor_total        numeric(14,2) NOT NULL DEFAULT 0,

  -- Dados fiscais da nota emitida para esta devolução/troca
  tipo_nota          text NOT NULL DEFAULT 'nfe' CHECK (tipo_nota IN ('nfe','nfce')),
  tp_nf              text NOT NULL DEFAULT '0' CHECK (tp_nf IN ('0','1')), -- 0=entrada 1=saída
  numero             text,
  serie              text NOT NULL DEFAULT '2',
  natureza_operacao  text,
  chave_acesso       text,
  protocolo_sefaz    text,
  dh_autorizacao     timestamptz,
  xml_nfe            text,

  status             text NOT NULL DEFAULT 'rascunho'
                        CHECK (status IN ('rascunho','autorizada','rejeitada','cancelada')),
  status_msg         text,
  modo_teste         boolean NOT NULL DEFAULT true,

  created_by         uuid REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notas_devolucao_troca ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_notas_dev_troca_pedido  ON public.notas_devolucao_troca (pedido_id);
CREATE INDEX IF NOT EXISTS idx_notas_dev_troca_status  ON public.notas_devolucao_troca (status);
CREATE INDEX IF NOT EXISTS idx_notas_dev_troca_created ON public.notas_devolucao_troca (created_at DESC);

DROP TRIGGER IF EXISTS notas_dev_troca_updated_at ON public.notas_devolucao_troca;
CREATE TRIGGER notas_dev_troca_updated_at BEFORE UPDATE ON public.notas_devolucao_troca
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Somente admin/financeiro acessam (mesmo gate de acesso à página Financeiro > NF-e)
DROP POLICY IF EXISTS "notas_dev_troca_select" ON public.notas_devolucao_troca;
CREATE POLICY "notas_dev_troca_select" ON public.notas_devolucao_troca FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','financeiro'))
);
DROP POLICY IF EXISTS "notas_dev_troca_insert" ON public.notas_devolucao_troca;
CREATE POLICY "notas_dev_troca_insert" ON public.notas_devolucao_troca FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','financeiro'))
);
DROP POLICY IF EXISTS "notas_dev_troca_update" ON public.notas_devolucao_troca;
CREATE POLICY "notas_dev_troca_update" ON public.notas_devolucao_troca FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','financeiro'))
);
DROP POLICY IF EXISTS "notas_dev_troca_delete" ON public.notas_devolucao_troca;
CREATE POLICY "notas_dev_troca_delete" ON public.notas_devolucao_troca FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','financeiro'))
);
