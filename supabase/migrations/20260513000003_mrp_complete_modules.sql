-- =============================================================================
-- MRP COMPLETO — 2026-05-13
-- Módulos: Fornecedores, BOM, Ordens de Produção, Qualidade, Financeiro
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════════
-- MÓDULO 1: FORNECEDORES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.fornecedores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            text NOT NULL,
  cnpj            text,
  contato         text,
  telefone        text,
  email           text,
  endereco        text,
  lead_time_dias  integer NOT NULL DEFAULT 7 CHECK (lead_time_dias >= 0),
  avaliacao       integer CHECK (avaliacao BETWEEN 1 AND 5),
  ativo           boolean NOT NULL DEFAULT true,
  observacoes     text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fornecedores_select" ON public.fornecedores
  FOR SELECT USING (public.is_approved_user());
CREATE POLICY "fornecedores_write" ON public.fornecedores
  FOR ALL USING (public.is_admin_user());

-- ═══════════════════════════════════════════════════════════════════════════════
-- MÓDULO 2: BILL OF MATERIALS (BOM)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Cabeçalho do BOM: produto final (device) + versão
CREATE TABLE IF NOT EXISTS public.bom_headers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  versao          text NOT NULL DEFAULT '1.0',
  descricao       text,
  ativo           boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, versao)
);

-- Componentes do BOM: matérias-primas necessárias
CREATE TABLE IF NOT EXISTS public.bom_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id          uuid NOT NULL REFERENCES public.bom_headers(id) ON DELETE CASCADE,
  componente      text NOT NULL,            -- nome/código da matéria-prima
  quantidade      numeric NOT NULL CHECK (quantidade > 0),
  unidade         text NOT NULL DEFAULT 'un',  -- un, kg, m, m², L, etc.
  fornecedor_id   uuid REFERENCES public.fornecedores(id),
  custo_unitario  numeric CHECK (custo_unitario >= 0),
  observacoes     text,
  ordem           integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bom_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_items   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bom_headers_select" ON public.bom_headers FOR SELECT USING (public.is_approved_user());
CREATE POLICY "bom_headers_write"  ON public.bom_headers FOR ALL USING (public.is_admin_user());
CREATE POLICY "bom_items_select"   ON public.bom_items   FOR SELECT USING (public.is_approved_user());
CREATE POLICY "bom_items_write"    ON public.bom_items   FOR ALL USING (public.is_admin_user());

CREATE INDEX IF NOT EXISTS idx_bom_headers_device ON public.bom_headers(device_id);
CREATE INDEX IF NOT EXISTS idx_bom_items_bom      ON public.bom_items(bom_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- MÓDULO 3: ORDENS DE PRODUÇÃO
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ordens_producao (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero            text NOT NULL UNIQUE,  -- ex: OP-2026-001
  device_id         uuid NOT NULL REFERENCES public.devices(id),
  bom_id            uuid REFERENCES public.bom_headers(id),
  pedido_id         uuid REFERENCES public.pedidos_comerciais(id),
  quantidade        integer NOT NULL CHECK (quantidade > 0),
  status            text NOT NULL DEFAULT 'planejada'
                    CHECK (status IN ('planejada','em_producao','pausada','concluida','cancelada')),
  prioridade        text NOT NULL DEFAULT 'normal'
                    CHECK (prioridade IN ('baixa','normal','alta','urgente')),
  data_inicio_prev  date,
  data_fim_prev     date,
  data_inicio_real  timestamptz,
  data_fim_real     timestamptz,
  responsavel_id    uuid REFERENCES auth.users(id),
  responsavel_nome  text,
  lote_producao     text,   -- lote gerado nesta OP
  observacoes       text,
  created_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Histórico de mudanças de status das OPs
CREATE TABLE IF NOT EXISTS public.op_status_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  op_id       uuid NOT NULL REFERENCES public.ordens_producao(id) ON DELETE CASCADE,
  status_de   text,
  status_para text NOT NULL,
  motivo      text,
  user_id     uuid REFERENCES auth.users(id),
  user_nome   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Consumo de materiais na OP
CREATE TABLE IF NOT EXISTS public.op_consumos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  op_id           uuid NOT NULL REFERENCES public.ordens_producao(id) ON DELETE CASCADE,
  componente      text NOT NULL,
  quantidade_prev numeric NOT NULL,
  quantidade_real numeric,
  unidade         text NOT NULL DEFAULT 'un',
  lote_material   text,
  observacoes     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ordens_producao   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.op_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.op_consumos       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "op_select"         ON public.ordens_producao   FOR SELECT USING (public.is_approved_user());
CREATE POLICY "op_write"          ON public.ordens_producao   FOR ALL   USING (public.is_admin_user());
CREATE POLICY "op_hist_select"    ON public.op_status_history FOR SELECT USING (public.is_approved_user());
CREATE POLICY "op_hist_insert"    ON public.op_status_history FOR INSERT WITH CHECK (public.is_approved_user());
CREATE POLICY "op_consumo_select" ON public.op_consumos       FOR SELECT USING (public.is_approved_user());
CREATE POLICY "op_consumo_write"  ON public.op_consumos       FOR ALL   USING (public.is_admin_user());

CREATE INDEX IF NOT EXISTS idx_op_status    ON public.ordens_producao(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_op_device    ON public.ordens_producao(device_id);
CREATE INDEX IF NOT EXISTS idx_op_pedido    ON public.ordens_producao(pedido_id);
CREATE INDEX IF NOT EXISTS idx_op_hist_op   ON public.op_status_history(op_id, created_at DESC);

-- Trigger: gera número sequencial da OP automaticamente
CREATE OR REPLACE FUNCTION public.gerar_numero_op()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ano  text := to_char(now(), 'YYYY');
  v_seq  integer;
BEGIN
  SELECT COALESCE(MAX(
    NULLIF(regexp_replace(numero, 'OP-\d{4}-', '', 'g'), '')::integer
  ), 0) + 1
  INTO v_seq
  FROM public.ordens_producao
  WHERE numero LIKE 'OP-' || v_ano || '-%';

  NEW.numero := 'OP-' || v_ano || '-' || lpad(v_seq::text, 3, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gerar_numero_op ON public.ordens_producao;
CREATE TRIGGER trg_gerar_numero_op
  BEFORE INSERT ON public.ordens_producao
  FOR EACH ROW
  WHEN (NEW.numero IS NULL OR NEW.numero = '')
  EXECUTE FUNCTION public.gerar_numero_op();

-- Trigger: registra mudança de status automaticamente
CREATE OR REPLACE FUNCTION public.registrar_mudanca_status_op()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.op_status_history(op_id, status_de, status_para, user_id)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid());
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_op_status_change ON public.ordens_producao;
CREATE TRIGGER trg_op_status_change
  BEFORE UPDATE ON public.ordens_producao
  FOR EACH ROW EXECUTE FUNCTION public.registrar_mudanca_status_op();

-- ═══════════════════════════════════════════════════════════════════════════════
-- MÓDULO 4: QUALIDADE E NÃO CONFORMIDADES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.nao_conformidades (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero          text NOT NULL UNIQUE,   -- RNC-2026-001
  tipo            text NOT NULL CHECK (tipo IN ('produto','processo','fornecedor','cliente')),
  origem          text NOT NULL CHECK (origem IN ('interna','cliente','auditoria','recebimento')),
  descricao       text NOT NULL,
  device_id       uuid REFERENCES public.devices(id),
  op_id           uuid REFERENCES public.ordens_producao(id),
  lote            text,
  fornecedor_id   uuid REFERENCES public.fornecedores(id),
  gravidade       text NOT NULL DEFAULT 'media' CHECK (gravidade IN ('baixa','media','alta','critica')),
  status          text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','em_analise','concluida','cancelada')),
  acao_imediata   text,
  causa_raiz      text,
  acao_corretiva  text,
  responsavel_id  uuid REFERENCES auth.users(id),
  responsavel_nome text,
  prazo           date,
  concluida_em    timestamptz,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nao_conformidades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nc_select" ON public.nao_conformidades FOR SELECT USING (public.is_approved_user());
CREATE POLICY "nc_write"  ON public.nao_conformidades FOR ALL   USING (public.is_approved_user());

CREATE INDEX IF NOT EXISTS idx_nc_status ON public.nao_conformidades(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nc_device ON public.nao_conformidades(device_id);

-- Trigger: gera número RNC sequencial
CREATE OR REPLACE FUNCTION public.gerar_numero_rnc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ano text := to_char(now(), 'YYYY');
  v_seq integer;
BEGIN
  SELECT COALESCE(MAX(
    NULLIF(regexp_replace(numero, 'RNC-\d{4}-', '', 'g'), '')::integer
  ), 0) + 1
  INTO v_seq
  FROM public.nao_conformidades
  WHERE numero LIKE 'RNC-' || v_ano || '-%';

  NEW.numero := 'RNC-' || v_ano || '-' || lpad(v_seq::text, 3, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gerar_numero_rnc ON public.nao_conformidades;
CREATE TRIGGER trg_gerar_numero_rnc
  BEFORE INSERT ON public.nao_conformidades
  FOR EACH ROW
  WHEN (NEW.numero IS NULL OR NEW.numero = '')
  EXECUTE FUNCTION public.gerar_numero_rnc();

-- ═══════════════════════════════════════════════════════════════════════════════
-- MÓDULO 5: CONTAS A RECEBER / FLUXO FINANCEIRO
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.contas_receber (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id       uuid REFERENCES public.pedidos_comerciais(id),
  cliente_id      uuid NOT NULL REFERENCES public.clientes(id),
  descricao       text NOT NULL,
  valor           numeric NOT NULL CHECK (valor > 0),
  vencimento      date NOT NULL,
  recebido_em     timestamptz,
  forma_pagamento text,  -- dinheiro, pix, boleto, cartão, etc.
  status          text NOT NULL DEFAULT 'aberta'
                  CHECK (status IN ('aberta','recebida','vencida','cancelada')),
  observacoes     text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contas_receber ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cr_select" ON public.contas_receber FOR SELECT USING (public.is_approved_user());
CREATE POLICY "cr_write"  ON public.contas_receber FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','financeiro'))
);

CREATE INDEX IF NOT EXISTS idx_cr_status    ON public.contas_receber(status, vencimento);
CREATE INDEX IF NOT EXISTS idx_cr_cliente   ON public.contas_receber(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cr_pedido    ON public.contas_receber(pedido_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- MÓDULO 6: KPIs / VIEWS MRP
-- ═══════════════════════════════════════════════════════════════════════════════

-- View: KPIs de produção em tempo real
CREATE OR REPLACE VIEW public.v_kpis_producao AS
SELECT
  COUNT(*) FILTER (WHERE status = 'em_producao')  AS ops_ativas,
  COUNT(*) FILTER (WHERE status = 'planejada')     AS ops_planejadas,
  COUNT(*) FILTER (WHERE status = 'concluida'
    AND date_trunc('month', data_fim_real) = date_trunc('month', now()))
                                                   AS ops_concluidas_mes,
  ROUND(AVG(
    EXTRACT(EPOCH FROM (data_fim_real - data_inicio_real)) / 3600
  ) FILTER (WHERE status = 'concluida' AND data_fim_real IS NOT NULL AND data_inicio_real IS NOT NULL), 1)
                                                   AS lead_time_medio_horas,
  COUNT(*) FILTER (WHERE status NOT IN ('cancelada','concluida')
    AND data_fim_prev < now()::date)               AS ops_atrasadas
FROM public.ordens_producao;

-- View: contas a receber por status com valor total
CREATE OR REPLACE VIEW public.v_financeiro_resumo AS
SELECT
  status,
  COUNT(*)         AS quantidade,
  SUM(valor)       AS valor_total,
  MIN(vencimento)  AS proximo_vencimento
FROM public.contas_receber
GROUP BY status;

-- RPC: giro de estoque por device (últimos 90 dias)
CREATE OR REPLACE FUNCTION public.calcular_giro_estoque(p_dias integer DEFAULT 90)
RETURNS TABLE (
  device_id   uuid,
  device_model text,
  saidas_periodo numeric,
  estoque_medio  numeric,
  giro           numeric
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH saidas AS (
    SELECT
      si.device_id,
      SUM(sm.quantity)::numeric AS total_saidas
    FROM public.stock_movements sm
    JOIN public.stock_items si ON si.id = sm.stock_item_id
    WHERE sm.type = 'saida'
      AND sm.created_at >= now() - (p_dias || ' days')::interval
    GROUP BY si.device_id
  ),
  estoque AS (
    SELECT device_id, SUM(quantity)::numeric AS qtd
    FROM public.stock_items
    GROUP BY device_id
  )
  SELECT
    d.id,
    d.model,
    COALESCE(s.total_saidas, 0),
    COALESCE(e.qtd, 0),
    CASE WHEN COALESCE(e.qtd, 0) > 0
      THEN ROUND(COALESCE(s.total_saidas, 0) / e.qtd, 2)
      ELSE 0
    END
  FROM public.devices d
  LEFT JOIN saidas s ON s.device_id = d.id
  LEFT JOIN estoque e ON e.device_id = d.id
  WHERE COALESCE(s.total_saidas, 0) > 0 OR COALESCE(e.qtd, 0) > 0
  ORDER BY 5 DESC;
$$;

-- updated_at triggers para novas tabelas
CREATE OR REPLACE FUNCTION public.set_updated_at_mrp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fornecedores','bom_headers','ordens_producao','nao_conformidades','contas_receber']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%s', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%s FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_mrp()',
      t, t
    );
  END LOOP;
END;
$$;

ANALYZE public.fornecedores;
ANALYZE public.bom_headers;
ANALYZE public.ordens_producao;
ANALYZE public.nao_conformidades;
ANALYZE public.contas_receber;
