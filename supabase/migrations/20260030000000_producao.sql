-- =============================================================================
-- PRODUÇÃO — Máquinas, produtos, apontamentos, PPI-51, OEE, paradas, refugos, MP
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 20260013000000_producao_module.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS maquinas_producao (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo            text NOT NULL UNIQUE,
  nome              text NOT NULL,
  setor             text NOT NULL DEFAULT 'usinagem',
  status            text NOT NULL DEFAULT 'operando' CHECK (status IN ('operando','parada','manutencao','setup')),
  disponibilidade   numeric(5,2) NOT NULL DEFAULT 100,
  ultima_manutencao  date,
  proxima_manutencao date,
  horimetro         numeric(10,1) DEFAULT 0,
  fabricante        text,
  modelo            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS produtos_producao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          text NOT NULL UNIQUE,
  descricao       text NOT NULL,
  tempo_ciclo_seg integer NOT NULL DEFAULT 0,
  pecas_por_hora  integer NOT NULL DEFAULT 0,
  tipo_material   text NOT NULL DEFAULT 'aco_carbono',
  lead_time_dias  integer NOT NULL DEFAULT 0,
  dim_comprimento numeric(10,3),
  dim_largura     numeric(10,3),
  dim_altura      numeric(10,3),
  dim_diametro    numeric(10,3),
  peso_gramas     numeric(10,2),
  ativo           boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS apontamentos_producao (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto    text NOT NULL,
  lote       text NOT NULL,
  maquina    text NOT NULL,
  operador   text NOT NULL,
  turno      text NOT NULL DEFAULT '1º Turno' CHECK (turno IN ('1º Turno','2º Turno','3º Turno')),
  quantidade integer NOT NULL DEFAULT 0,
  inicio     text NOT NULL,
  fim        text,
  status     text NOT NULL DEFAULT 'em_andamento' CHECK (status IN ('em_andamento','concluido')),
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ordens_planejamento (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero      text NOT NULL UNIQUE,
  produto     text NOT NULL,
  maquina     text NOT NULL,
  turno       text NOT NULL DEFAULT '1º Turno',
  quantidade  integer NOT NULL DEFAULT 0,
  data_inicio date NOT NULL,
  data_fim    date NOT NULL,
  status      text NOT NULL DEFAULT 'planejada' CHECK (status IN ('planejada','em_producao','concluida','cancelada')),
  prioridade  text NOT NULL DEFAULT 'normal' CHECK (prioridade IN ('baixa','normal','alta','urgente')),
  capacidade  numeric(5,2) DEFAULT 0,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paradas_producao (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maquina      text NOT NULL,
  motivo       text NOT NULL,
  tipo         text NOT NULL DEFAULT 'nao_planejada' CHECK (tipo IN ('planejada','nao_planejada')),
  inicio       timestamptz NOT NULL DEFAULT now(),
  fim          timestamptz,
  duracao_min  integer,
  operador     text NOT NULL,
  observacoes  text,
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refugos_producao (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto      text NOT NULL,
  lote         text NOT NULL,
  maquina      text NOT NULL,
  operador     text NOT NULL,
  tipo_defeito text NOT NULL DEFAULT 'dimensional',
  motivo       text NOT NULL,
  quantidade   integer NOT NULL DEFAULT 0,
  destinacao   text NOT NULL DEFAULT 'retrabalho' CHECK (destinacao IN ('retrabalho','sucata','devolucao')),
  medicoes     jsonb DEFAULT '[]',
  observacoes  text,
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS materias_primas_producao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          text NOT NULL UNIQUE,
  descricao       text NOT NULL,
  unidade         text NOT NULL DEFAULT 'm',
  estoque_atual   numeric(12,3) NOT NULL DEFAULT 0,
  estoque_minimo  numeric(12,3) NOT NULL DEFAULT 0,
  estoque_maximo  numeric(12,3) NOT NULL DEFAULT 999,
  lote_atual      text,
  fornecedor      text,
  ultima_entrada  date,
  ultima_saida    date,
  localizacao     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS movimentos_mp_producao (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  materia_prima_id    uuid REFERENCES materias_primas_producao(id) ON DELETE CASCADE,
  materia_prima_desc  text NOT NULL,
  tipo                text NOT NULL DEFAULT 'saida' CHECK (tipo IN ('entrada','saida','ajuste')),
  quantidade          numeric(12,3) NOT NULL DEFAULT 0,
  lote                text,
  operador            text NOT NULL,
  ordem_producao      text,
  observacoes         text,
  user_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE maquinas_producao        ENABLE ROW LEVEL SECURITY;
ALTER TABLE produtos_producao        ENABLE ROW LEVEL SECURITY;
ALTER TABLE apontamentos_producao    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordens_planejamento      ENABLE ROW LEVEL SECURITY;
ALTER TABLE paradas_producao         ENABLE ROW LEVEL SECURITY;
ALTER TABLE refugos_producao         ENABLE ROW LEVEL SECURITY;
ALTER TABLE materias_primas_producao ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimentos_mp_producao   ENABLE ROW LEVEL SECURITY;

-- Políticas simples: todos autenticados lêem; roles específicos escrevem
DROP POLICY IF EXISTS "maq_select" ON maquinas_producao; CREATE POLICY "maq_select" ON maquinas_producao FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "maq_insert" ON maquinas_producao; CREATE POLICY "maq_insert" ON maquinas_producao FOR INSERT WITH CHECK (public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "maq_update" ON maquinas_producao; CREATE POLICY "maq_update" ON maquinas_producao FOR UPDATE USING (public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "maq_delete" ON maquinas_producao; CREATE POLICY "maq_delete" ON maquinas_producao FOR DELETE USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "prod_select" ON produtos_producao; CREATE POLICY "prod_select" ON produtos_producao FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "prod_insert" ON produtos_producao; CREATE POLICY "prod_insert" ON produtos_producao FOR INSERT WITH CHECK (public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "prod_update" ON produtos_producao; CREATE POLICY "prod_update" ON produtos_producao FOR UPDATE USING (public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "prod_delete" ON produtos_producao; CREATE POLICY "prod_delete" ON produtos_producao FOR DELETE USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "apon_select" ON apontamentos_producao; CREATE POLICY "apon_select" ON apontamentos_producao FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "apon_insert" ON apontamentos_producao; CREATE POLICY "apon_insert" ON apontamentos_producao FOR INSERT WITH CHECK (public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "apon_update" ON apontamentos_producao; CREATE POLICY "apon_update" ON apontamentos_producao FOR UPDATE USING (auth.uid() = user_id OR public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "apon_delete" ON apontamentos_producao; CREATE POLICY "apon_delete" ON apontamentos_producao FOR DELETE USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "op_select" ON ordens_planejamento; CREATE POLICY "op_select" ON ordens_planejamento FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "op_insert" ON ordens_planejamento; CREATE POLICY "op_insert" ON ordens_planejamento FOR INSERT WITH CHECK (public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "op_update" ON ordens_planejamento; CREATE POLICY "op_update" ON ordens_planejamento FOR UPDATE USING (public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "op_delete" ON ordens_planejamento; CREATE POLICY "op_delete" ON ordens_planejamento FOR DELETE USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "par_select" ON paradas_producao; CREATE POLICY "par_select" ON paradas_producao FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "par_insert" ON paradas_producao; CREATE POLICY "par_insert" ON paradas_producao FOR INSERT WITH CHECK (public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "par_update" ON paradas_producao; CREATE POLICY "par_update" ON paradas_producao FOR UPDATE USING (auth.uid() = user_id OR public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "par_delete" ON paradas_producao; CREATE POLICY "par_delete" ON paradas_producao FOR DELETE USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "ref_select" ON refugos_producao; CREATE POLICY "ref_select" ON refugos_producao FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "ref_insert" ON refugos_producao; CREATE POLICY "ref_insert" ON refugos_producao FOR INSERT WITH CHECK (public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "ref_update" ON refugos_producao; CREATE POLICY "ref_update" ON refugos_producao FOR UPDATE USING (auth.uid() = user_id OR public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "ref_delete" ON refugos_producao; CREATE POLICY "ref_delete" ON refugos_producao FOR DELETE USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "mp_select" ON materias_primas_producao; CREATE POLICY "mp_select" ON materias_primas_producao FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "mp_insert" ON materias_primas_producao; CREATE POLICY "mp_insert" ON materias_primas_producao FOR INSERT WITH CHECK (public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "mp_update" ON materias_primas_producao; CREATE POLICY "mp_update" ON materias_primas_producao FOR UPDATE USING (public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "mp_delete" ON materias_primas_producao; CREATE POLICY "mp_delete" ON materias_primas_producao FOR DELETE USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "mov_select" ON movimentos_mp_producao; CREATE POLICY "mov_select" ON movimentos_mp_producao FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "mov_insert" ON movimentos_mp_producao; CREATE POLICY "mov_insert" ON movimentos_mp_producao FOR INSERT WITH CHECK (public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "mov_delete" ON movimentos_mp_producao; CREATE POLICY "mov_delete" ON movimentos_mp_producao FOR DELETE USING (public.get_my_role() = 'admin');

-- Triggers updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at_producao()
RETURNS TRIGGER LANGUAGE plpgsql AS $f01$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $f01$;

DROP TRIGGER IF EXISTS maq_updated_at  ON maquinas_producao;        CREATE TRIGGER maq_updated_at  BEFORE UPDATE ON maquinas_producao        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_producao();
DROP TRIGGER IF EXISTS prod_updated_at ON produtos_producao;         CREATE TRIGGER prod_updated_at BEFORE UPDATE ON produtos_producao         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_producao();
DROP TRIGGER IF EXISTS apon_updated_at ON apontamentos_producao;     CREATE TRIGGER apon_updated_at BEFORE UPDATE ON apontamentos_producao     FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_producao();
DROP TRIGGER IF EXISTS op_updated_at   ON ordens_planejamento;       CREATE TRIGGER op_updated_at   BEFORE UPDATE ON ordens_planejamento       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_producao();
DROP TRIGGER IF EXISTS mp_updated_at   ON materias_primas_producao;  CREATE TRIGGER mp_updated_at   BEFORE UPDATE ON materias_primas_producao  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_producao();

-- Índices
CREATE INDEX IF NOT EXISTS idx_apontamentos_status  ON apontamentos_producao(status);
CREATE INDEX IF NOT EXISTS idx_apontamentos_created ON apontamentos_producao(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paradas_maquina      ON paradas_producao(maquina);
CREATE INDEX IF NOT EXISTS idx_refugos_created      ON refugos_producao(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ordens_status        ON ordens_planejamento(status);
CREATE INDEX IF NOT EXISTS idx_movimentos_mp_created ON movimentos_mp_producao(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260030000000_producao_ppi51_completo.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Execução atômica em uma única migration:
--   1. Expansão do schema (novos campos + tabelas)
--   2. Seed com dados reais da empresa (máquinas, produtos, MPs, paradas, refugos)
--   3. RPCs para apontamento atômico, OEE real e resumo mensal

-- ═══════════════════════════════════════════════════════════════════════════════
-- PARTE 1: SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Expandir apontamentos_producao com todos os campos do PPI-51 ──────────────
ALTER TABLE public.apontamentos_producao
  ADD COLUMN IF NOT EXISTS seq_producao      integer,
  ADD COLUMN IF NOT EXISTS data_apontamento  date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS maquina_codigo    text,
  ADD COLUMN IF NOT EXISTS equipamento       text,
  ADD COLUMN IF NOT EXISTS grupo             text NOT NULL DEFAULT 'TORNO CNC',
  ADD COLUMN IF NOT EXISTS descricao_produto text,
  ADD COLUMN IF NOT EXISTS unidade_medida    text NOT NULL DEFAULT 'PC',
  ADD COLUMN IF NOT EXISTS qtde_por_hora     numeric(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS horas_planejadas  numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qtde_prevista     numeric(10,2) GENERATED ALWAYS AS
                              (qtde_por_hora * horas_planejadas) STORED,
  ADD COLUMN IF NOT EXISTS qtde_plan_disp    numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS horario_inicio    numeric(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS horario_fim       numeric(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cycle_time_min    numeric(8,4),
  ADD COLUMN IF NOT EXISTS lead_time_horas   numeric(8,2),
  ADD COLUMN IF NOT EXISTS lote_mp           text,
  ADD COLUMN IF NOT EXISTS descricao_mp      text,
  ADD COLUMN IF NOT EXISTS comprimento_mm    numeric(8,3),
  ADD COLUMN IF NOT EXISTS consumo_mp_metros numeric(12,3);

-- Sequence para Nº Sequência Produção
CREATE SEQUENCE IF NOT EXISTS public.seq_apontamento_producao
  START WITH 1 INCREMENT BY 1 NO MAXVALUE CACHE 1;

-- ── Paradas vinculadas ao apontamento (1 AP → N paradas) ─────────────────────
CREATE TABLE IF NOT EXISTS public.apontamento_paradas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  apontamento_id   uuid NOT NULL REFERENCES public.apontamentos_producao(id) ON DELETE CASCADE,
  tipo_parada_id   integer NOT NULL,
  tipo_parada_nome text NOT NULL,
  duracao_horas    numeric(6,4) NOT NULL DEFAULT 0,
  observacao       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Refugos vinculados ao apontamento (1 AP → N refugos) ─────────────────────
CREATE TABLE IF NOT EXISTS public.apontamento_refugos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  apontamento_id   uuid NOT NULL REFERENCES public.apontamentos_producao(id) ON DELETE CASCADE,
  tipo_refugo_id   integer NOT NULL,
  tipo_refugo_nome text NOT NULL,
  quantidade       integer NOT NULL DEFAULT 0,
  observacao       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Tipos de parada ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tipo_parada_producao (
  id         serial PRIMARY KEY,
  nome       text NOT NULL UNIQUE,
  categoria  text NOT NULL DEFAULT 'operacional'
    CHECK (categoria IN ('operacional','manutencao','setup','qualidade','outros')),
  ativo      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Tipos de refugo ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tipo_refugo_producao (
  id         serial PRIMARY KEY,
  nome       text NOT NULL UNIQUE,
  ativo      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Coluna unidade_medida em produtos_producao ────────────────────────────────
ALTER TABLE public.produtos_producao
  ADD COLUMN IF NOT EXISTS unidade_medida text NOT NULL DEFAULT 'PC';

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.apontamento_paradas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apontamento_refugos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tipo_parada_producao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tipo_refugo_producao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ap_paradas_select" ON public.apontamento_paradas;
DROP POLICY IF EXISTS "ap_paradas_insert" ON public.apontamento_paradas;
DROP POLICY IF EXISTS "ap_paradas_delete" ON public.apontamento_paradas;
DROP POLICY IF EXISTS "ap_paradas_select" ON public.apontamento_paradas;
CREATE POLICY "ap_paradas_select" ON public.apontamento_paradas FOR SELECT USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "ap_paradas_insert" ON public.apontamento_paradas;
CREATE POLICY "ap_paradas_insert" ON public.apontamento_paradas FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "ap_paradas_delete" ON public.apontamento_paradas;
CREATE POLICY "ap_paradas_delete" ON public.apontamento_paradas FOR DELETE USING (public.get_my_role() IN ('admin','producao'));

DROP POLICY IF EXISTS "ap_refugos_select" ON public.apontamento_refugos;
DROP POLICY IF EXISTS "ap_refugos_insert" ON public.apontamento_refugos;
DROP POLICY IF EXISTS "ap_refugos_delete" ON public.apontamento_refugos;
DROP POLICY IF EXISTS "ap_refugos_select" ON public.apontamento_refugos;
CREATE POLICY "ap_refugos_select" ON public.apontamento_refugos FOR SELECT USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "ap_refugos_insert" ON public.apontamento_refugos;
CREATE POLICY "ap_refugos_insert" ON public.apontamento_refugos FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "ap_refugos_delete" ON public.apontamento_refugos;
CREATE POLICY "ap_refugos_delete" ON public.apontamento_refugos FOR DELETE USING (public.get_my_role() IN ('admin','producao'));

DROP POLICY IF EXISTS "tp_select" ON public.tipo_parada_producao;
DROP POLICY IF EXISTS "tp_write"  ON public.tipo_parada_producao;
DROP POLICY IF EXISTS "tp_select" ON public.tipo_parada_producao;
CREATE POLICY "tp_select" ON public.tipo_parada_producao FOR SELECT USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "tp_write"  ON public.tipo_parada_producao FOR ALL   USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "tr_select" ON public.tipo_refugo_producao;
DROP POLICY IF EXISTS "tr_write"  ON public.tipo_refugo_producao;
DROP POLICY IF EXISTS "tr_select" ON public.tipo_refugo_producao;
CREATE POLICY "tr_select" ON public.tipo_refugo_producao FOR SELECT USING ((select auth.uid()) IS NOT NULL);
CREATE POLICY "tr_write"  ON public.tipo_refugo_producao FOR ALL   USING (public.get_my_role() = 'admin');

-- ── Índices ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ap_data       ON public.apontamentos_producao (data_apontamento DESC);
CREATE INDEX IF NOT EXISTS idx_ap_maquina    ON public.apontamentos_producao (maquina_codigo);
CREATE INDEX IF NOT EXISTS idx_ap_paradas_ap ON public.apontamento_paradas (apontamento_id);
CREATE INDEX IF NOT EXISTS idx_ap_refugos_ap ON public.apontamento_refugos (apontamento_id);

GRANT SELECT ON public.apontamento_paradas  TO authenticated;
GRANT INSERT ON public.apontamento_paradas  TO authenticated;
GRANT SELECT ON public.apontamento_refugos  TO authenticated;
GRANT INSERT ON public.apontamento_refugos  TO authenticated;
GRANT SELECT ON public.tipo_parada_producao TO authenticated;
GRANT SELECT ON public.tipo_refugo_producao TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PARTE 2: SEED COM DADOS REAIS DA EMPRESA
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 6 Máquinas reais (Tornos CNC) ────────────────────────────────────────────
INSERT INTO public.maquinas_producao (codigo, nome, setor, status, modelo)
VALUES
  ('MQ001', '16CSBIII', 'usinagem', 'operando', '16CSBIII'),
  ('MQ002', 'XD12H',    'usinagem', 'operando', 'XD12H'),
  ('MQ003', 'XD20H',    'usinagem', 'operando', 'XD20H'),
  ('MQ004', 'XP16S',    'usinagem', 'operando', 'XP16S'),
  ('MQ005', '20J3XB',   'usinagem', 'operando', '20J3XB'),
  ('MQ006', 'XE20H',    'usinagem', 'operando', 'XE20H')
ON CONFLICT (codigo) DO UPDATE SET
  nome   = EXCLUDED.nome,
  modelo = EXCLUDED.modelo;

-- ── 10 Tipos de parada reais ──────────────────────────────────────────────────
INSERT INTO public.tipo_parada_producao (id, nome, categoria) VALUES
  (1,  'Refeição',                'operacional'),
  (2,  'Café',                    'operacional'),
  (3,  'Limpeza',                 'operacional'),
  (4,  'Manut de Máq',            'manutencao'),
  (5,  'Ajuste de Máq',           'setup'),
  (6,  'Liberação de Máq',        'setup'),
  (7,  'SetUp',                   'setup'),
  (8,  'Troca P/ Quebra de Ferr', 'manutencao'),
  (9,  'Troca Preventiva',        'manutencao'),
  (10, 'Outros',                  'outros')
ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria;
SELECT setval('public.tipo_parada_producao_id_seq', 10, true);

-- ── 5 Tipos de refugo reais ───────────────────────────────────────────────────
INSERT INTO public.tipo_refugo_producao (id, nome) VALUES
  (1, 'Fora do Dimensional'),
  (2, 'Gap'),
  (3, 'Amassado'),
  (4, 'Falha de Usinagem'),
  (5, 'Outros')
ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome;
SELECT setval('public.tipo_refugo_producao_id_seq', 5, true);

-- ── Matérias-primas reais ─────────────────────────────────────────────────────
INSERT INTO public.materias_primas_producao (codigo, descricao, unidade, estoque_atual) VALUES
  ('TI-25',  'TITÂNIO ASTM F136 Ø2.5',  'm', 0),
  ('TI-318', 'TITÂNIO ASTM F136 Ø3.18', 'm', 0),
  ('TI-40',  'TITÂNIO ASTM F136 Ø4.0',  'm', 0),
  ('TI-50',  'TITÂNIO ASTM F136 Ø5.0',  'm', 0),
  ('TI-55',  'TITÂNIO ASTM F136 Ø5.5',  'm', 0),
  ('TI-635', 'TITÂNIO ASTM F136 Ø6.35', 'm', 0),
  ('TI-80',  'TITÂNIO ASTM F136 Ø8.0',  'm', 0),
  ('TI-953', 'TITÂNIO ASTM F136 Ø9.53', 'm', 0),
  ('CC-40',  'CROMO COBALTO Ø4.0',       'm', 0),
  ('CC-50',  'CROMO COBALTO Ø5.0',       'm', 0),
  ('CC-55',  'CROMO COBALTO Ø5.5',       'm', 0),
  ('AI-25',  'AÇO INOX AISI 303 Ø2.5',  'm', 0),
  ('AI-40',  'AÇO INOX AISI 303 Ø4.0',  'm', 0),
  ('AI-50',  'AÇO INOX AISI 303 Ø5.0',  'm', 0),
  ('AI-55',  'AÇO INOX AISI 303 Ø5.5',  'm', 0),
  ('POM-60', 'POLIACETAL Ø6.0',          'm', 0)
ON CONFLICT (codigo) DO NOTHING;

-- ── Produtos reais ────────────────────────────────────────────────────────────
INSERT INTO public.produtos_producao (codigo, descricao, pecas_por_hora, unidade_medida, ativo) VALUES
  ('ADMU 4814',     'Análogo Digital Ø4.8 MU',           22, 'PC', true),
  ('IFEXAR 4820N',  'Interface Exact Ø4.8 N AR',          12, 'PC', true),
  ('IFMU 4814',     'Interface Ø4.8 MU',                  13, 'PC', true),
  ('PFE 18',        'Parafuso Fixação HE M1.8',           18, 'PC', true),
  ('PFE 20',        'Parafuso Fixação HE M2.0',           18, 'PC', true),
  ('PFMU 14',       'Parafuso Fixação M1.4 MU',           37, 'PC', true),
  ('UPER 3516BNO',  'Ucla Plástica HE Ø3.5 BNO R',       36, 'PC', true),
  ('ADI 3320E',     'Análogo Digital HI Ø3.3 E',          20, 'PC', true),
  ('ADI 4020E',     'Análogo Digital HI Ø4.0 E',          20, 'PC', true),
  ('IFMRAR 35180N', 'Interface R CM Ø3.5x0.3 N AR',      20, 'PC', true),
  ('IFMRAR 35181N', 'Interface R CM Ø3.5x1.0 N AR',      20, 'PC', true),
  ('IFMRAR 35182N', 'Interface R CM Ø3.5x2.0 N AR',      20, 'PC', true),
  ('IFMRAR 35183N', 'Interface R CM Ø3.5x3.0 N AR',      20, 'PC', true),
  ('IFMRAR 35184N', 'Interface R CM Ø3.5x4.0 N AR',      20, 'PC', true),
  ('TFE 3318NC',    'Transfer MF HE Ø3.3 NC',             25, 'PC', true),
  ('TFI 3818IMS',   'Transfer MF HI Ø3.8 S SW',           25, 'PC', true),
  ('UCERZ 3517T',   'Ucla B. CRCO HE Ø3.5 T R LZ',        20, 'PC', true),
  ('UCEAR 3620R',   'Ucla B. CRCO HE Ø3.6 R AR SWITCH',   20, 'PC', true)
ON CONFLICT (codigo) DO UPDATE SET
  descricao      = EXCLUDED.descricao,
  pecas_por_hora = EXCLUDED.pecas_por_hora;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PARTE 3: RPCs
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── RPC: apontamento atômico completo ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.criar_apontamento_ppi51(
  p_data               date,
  p_turno              text,
  p_maquina            text,
  p_equipamento        text,
  p_produto            text,
  p_descricao_produto  text,
  p_qtde_por_hora      numeric,
  p_horas_planejadas   numeric,
  p_qtde_plan_disp     numeric,
  p_qtde_produzida     integer,
  p_horario_inicio     numeric,
  p_horario_fim        numeric,
  p_cycle_time_min     numeric,
  p_lead_time_horas    numeric,
  p_lote               text,
  p_lote_mp            text,
  p_descricao_mp       text,
  p_comprimento_mm     numeric,
  p_consumo_mp_metros  numeric,
  p_operador           text,
  p_paradas            jsonb DEFAULT '[]',
  p_refugos            jsonb DEFAULT '[]'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f01$
DECLARE
  v_seq  integer;
  v_id   uuid;
  v_lote text;
BEGIN
  IF (select auth.uid()) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado');
  END IF;

  v_seq  := nextval('public.seq_apontamento_producao');
  v_id   := gen_random_uuid();
  v_lote := COALESCE(NULLIF(trim(p_lote), ''),
    to_char(p_data, 'DDMMYY') ||
    CASE WHEN p_turno LIKE '1%' THEN '1'
         WHEN p_turno LIKE '2%' THEN '2'
         ELSE '3' END || '-' || lpad(v_seq::text, 2, '0'));

  INSERT INTO public.apontamentos_producao (
    id, seq_producao, data_apontamento, turno,
    maquina, maquina_codigo, equipamento, grupo,
    produto, descricao_produto, unidade_medida,
    qtde_por_hora, horas_planejadas, qtde_plan_disp,
    quantidade, horario_inicio, horario_fim,
    cycle_time_min, lead_time_horas,
    lote, lote_mp, descricao_mp, comprimento_mm, consumo_mp_metros,
    operador, status, inicio, user_id
  ) VALUES (
    v_id, v_seq, p_data, p_turno,
    p_maquina, p_maquina, p_equipamento, 'TORNO CNC',
    p_produto, p_descricao_produto, 'PC',
    p_qtde_por_hora, p_horas_planejadas, p_qtde_plan_disp,
    p_qtde_produzida, p_horario_inicio, p_horario_fim,
    p_cycle_time_min, p_lead_time_horas,
    v_lote, p_lote_mp, p_descricao_mp, p_comprimento_mm, p_consumo_mp_metros,
    p_operador, 'concluido', p_horario_inicio::text, (select auth.uid())
  );

  INSERT INTO public.apontamento_paradas (apontamento_id, tipo_parada_id, tipo_parada_nome, duracao_horas)
  SELECT v_id, (p->>'tipo_id')::integer, p->>'tipo_nome', (p->>'duracao_horas')::numeric
  FROM jsonb_array_elements(p_paradas) p
  WHERE (p->>'duracao_horas')::numeric > 0;

  INSERT INTO public.apontamento_refugos (apontamento_id, tipo_refugo_id, tipo_refugo_nome, quantidade)
  SELECT v_id, (r->>'tipo_id')::integer, r->>'tipo_nome', (r->>'quantidade')::integer
  FROM jsonb_array_elements(p_refugos) r
  WHERE (r->>'quantidade')::integer > 0;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'seq', v_seq, 'lote', v_lote);
END;
$f01$;

GRANT EXECUTE ON FUNCTION public.criar_apontamento_ppi51 TO authenticated;

-- ── RPC: OEE real por período e máquina ───────────────────────────────────────
-- v2: além das paradas/refugos lançados dentro do assistente completo do
-- Controle (PPI-51 — tabelas apontamento_paradas/apontamento_refugos,
-- vinculadas a um apontamento específico), agora também soma as paradas e
-- refugos lançados nas telas rápidas e independentes — aba Paradas
-- (paradas_producao), aba Refugo (refugos_producao) e a aba Diário —, que
-- antes ficavam de fora do cálculo por estarem em tabelas sem vínculo com
-- nenhum apontamento. Isso corrige a Disponibilidade e a Qualidade, que
-- antes podiam aparecer artificialmente altas por ignorar parte real das
-- paradas/refugos do chão de fábrica.
CREATE OR REPLACE FUNCTION public.calcular_oee(
  p_data_ini date DEFAULT date_trunc('month', CURRENT_DATE)::date,
  p_data_fim date DEFAULT CURRENT_DATE,
  p_maquina  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $f02$
DECLARE
  v_hr_plan     numeric; v_hr_paradas  numeric; v_hr_disp     numeric;
  v_disp        numeric; v_qtde_plan   numeric; v_qtde_prod   numeric;
  v_perf        numeric; v_refugo      numeric; v_qual        numeric; v_oee numeric;
  v_hr_paradas_avulsas numeric; v_refugo_avulso numeric;
BEGIN
  SELECT COALESCE(SUM(a.horas_planejadas),0), COALESCE(SUM(a.quantidade),0), COALESCE(SUM(a.qtde_plan_disp),0)
  INTO v_hr_plan, v_qtde_prod, v_qtde_plan
  FROM public.apontamentos_producao a
  WHERE a.data_apontamento BETWEEN p_data_ini AND p_data_fim
    AND (p_maquina IS NULL OR a.maquina_codigo = p_maquina);

  -- Paradas vinculadas a um apontamento (assistente completo do Controle)
  SELECT COALESCE(SUM(ap.duracao_horas),0) INTO v_hr_paradas
  FROM public.apontamento_paradas ap
  JOIN public.apontamentos_producao a ON a.id = ap.apontamento_id
  WHERE a.data_apontamento BETWEEN p_data_ini AND p_data_fim
    AND (p_maquina IS NULL OR a.maquina_codigo = p_maquina);

  -- Paradas avulsas (aba Paradas + aba Diário) — só as já finalizadas
  -- (duracao_min preenchida); uma parada ainda em andamento entra no
  -- cálculo assim que for finalizada, no próximo recálculo. Exclui as
  -- entradas "Produzindo — ..." — são o cronômetro interno de produção do
  -- Diário (tempo rodando, não parado) e não devem contar como downtime.
  SELECT COALESCE(SUM(pp.duracao_min),0) / 60.0 INTO v_hr_paradas_avulsas
  FROM public.paradas_producao pp
  WHERE pp.inicio::date BETWEEN p_data_ini AND p_data_fim
    AND pp.duracao_min IS NOT NULL
    AND pp.motivo NOT LIKE 'Produzindo%'
    AND (p_maquina IS NULL OR pp.maquina = p_maquina);

  -- Refugos vinculados a um apontamento (assistente completo do Controle)
  SELECT COALESCE(SUM(ar.quantidade),0) INTO v_refugo
  FROM public.apontamento_refugos ar
  JOIN public.apontamentos_producao a ON a.id = ar.apontamento_id
  WHERE a.data_apontamento BETWEEN p_data_ini AND p_data_fim
    AND (p_maquina IS NULL OR a.maquina_codigo = p_maquina);

  -- Refugos avulsos (aba Refugo)
  SELECT COALESCE(SUM(rp.quantidade),0) INTO v_refugo_avulso
  FROM public.refugos_producao rp
  WHERE rp.created_at::date BETWEEN p_data_ini AND p_data_fim
    AND (p_maquina IS NULL OR rp.maquina = p_maquina);

  v_hr_paradas := v_hr_paradas + v_hr_paradas_avulsas;
  v_refugo     := v_refugo + v_refugo_avulso;

  v_hr_disp := GREATEST(0, v_hr_plan - v_hr_paradas);
  v_disp    := CASE WHEN v_hr_plan   > 0 THEN ROUND(v_hr_disp  / v_hr_plan   * 100, 2) ELSE 0   END;
  v_perf    := CASE WHEN v_qtde_plan > 0 THEN ROUND(v_qtde_prod / v_qtde_plan * 100, 2) ELSE 0   END;
  v_qual    := CASE WHEN v_qtde_prod > 0 THEN GREATEST(0, ROUND((v_qtde_prod - v_refugo)  / v_qtde_prod * 100, 2)) ELSE 100 END;
  v_oee     := ROUND(v_disp * v_perf * v_qual / 10000, 2);

  RETURN jsonb_build_object(
    'hr_planejadas', v_hr_plan, 'hr_paradas', v_hr_paradas, 'hr_disponiveis', v_hr_disp,
    'disponibilidade', v_disp, 'qtde_planejada', v_qtde_plan, 'qtde_produzida', v_qtde_prod,
    'total_refugo', v_refugo, 'performance', v_perf, 'qualidade', v_qual, 'oee', v_oee
  );
END;
$f02$;

GRANT EXECUTE ON FUNCTION public.calcular_oee(date, date, text) TO authenticated;

-- ── RPC: resumo mensal (equivale ao Resumo_Dados_Produção do PPI-51) ──────────
-- v2: "paradas_por_tipo" e "refugos_por_tipo" agora também incluem as
-- paradas/refugos avulsos, pelo mesmo motivo do calcular_oee acima — sem
-- isso, o gráfico de composição das paradas na aba Desempenho mostrava só
-- uma fatia da realidade. Motivos de setup lançados pelo Diário (que
-- guardam a peça no texto, ex: "Setup — CODIGO (desc)") são agrupados sob
-- "Setup" para não aparecer como uma linha diferente por peça.
CREATE OR REPLACE FUNCTION public.resumo_mensal_producao(
  p_mes integer DEFAULT EXTRACT(MONTH FROM CURRENT_DATE)::integer,
  p_ano integer DEFAULT EXTRACT(YEAR  FROM CURRENT_DATE)::integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $f03$
DECLARE
  v_ini date; v_fim date;
  v_geral jsonb; v_maquinas jsonb; v_paradas jsonb; v_refugos jsonb;
BEGIN
  v_ini := make_date(p_ano, p_mes, 1);
  v_fim := (v_ini + INTERVAL '1 month - 1 day')::date;
  v_geral := public.calcular_oee(v_ini, v_fim, NULL);

  SELECT jsonb_agg(row_to_json(t)) INTO v_maquinas FROM (
    SELECT a.maquina_codigo AS maquina,
      SUM(a.horas_planejadas) AS hr_planejadas,
      SUM(a.quantidade) AS qtde_produzida,
      SUM(a.qtde_plan_disp) AS qtde_planejada,
      COUNT(*) AS total_apontamentos
    FROM public.apontamentos_producao a
    WHERE a.data_apontamento BETWEEN v_ini AND v_fim
    GROUP BY a.maquina_codigo ORDER BY a.maquina_codigo
  ) t;

  SELECT jsonb_agg(row_to_json(t)) INTO v_paradas FROM (
    SELECT tipo, SUM(total_horas) AS total_horas, SUM(ocorrencias) AS ocorrencias
    FROM (
      SELECT ap.tipo_parada_nome AS tipo,
        SUM(ap.duracao_horas) AS total_horas, COUNT(*) AS ocorrencias
      FROM public.apontamento_paradas ap
      JOIN public.apontamentos_producao a ON a.id = ap.apontamento_id
      WHERE a.data_apontamento BETWEEN v_ini AND v_fim
      GROUP BY ap.tipo_parada_nome
      UNION ALL
      SELECT CASE WHEN pp.motivo LIKE 'Setup%' THEN 'Setup' ELSE pp.motivo END AS tipo,
        COALESCE(SUM(pp.duracao_min),0) / 60.0 AS total_horas, COUNT(*) AS ocorrencias
      FROM public.paradas_producao pp
      WHERE pp.inicio::date BETWEEN v_ini AND v_fim AND pp.duracao_min IS NOT NULL
        AND pp.motivo NOT LIKE 'Produzindo%'
      GROUP BY CASE WHEN pp.motivo LIKE 'Setup%' THEN 'Setup' ELSE pp.motivo END
    ) u
    GROUP BY tipo ORDER BY total_horas DESC
  ) t;

  SELECT jsonb_agg(row_to_json(t)) INTO v_refugos FROM (
    SELECT tipo, SUM(total) AS total, SUM(ocorrencias) AS ocorrencias
    FROM (
      SELECT ar.tipo_refugo_nome AS tipo,
        SUM(ar.quantidade) AS total, COUNT(*) AS ocorrencias
      FROM public.apontamento_refugos ar
      JOIN public.apontamentos_producao a ON a.id = ar.apontamento_id
      WHERE a.data_apontamento BETWEEN v_ini AND v_fim
      GROUP BY ar.tipo_refugo_nome
      UNION ALL
      SELECT COALESCE(NULLIF(trim(rp.tipo_defeito),''), 'Outros') AS tipo,
        SUM(rp.quantidade) AS total, COUNT(*) AS ocorrencias
      FROM public.refugos_producao rp
      WHERE rp.created_at::date BETWEEN v_ini AND v_fim
      GROUP BY COALESCE(NULLIF(trim(rp.tipo_defeito),''), 'Outros')
    ) u
    GROUP BY tipo ORDER BY total DESC
  ) t;

  RETURN jsonb_build_object(
    'mes', p_mes, 'ano', p_ano, 'periodo_ini', v_ini, 'periodo_fim', v_fim,
    'geral', v_geral,
    'por_maquina',       COALESCE(v_maquinas, '[]'),
    'paradas_por_tipo',  COALESCE(v_paradas,  '[]'),
    'refugos_por_tipo',  COALESCE(v_refugos,  '[]')
  );
END;
$f03$;

GRANT EXECUTE ON FUNCTION public.resumo_mensal_producao(integer, integer) TO authenticated;
