-- =============================================================================
-- 013: Módulo de Produção — máquinas, produtos, apontamentos, ordens, paradas, refugos, MP
-- =============================================================================

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
DROP POLICY IF EXISTS "apon_insert" ON apontamentos_producao; CREATE POLICY "apon_insert" ON apontamentos_producao FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "apon_update" ON apontamentos_producao; CREATE POLICY "apon_update" ON apontamentos_producao FOR UPDATE USING (auth.uid() = user_id OR public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "apon_delete" ON apontamentos_producao; CREATE POLICY "apon_delete" ON apontamentos_producao FOR DELETE USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "op_select" ON ordens_planejamento; CREATE POLICY "op_select" ON ordens_planejamento FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "op_insert" ON ordens_planejamento; CREATE POLICY "op_insert" ON ordens_planejamento FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "op_update" ON ordens_planejamento; CREATE POLICY "op_update" ON ordens_planejamento FOR UPDATE USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "op_delete" ON ordens_planejamento; CREATE POLICY "op_delete" ON ordens_planejamento FOR DELETE USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "par_select" ON paradas_producao; CREATE POLICY "par_select" ON paradas_producao FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "par_insert" ON paradas_producao; CREATE POLICY "par_insert" ON paradas_producao FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "par_update" ON paradas_producao; CREATE POLICY "par_update" ON paradas_producao FOR UPDATE USING (auth.uid() = user_id OR public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "par_delete" ON paradas_producao; CREATE POLICY "par_delete" ON paradas_producao FOR DELETE USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "ref_select" ON refugos_producao; CREATE POLICY "ref_select" ON refugos_producao FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "ref_insert" ON refugos_producao; CREATE POLICY "ref_insert" ON refugos_producao FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "ref_update" ON refugos_producao; CREATE POLICY "ref_update" ON refugos_producao FOR UPDATE USING (auth.uid() = user_id OR public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "ref_delete" ON refugos_producao; CREATE POLICY "ref_delete" ON refugos_producao FOR DELETE USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "mp_select" ON materias_primas_producao; CREATE POLICY "mp_select" ON materias_primas_producao FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "mp_insert" ON materias_primas_producao; CREATE POLICY "mp_insert" ON materias_primas_producao FOR INSERT WITH CHECK (public.get_my_role() IN ('admin','producao'));
DROP POLICY IF EXISTS "mp_update" ON materias_primas_producao; CREATE POLICY "mp_update" ON materias_primas_producao FOR UPDATE USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "mp_delete" ON materias_primas_producao; CREATE POLICY "mp_delete" ON materias_primas_producao FOR DELETE USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "mov_select" ON movimentos_mp_producao; CREATE POLICY "mov_select" ON movimentos_mp_producao FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "mov_insert" ON movimentos_mp_producao; CREATE POLICY "mov_insert" ON movimentos_mp_producao FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
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
