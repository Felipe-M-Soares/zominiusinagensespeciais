-- =============================================================================
-- 034: Módulos empresariais completos
-- Schema: fornecedores, contas_pagar/receber, ferramentas, certificados,
--         rastreabilidade pós-venda, metas de produção, pedidos de compra
-- =============================================================================

-- ── Fornecedores ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fornecedores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razao_social text NOT NULL,
  nome_fantasia text,
  cnpj        text UNIQUE,
  ie          text,
  telefone    text,
  email       text,
  contato     text,  -- nome do contato
  endereco    text,
  cidade      text,
  uf          char(2),
  cep         text,
  categoria   text NOT NULL DEFAULT 'materia_prima'
    CHECK (categoria IN ('materia_prima','servico','embalagem','ferramental','outros')),
  prazo_entrega_dias integer NOT NULL DEFAULT 0,
  observacoes text,
  ativo       boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_fornecedores_updated_at ON public.fornecedores;
CREATE TRIGGER trg_fornecedores_updated_at BEFORE UPDATE ON public.fornecedores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Pedidos de Compra (MP + outros) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedidos_compra (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id   uuid REFERENCES public.fornecedores(id),
  fornecedor_nome text NOT NULL,
  status          text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho','enviado','parcial','recebido','cancelado')),
  data_pedido     date NOT NULL DEFAULT CURRENT_DATE,
  data_previsao   date,
  data_recebimento date,
  nota_fiscal_entrada text,
  valor_total     numeric(14,2) NOT NULL DEFAULT 0,
  observacoes     text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pedido_compra_itens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id       uuid NOT NULL REFERENCES public.pedidos_compra(id) ON DELETE CASCADE,
  materia_prima_id uuid REFERENCES public.materias_primas_producao(id),
  descricao       text NOT NULL,
  quantidade      numeric(12,3) NOT NULL,
  unidade         text NOT NULL DEFAULT 'm',
  valor_unitario  numeric(12,4) NOT NULL DEFAULT 0,
  valor_total     numeric(14,2) GENERATED ALWAYS AS (quantidade * valor_unitario) STORED,
  quantidade_recebida numeric(12,3) NOT NULL DEFAULT 0,
  lote_recebido   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pedidos_compra ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_compra_itens ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_pedidos_compra_updated_at ON public.pedidos_compra;
CREATE TRIGGER trg_pedidos_compra_updated_at BEFORE UPDATE ON public.pedidos_compra
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Contas a Pagar / Receber ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contas_financeiras (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo            text NOT NULL CHECK (tipo IN ('pagar','receber')),
  descricao       text NOT NULL,
  valor           numeric(14,2) NOT NULL CHECK (valor > 0),
  data_emissao    date NOT NULL DEFAULT CURRENT_DATE,
  data_vencimento date NOT NULL,
  data_pagamento  date,
  status          text NOT NULL DEFAULT 'aberto'
    CHECK (status IN ('aberto','pago','vencido','cancelado')),
  categoria       text NOT NULL DEFAULT 'outros',
  -- Vínculos
  pedido_id       uuid REFERENCES public.pedidos_comerciais(id),   -- conta a receber de venda
  pedido_compra_id uuid REFERENCES public.pedidos_compra(id),       -- conta a pagar de compra
  fornecedor_id   uuid REFERENCES public.fornecedores(id),
  nota_fiscal     text,
  banco_id        uuid REFERENCES public.financeiro_contas_bancarias(id),
  observacoes     text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.contas_financeiras ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_contas_updated_at ON public.contas_financeiras;
CREATE TRIGGER trg_contas_updated_at BEFORE UPDATE ON public.contas_financeiras
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-atualiza status vencido via trigger
CREATE OR REPLACE FUNCTION public.atualizar_status_vencido()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f01$
  UPDATE public.contas_financeiras
  SET status = 'vencido', updated_at = now()
  WHERE status = 'aberto'
    AND data_vencimento < CURRENT_DATE;
$f01$;
GRANT EXECUTE ON FUNCTION public.atualizar_status_vencido() TO authenticated;

-- ── Ferramentas de corte / CNC ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ferramentas_cnc (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          text NOT NULL UNIQUE,
  descricao       text NOT NULL,
  tipo            text NOT NULL DEFAULT 'broca'
    CHECK (tipo IN ('broca','inserto','pastilha','fresa','alargador','outros')),
  maquina_codigo  text REFERENCES public.maquinas_producao(codigo),
  vida_util_pecas integer NOT NULL DEFAULT 0,   -- 0 = ilimitado
  vida_util_horas numeric(8,2) DEFAULT NULL,
  pecas_produzidas integer NOT NULL DEFAULT 0,
  horas_uso       numeric(8,2) NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo','alerta','substituir','inativo')),
  ultima_troca    date,
  fornecedor_id   uuid REFERENCES public.fornecedores(id),
  custo_unitario  numeric(10,2),
  observacoes     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ferramentas_cnc ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_ferramentas_updated_at ON public.ferramentas_cnc;
CREATE TRIGGER trg_ferramentas_updated_at BEFORE UPDATE ON public.ferramentas_cnc
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Certificados e Documentos Regulatórios ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.certificados (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            text NOT NULL,
  tipo            text NOT NULL DEFAULT 'iso'
    CHECK (tipo IN ('iso','anvisa','inmetro','laudo','certificado','outros')),
  numero          text,
  orgao_emissor   text,
  data_emissao    date,
  data_validade   date,
  arquivo_url     text,   -- Storage bucket: certificados/
  status          text NOT NULL DEFAULT 'valido'
    CHECK (status IN ('valido','vencendo','vencido','renovacao')),
  alerta_dias     integer NOT NULL DEFAULT 90,  -- alertar N dias antes do vencimento
  observacoes     text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.certificados ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_certificados_updated_at ON public.certificados;
CREATE TRIGGER trg_certificados_updated_at BEFORE UPDATE ON public.certificados
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Rastreabilidade Pós-Venda (lote → cliente/paciente) ──────────────────────
CREATE TABLE IF NOT EXISTS public.rastreabilidade_pos_venda (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id       uuid NOT NULL REFERENCES public.pedidos_comerciais(id),
  pedido_item_id  uuid NOT NULL REFERENCES public.pedido_itens(id),
  stock_item_id   uuid NOT NULL REFERENCES public.stock_items(id),
  lote            text NOT NULL,
  device_id       uuid REFERENCES public.devices(id),
  device_ref      text NOT NULL,
  device_model    text NOT NULL,
  udi_di          text,
  quantidade      integer NOT NULL,
  -- Destinação clínica (para ANVISA)
  cliente_id      uuid REFERENCES public.clientes(id),
  cliente_nome    text NOT NULL,
  clinica         text,      -- nome da clínica/hospital
  cirurgiao       text,      -- nome do profissional
  paciente_codigo text,      -- código interno (não nome — LGPD)
  data_envio      date NOT NULL,
  -- Recall
  status_recall   text NOT NULL DEFAULT 'normal'
    CHECK (status_recall IN ('normal','alerta','recall_ativo','devolvido')),
  observacoes     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rastreabilidade_pos_venda ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_rastreab_lote   ON public.rastreabilidade_pos_venda (lote);
CREATE INDEX IF NOT EXISTS idx_rastreab_device ON public.rastreabilidade_pos_venda (device_id);
CREATE INDEX IF NOT EXISTS idx_rastreab_pedido ON public.rastreabilidade_pos_venda (pedido_id);

-- ── Metas de Produção ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.metas_producao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mes             integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  ano             integer NOT NULL,
  maquina_codigo  text,   -- NULL = meta geral
  meta_pecas      integer NOT NULL DEFAULT 0,
  meta_oee_pct    numeric(5,2) NOT NULL DEFAULT 85.0,
  meta_disponibilidade_pct numeric(5,2) NOT NULL DEFAULT 90.0,
  meta_qualidade_pct numeric(5,2) NOT NULL DEFAULT 98.0,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mes, ano, maquina_codigo)
);
ALTER TABLE public.metas_producao ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies ─────────────────────────────────────────────────────────────
-- Fornecedores
DROP POLICY IF EXISTS "forn_select" ON public.fornecedores;
CREATE POLICY "forn_select" ON public.fornecedores FOR SELECT USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "forn_write" ON public.fornecedores;
CREATE POLICY "forn_write"  ON public.fornecedores FOR ALL USING (public.get_my_role() IN ('admin','estoque','financeiro'));

-- Pedidos de compra
DROP POLICY IF EXISTS "pc_select" ON public.pedidos_compra;
CREATE POLICY "pc_select" ON public.pedidos_compra FOR SELECT USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "pc_write" ON public.pedidos_compra;
CREATE POLICY "pc_write"  ON public.pedidos_compra FOR ALL USING (public.get_my_role() IN ('admin','estoque','financeiro'));
DROP POLICY IF EXISTS "pci_select" ON public.pedido_compra_itens;
CREATE POLICY "pci_select" ON public.pedido_compra_itens FOR SELECT USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "pci_write" ON public.pedido_compra_itens;
CREATE POLICY "pci_write"  ON public.pedido_compra_itens FOR ALL USING (public.get_my_role() IN ('admin','estoque','financeiro'));

-- Contas
DROP POLICY IF EXISTS "cf_select" ON public.contas_financeiras;
CREATE POLICY "cf_select" ON public.contas_financeiras FOR SELECT USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "cf_write" ON public.contas_financeiras;
CREATE POLICY "cf_write"  ON public.contas_financeiras FOR ALL USING (public.get_my_role() IN ('admin','financeiro'));

-- Ferramentas
DROP POLICY IF EXISTS "ferr_select" ON public.ferramentas_cnc;
CREATE POLICY "ferr_select" ON public.ferramentas_cnc FOR SELECT USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "ferr_write" ON public.ferramentas_cnc;
CREATE POLICY "ferr_write"  ON public.ferramentas_cnc FOR ALL USING (public.get_my_role() IN ('admin','producao'));

-- Certificados
DROP POLICY IF EXISTS "cert_select" ON public.certificados;
CREATE POLICY "cert_select" ON public.certificados FOR SELECT USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "cert_write" ON public.certificados;
CREATE POLICY "cert_write"  ON public.certificados FOR ALL USING (public.get_my_role() IN ('admin','qualidade'));

-- Rastreabilidade
DROP POLICY IF EXISTS "rastr_select" ON public.rastreabilidade_pos_venda;
CREATE POLICY "rastr_select" ON public.rastreabilidade_pos_venda FOR SELECT USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "rastr_write" ON public.rastreabilidade_pos_venda;
CREATE POLICY "rastr_write"  ON public.rastreabilidade_pos_venda FOR ALL USING (public.get_my_role() IN ('admin','qualidade','comercial'));

-- Metas
DROP POLICY IF EXISTS "metas_select" ON public.metas_producao;
CREATE POLICY "metas_select" ON public.metas_producao FOR SELECT USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "metas_write" ON public.metas_producao;
CREATE POLICY "metas_write"  ON public.metas_producao FOR ALL USING (public.get_my_role() IN ('admin','producao'));

-- ── GRANTs ────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fornecedores             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedidos_compra           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedido_compra_itens      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contas_financeiras        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ferramentas_cnc           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.certificados              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rastreabilidade_pos_venda TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.metas_producao            TO authenticated;

-- ── Trigger: cria conta a receber quando NF-e é emitida ──────────────────────
CREATE OR REPLACE FUNCTION public.criar_conta_receber_nfe()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f02$
DECLARE
  v_total numeric;
  v_cliente text;
BEGIN
  -- Só cria quando status muda para 'faturado' e tem nota fiscal
  IF NEW.status = 'faturado' AND OLD.status != 'faturado' AND NEW.nota_fiscal IS NOT NULL THEN
    SELECT SUM(pi.quantidade * COALESCE(pi.valor_unitario, 0)) + NEW.frete
    INTO v_total
    FROM public.pedido_itens pi WHERE pi.pedido_id = NEW.id;

    SELECT c.nome INTO v_cliente FROM public.clientes c WHERE c.id = NEW.cliente_id;

    INSERT INTO public.contas_financeiras (
      tipo, descricao, valor, data_emissao, data_vencimento,
      status, categoria, pedido_id, nota_fiscal, created_by
    ) VALUES (
      'receber',
      'NF-e ' || NEW.nota_fiscal || ' — ' || COALESCE(v_cliente, 'Cliente'),
      GREATEST(v_total, 0.01),
      CURRENT_DATE,
      CURRENT_DATE + INTERVAL '30 days',
      'aberto',
      'venda',
      NEW.id,
      NEW.nota_fiscal,
      NEW.faturado_por
    );
  END IF;
  RETURN NEW;
END;
$f02$;

DROP TRIGGER IF EXISTS trg_criar_conta_receber ON public.pedidos_comerciais;
CREATE TRIGGER trg_criar_conta_receber
  AFTER UPDATE OF status ON public.pedidos_comerciais
  FOR EACH ROW EXECUTE FUNCTION public.criar_conta_receber_nfe();

-- ── Trigger: rastreabilidade pós-venda quando pedido vai para 'enviado' ───────
CREATE OR REPLACE FUNCTION public.criar_rastreabilidade_pos_venda()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f03$
BEGIN
  IF NEW.status = 'enviado' AND OLD.status != 'enviado' THEN
    INSERT INTO public.rastreabilidade_pos_venda (
      pedido_id, pedido_item_id, stock_item_id, lote,
      device_id, device_ref, device_model, udi_di,
      quantidade, cliente_id, cliente_nome, data_envio
    )
    SELECT
      NEW.id, pi.id, pi.stock_item_id,
      COALESCE(pi.lote, ''),
      d.id, d.reference, d.model, d.udi_di,
      pi.quantidade,
      NEW.cliente_id,
      COALESCE((SELECT nome FROM public.clientes WHERE id = NEW.cliente_id), ''),
      CURRENT_DATE
    FROM public.pedido_itens pi
    JOIN public.stock_items si ON si.id = pi.stock_item_id
    JOIN public.devices d ON d.id = si.device_id
    WHERE pi.pedido_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$f03$;

DROP TRIGGER IF EXISTS trg_rastreabilidade_pos_venda ON public.pedidos_comerciais;
CREATE TRIGGER trg_rastreabilidade_pos_venda
  AFTER UPDATE OF status ON public.pedidos_comerciais
  FOR EACH ROW EXECUTE FUNCTION public.criar_rastreabilidade_pos_venda();

-- ── Bucket certificados ───────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('certificados', 'certificados', false, 10485760,
        ARRAY['application/pdf','image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "cert_storage_select" ON storage.objects;
CREATE POLICY "cert_storage_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'certificados');
DROP POLICY IF EXISTS "cert_storage_insert" ON storage.objects;
CREATE POLICY "cert_storage_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'certificados' AND public.is_admin_user());
DROP POLICY IF EXISTS "cert_storage_delete" ON storage.objects;
CREATE POLICY "cert_storage_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'certificados' AND public.is_admin_user());

-- ── RPC: Dashboard Gerencial (KPIs unificados) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.dashboard_gerencial()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $f04$
DECLARE
  v_hoje       date := CURRENT_DATE;
  v_mes_ini    date := date_trunc('month', v_hoje)::date;
  v_result     jsonb;
BEGIN
  SELECT jsonb_build_object(
    -- ESTOQUE
    'estoque_intermediario_qty',  (SELECT COALESCE(SUM(quantity),0) FROM stock_items WHERE fase='intermediaria'),
    'estoque_expedicao_qty',      (SELECT COALESCE(SUM(quantity),0) FROM stock_items WHERE fase='expedicao'),
    'estoque_critico',            (SELECT COUNT(*) FROM stock_items WHERE quantity > 0 AND min_quantity > 0 AND quantity <= min_quantity),
    -- COMERCIAL
    'pedidos_pendentes',          (SELECT COUNT(*) FROM pedidos_comerciais WHERE status IN ('pendente','separando')),
    'pedidos_prontos',            (SELECT COUNT(*) FROM pedidos_comerciais WHERE status='pronto'),
    'faturamento_mes',            (SELECT COALESCE(SUM(
                                    (SELECT SUM(pi.quantidade*COALESCE(pi.valor_unitario,0)) FROM pedido_itens pi WHERE pi.pedido_id=pc.id)
                                    + pc.frete
                                  ),0) FROM pedidos_comerciais pc WHERE pc.status IN ('faturado','enviado') AND pc.nf_criada_em >= v_mes_ini),
    'pedidos_atrasados',          (SELECT COUNT(*) FROM pedidos_comerciais WHERE status='pronto' AND created_at < (now() - INTERVAL '7 days')),
    -- FINANCEIRO
    'contas_receber_abertas',     (SELECT COALESCE(SUM(valor),0) FROM contas_financeiras WHERE tipo='receber' AND status='aberto'),
    'contas_receber_vencidas',    (SELECT COALESCE(SUM(valor),0) FROM contas_financeiras WHERE tipo='receber' AND status='vencido'),
    'contas_pagar_abertas',       (SELECT COALESCE(SUM(valor),0) FROM contas_financeiras WHERE tipo='pagar' AND status='aberto'),
    'contas_pagar_vencidas',      (SELECT COALESCE(SUM(valor),0) FROM contas_financeiras WHERE tipo='pagar' AND status='vencido'),
    'contas_vencer_7d',           (SELECT COUNT(*) FROM contas_financeiras WHERE status='aberto' AND data_vencimento BETWEEN v_hoje AND v_hoje+7),
    -- PRODUÇÃO
    'oee_mes',                    (SELECT oee FROM jsonb_to_record(public.calcular_oee(v_mes_ini, v_hoje, NULL)) AS x(oee numeric)),
    'apontamentos_hoje',          (SELECT COUNT(*) FROM apontamentos_producao WHERE data_apontamento = v_hoje),
    'pecas_produzidas_mes',       (SELECT COALESCE(SUM(quantidade),0) FROM apontamentos_producao WHERE data_apontamento >= v_mes_ini),
    -- QUALIDADE / ANVISA
    'devices_vencendo_anvisa',    (SELECT COUNT(*) FROM devices WHERE data_vencimento_anvisa IS NOT NULL AND data_vencimento_anvisa BETWEEN v_hoje AND v_hoje+90),
    'devices_anvisa_vencidos',    (SELECT COUNT(*) FROM devices WHERE data_vencimento_anvisa IS NOT NULL AND data_vencimento_anvisa < v_hoje),
    'certificados_vencendo',      (SELECT COUNT(*) FROM certificados WHERE data_validade IS NOT NULL AND data_validade BETWEEN v_hoje AND v_hoje+90 AND status != 'vencido'),
    'certificados_vencidos',      (SELECT COUNT(*) FROM certificados WHERE data_validade < v_hoje AND status != 'vencido'),
    -- FERRAMENTAS
    'ferramentas_alerta',         (SELECT COUNT(*) FROM ferramentas_cnc WHERE status IN ('alerta','substituir')),
    -- RASTREABILIDADE
    'recall_ativos',              (SELECT COUNT(*) FROM rastreabilidade_pos_venda WHERE status_recall IN ('alerta','recall_ativo'))
  ) INTO v_result;
  RETURN v_result;
END;
$f04$;

GRANT EXECUTE ON FUNCTION public.dashboard_gerencial() TO authenticated;

-- Seed: certificados iniciais padrão (só insere se a tabela estiver vazia)
DO $seed$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.certificados LIMIT 1) THEN
    INSERT INTO public.certificados (nome, tipo, orgao_emissor, alerta_dias, observacoes) (nome, tipo, orgao_emissor, alerta_dias, observacoes) VALUES
  ('ISO 13485 — Sistema de Gestão da Qualidade',     'iso',     'Bureau Veritas / DNV', 90, 'Obrigatório para fabricantes de DM Classe II e III'),
  ('Autorização de Funcionamento ANVISA (AFE)',      'anvisa',  'ANVISA',               90, 'Renovar a cada 2 anos'),
  ('Licença de Funcionamento ANVISA (LFE)',          'anvisa',  'ANVISA',               90, 'Renovar anualmente'),
  ('Cadastro Nacional de Pessoa Jurídica (CNPJ)',    'outros',  'Receita Federal',       30, 'Verificar situação cadastral anualmente'),
  ('Inscrição Estadual',                             'outros',  'SEFAZ Estadual',        30, 'Verificar situação anualmente');
  END IF;
END;
$seed$;
