-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Módulo Financeiro Completo
-- Arquivo: supabase/migrations/20260517000001_financeiro_completo.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. LANÇAMENTOS FINANCEIROS
--    Cobre: compras de produção, compras de empresa, custos operacionais
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.financeiro_lancamentos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                text NOT NULL
                        CHECK (tipo IN ('compra_producao', 'compra_empresa', 'custo_operacional')),
  categoria           text NOT NULL
                        CHECK (categoria IN (
                          'maquina', 'materia_prima', 'equipamento', 'insumo_producao',
                          'computador', 'mobiliario', 'material_escritorio', 'ativo_empresa',
                          'energia', 'aluguel', 'servico', 'manutencao', 'outro'
                        )),
  descricao           text NOT NULL,
  fornecedor          text,
  valor               numeric(14,2) NOT NULL CHECK (valor > 0),
  data_lancamento     date NOT NULL DEFAULT CURRENT_DATE,
  nota_fiscal_manual  text,              -- número NF digitado manualmente
  chave_nfe           text,              -- chave de acesso 44 dígitos (opcional)
  status_nf           text NOT NULL DEFAULT 'sem_nf'
                        CHECK (status_nf IN ('sem_nf', 'manual', 'autorizada', 'pendente')),
  observacoes         text,
  recorrente          boolean NOT NULL DEFAULT false,
  periodicidade       text
                        CHECK (periodicidade IS NULL OR periodicidade IN
                          ('mensal', 'bimestral', 'trimestral', 'anual')),
  modo_teste          boolean NOT NULL DEFAULT true,  -- true = homologação, sem valor fiscal
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.financeiro_lancamentos ENABLE ROW LEVEL SECURITY;

-- Financeiro e admins têm acesso completo; outros usuários só lêem
CREATE POLICY "financeiro_lanc_select" ON public.financeiro_lancamentos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "financeiro_lanc_insert" ON public.financeiro_lancamentos
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = created_by OR
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'financeiro'))
  );

CREATE POLICY "financeiro_lanc_update" ON public.financeiro_lancamentos
  FOR UPDATE TO authenticated USING (
    auth.uid() = created_by OR
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'financeiro'))
  );

CREATE POLICY "financeiro_lanc_delete" ON public.financeiro_lancamentos
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'financeiro'))
  );

-- Trigger updated_at
DROP TRIGGER IF EXISTS financeiro_lancamentos_updated_at ON public.financeiro_lancamentos;
CREATE TRIGGER financeiro_lancamentos_updated_at
  BEFORE UPDATE ON public.financeiro_lancamentos
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- Índices
CREATE INDEX IF NOT EXISTS idx_fin_lanc_tipo       ON public.financeiro_lancamentos(tipo);
CREATE INDEX IF NOT EXISTS idx_fin_lanc_data       ON public.financeiro_lancamentos(data_lancamento DESC);
CREATE INDEX IF NOT EXISTS idx_fin_lanc_created_by ON public.financeiro_lancamentos(created_by);
CREATE INDEX IF NOT EXISTS idx_fin_lanc_recorrente ON public.financeiro_lancamentos(recorrente) WHERE recorrente = true;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. CONTAS BANCÁRIAS & INTEGRAÇÃO
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.financeiro_contas_bancarias (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banco                text NOT NULL,
  agencia              text NOT NULL,
  conta                text NOT NULL,
  tipo                 text NOT NULL DEFAULT 'corrente'
                         CHECK (tipo IN ('corrente', 'poupanca', 'pagamentos')),
  saldo_atual          numeric(14,2) NOT NULL DEFAULT 0,
  webhook_url          text,              -- URL de callback para envio automático de NF
  token_api            text,              -- Bearer token / chave API do banco (criptografar em produção)
  integracao_ativa     boolean NOT NULL DEFAULT false,
  envio_automatico_nf  boolean NOT NULL DEFAULT false,
  created_by           uuid REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.financeiro_contas_bancarias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fin_contas_select" ON public.financeiro_contas_bancarias
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'financeiro'))
  );

CREATE POLICY "fin_contas_write" ON public.financeiro_contas_bancarias
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'financeiro'))
  );

DROP TRIGGER IF EXISTS fin_contas_bancarias_updated_at ON public.financeiro_contas_bancarias;
CREATE TRIGGER fin_contas_bancarias_updated_at
  BEFORE UPDATE ON public.financeiro_contas_bancarias
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. SEQUENCIAL DE NÚMERO DE NF
--    RPC get_next_nf_number(p_serie text, p_tipo text) → integer
--    Retorna o próximo número da NF-e / NFC-e de forma atômica.
-- ══════════════════════════════════════════════════════════════════════════════

-- Tabela de controle de numeração
CREATE TABLE IF NOT EXISTS public.nf_numero_controle (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo        text NOT NULL DEFAULT 'nfe' CHECK (tipo IN ('nfe', 'nfce')),
  serie       text NOT NULL DEFAULT '1',
  ultimo_num  integer NOT NULL DEFAULT 0,
  UNIQUE (tipo, serie)
);

ALTER TABLE public.nf_numero_controle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nf_num_select" ON public.nf_numero_controle
  FOR SELECT TO authenticated USING (true);

-- Inicializa série padrão
INSERT INTO public.nf_numero_controle (tipo, serie, ultimo_num)
VALUES ('nfe', '1', 0), ('nfce', '1', 0)
ON CONFLICT (tipo, serie) DO NOTHING;

-- RPC: retorna próximo número de NF de forma atômica (FOR UPDATE)
CREATE OR REPLACE FUNCTION public.get_next_nf_number(
  p_serie text DEFAULT '1',
  p_tipo  text DEFAULT 'nfe'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proximo integer;
BEGIN
  -- Cria a linha se não existir
  INSERT INTO public.nf_numero_controle (tipo, serie, ultimo_num)
  VALUES (p_tipo, p_serie, 0)
  ON CONFLICT (tipo, serie) DO NOTHING;

  -- Incrementa atomicamente
  UPDATE public.nf_numero_controle
  SET ultimo_num = ultimo_num + 1
  WHERE tipo = p_tipo AND serie = p_serie
  RETURNING ultimo_num INTO v_proximo;

  RETURN v_proximo;
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. CAMPOS EXTRAS em pedidos_comerciais (se ainda não existirem)
--    Garante compatibilidade com o wizard de NF-e.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pedidos_comerciais
  ADD COLUMN IF NOT EXISTS frete           numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nota_fiscal     text,
  ADD COLUMN IF NOT EXISTS nf_criada_por   uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS nf_criada_em    timestamptz,
  ADD COLUMN IF NOT EXISTS enviado_em      timestamptz,
  ADD COLUMN IF NOT EXISTS separado_em     timestamptz,
  ADD COLUMN IF NOT EXISTS chave_acesso_nfe text,
  ADD COLUMN IF NOT EXISTS protocolo_sefaz  text,
  ADD COLUMN IF NOT EXISTS dh_autorizacao_nfe timestamptz,
  ADD COLUMN IF NOT EXISTS tipo_nf          text CHECK (tipo_nf IN ('nfe', 'nfce'));

-- Status aceitos pelo módulo financeiro
ALTER TABLE public.pedidos_comerciais
  DROP CONSTRAINT IF EXISTS pedidos_comerciais_status_check;

ALTER TABLE public.pedidos_comerciais
  ADD CONSTRAINT pedidos_comerciais_status_check
  CHECK (status IN ('pendente', 'separando', 'pronto', 'faturado', 'enviado', 'cancelado'));


-- ══════════════════════════════════════════════════════════════════════════════
-- 5. RPC faturar_pedido_sefaz (atualizado para status "faturado" e "enviado")
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.faturar_pedido_sefaz(
  p_pedido_id      uuid,
  p_nf             text,
  p_chave_acesso   text,
  p_protocolo      text,
  p_dh_autorizacao timestamptz,
  p_user_id        uuid,
  p_user_name      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
BEGIN
  UPDATE public.pedidos_comerciais
  SET
    status              = 'faturado',
    nota_fiscal         = p_nf,
    chave_acesso_nfe    = p_chave_acesso,
    protocolo_sefaz     = p_protocolo,
    dh_autorizacao_nfe  = p_dh_autorizacao,
    nf_criada_por       = p_user_id,
    nf_criada_em        = now(),
    enviado_em          = now()
  WHERE id = p_pedido_id AND status = 'pronto';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Pedido não encontrado ou status inválido');
  END IF;

  -- Baixa estoque atomicamente
  FOR v_item IN
    SELECT pi.stock_item_id, pi.quantidade, pi.lote
    FROM public.pedido_itens pi
    WHERE pi.pedido_id = p_pedido_id
  LOOP
    UPDATE public.stock_items
    SET
      quantity          = GREATEST(0, quantity - v_item.quantidade),
      quantity_reserved = GREATEST(0, quantity_reserved - v_item.quantidade)
    WHERE id = v_item.stock_item_id;

    -- Registra movimentação
    INSERT INTO public.stock_movements (
      stock_item_id, type, quantity, notes, created_by
    ) VALUES (
      v_item.stock_item_id,
      'out',
      v_item.quantidade,
      'Saída via NF ' || p_nf || ' — Pedido ' || p_pedido_id::text,
      p_user_id
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'nf', p_nf);
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 6. VIEW: resumo financeiro mensal (útil para dashboard)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.vw_financeiro_mensal AS
SELECT
  DATE_TRUNC('month', data_lancamento)::date  AS mes,
  tipo,
  SUM(valor)                                  AS total,
  COUNT(*)                                    AS qtd_lancamentos,
  SUM(CASE WHEN status_nf = 'sem_nf'    THEN 1 ELSE 0 END) AS sem_nf,
  SUM(CASE WHEN status_nf = 'pendente'  THEN 1 ELSE 0 END) AS pendente_nf,
  SUM(CASE WHEN status_nf IN ('manual','autorizada') THEN 1 ELSE 0 END) AS com_nf
FROM public.financeiro_lancamentos
GROUP BY 1, 2
ORDER BY 1 DESC, 2;


-- ══════════════════════════════════════════════════════════════════════════════
-- 7. NOTAS: instruções para produção SEFAZ
-- ══════════════════════════════════════════════════════════════════════════════
-- Para ativar emissão real (produção):
--   1. Na Edge Function "sefaz-emitir" > Secrets:
--      SEFAZ_TP_AMB = 1         (1=produção, 2=homologação)
--      SEFAZ_CERT_PFX = <base64> (certificado A1 da empresa)
--      SEFAZ_CERT_SENHA = <senha>
--      SEFAZ_CNPJ = <14 dígitos>
--      SEFAZ_UF = SP             (UF do emitente)
--   2. No app, vá em Financeiro > Bancos & Integração > toggle "Modo Produção"
--   3. O número de NF é gerado automaticamente via get_next_nf_number()
--
-- Para integração bancária (envio automático de NF):
--   1. Cadastre a conta em Bancos & Integração
--   2. Configure o Webhook URL (endpoint do banco que recebe eventos NF)
--   3. Configure o Bearer token da API do banco
--   4. Ative "Envio automático de NF"
--   5. Clique em "Testar Webhook" para validar antes de ir a produção
-- ─────────────────────────────────────────────────────────────────────────────
