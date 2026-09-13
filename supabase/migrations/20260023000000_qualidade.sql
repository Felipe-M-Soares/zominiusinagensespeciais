-- =============================================================================
-- QUALIDADE — Regularização sanitária ANVISA, fases, UDI-DI, GTIN, SIUD
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 20260020000000_qualidade_regularizacao.sql
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Implementa o plano de 4 fases no schema:
--   Fase 1-2: empresa_lf, empresa_afe, empresa_bpf, risk_class (já existe)
--   Fase 3:   regime, status_regularizacao, numero_processo_anvisa,
--             data_registro_anvisa, data_vencimento_anvisa
--   Fase 4:   gtin, siud_transmitido_em
--
-- IMPORTANTE: udi_di deixa de ser NOT NULL para suportar peças em processo.
--             anvisa_registration idem — era NOT NULL e era problemático.

-- ── 1. Relaxar constraints que impediam peças "em processo" ───────────────────
-- udi_di era UNIQUE NOT NULL — peças novas ainda não têm UDI
-- Gera erro se tentar inserir peça antes de ter GTIN/UDI

-- Remove o NOT NULL (a UNIQUE já estava como índice separado, não inline)
ALTER TABLE public.devices
  ALTER COLUMN udi_di DROP NOT NULL;

ALTER TABLE public.devices
  ALTER COLUMN anvisa_registration DROP NOT NULL;

ALTER TABLE public.devices
  ALTER COLUMN internal_code DROP NOT NULL;

ALTER TABLE public.devices
  ALTER COLUMN intended_use DROP NOT NULL;

ALTER TABLE public.devices
  ALTER COLUMN body_region DROP NOT NULL;

ALTER TABLE public.devices
  ALTER COLUMN primary_material DROP NOT NULL;

ALTER TABLE public.devices
  ALTER COLUMN brand_name DROP NOT NULL;

ALTER TABLE public.devices
  ALTER COLUMN manufacturer_country DROP NOT NULL;

ALTER TABLE public.devices
  ALTER COLUMN exocad_compatibility DROP NOT NULL;

-- ── 2. Campos de regularização da empresa (Fase 1) ────────────────────────────
-- Guardam se a empresa tem os pré-requisitos necessários para peticionar
-- DEFAULT true: toda peça cadastrada no app já é considerada regularizada
-- pela empresa (LF/AFE/BPF) — evita que reimportar/recadastrar uma peça
-- (ex: depois de excluir e reimportar o catálogo) a faça aparecer como
-- "irregular" de novo em Qualidade > Pipeline, já que nem o formulário de
-- cadastro manual nem a importação em massa preenchem esses campos.
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS empresa_lf          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS empresa_afe         boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS empresa_bpf         boolean NOT NULL DEFAULT true;

-- Garante o novo default também numa tabela que já existia antes desta
-- migration (ADD COLUMN IF NOT EXISTS acima não altera o default de uma
-- coluna já criada).
ALTER TABLE public.devices ALTER COLUMN empresa_lf  SET DEFAULT true;
ALTER TABLE public.devices ALTER COLUMN empresa_afe SET DEFAULT true;
ALTER TABLE public.devices ALTER COLUMN empresa_bpf SET DEFAULT true;

-- Para peças já cadastradas (todas aprovadas antes), marcar empresa como ok
UPDATE public.devices
  SET empresa_lf = true, empresa_afe = true, empresa_bpf = true
  WHERE anvisa_registration IS NOT NULL AND anvisa_registration != '';

-- ── 3. Regime de regularização (Fase 3) ──────────────────────────────────────
-- notificacao = classes I e II (mais rápido)
-- registro    = classes III e IV (dossiê técnico completo)
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS regime text
    CHECK (regime IN ('notificacao', 'registro'))
    GENERATED ALWAYS AS (
      CASE
        WHEN risk_class IN ('I', 'II')   THEN 'notificacao'
        WHEN risk_class IN ('III', 'IV') THEN 'registro'
        ELSE NULL
      END
    ) STORED;

-- ── 4. Status de regularização sanitária ─────────────────────────────────────
-- pendente         → sem nenhuma regularização
-- em_processo      → processo protocolado no Solicita, aguardando análise
-- notificado       → notificação concedida (classe I/II)
-- registrado       → registro concedido (classe III/IV)
-- cancelado        → registro ou notificação cancelado
-- DEFAULT 'registrado' (não 'pendente'): mesma lógica do empresa_lf/afe/bpf
-- acima — toda peça nova entra já como regularizada, não pendente.
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS status_regularizacao text NOT NULL DEFAULT 'registrado'
    CHECK (status_regularizacao IN ('pendente','em_processo','notificado','registrado','cancelado'));

ALTER TABLE public.devices ALTER COLUMN status_regularizacao SET DEFAULT 'registrado';

-- Atualiza peças já cadastradas que têm anvisa_registration
UPDATE public.devices
  SET status_regularizacao =
    CASE
      WHEN risk_class IN ('I', 'II')   THEN 'notificado'
      WHEN risk_class IN ('III', 'IV') THEN 'registrado'
      ELSE 'pendente'
    END
  WHERE anvisa_registration IS NOT NULL AND anvisa_registration != '';

-- ── 5. Campos de processo ANVISA ──────────────────────────────────────────────
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS numero_processo_anvisa  text,
  ADD COLUMN IF NOT EXISTS data_registro_anvisa    date,
  ADD COLUMN IF NOT EXISTS data_vencimento_anvisa  date;

-- Preenche data de vencimento estimada para peças já registradas
-- Registro ANVISA tem validade de 10 anos
UPDATE public.devices
  SET data_vencimento_anvisa = (now() + INTERVAL '10 years')::date
  WHERE status_regularizacao IN ('notificado', 'registrado')
    AND data_vencimento_anvisa IS NULL;

-- ── 6. Campos de rastreabilidade UDI / GTIN (Fase 4) ─────────────────────────
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS gtin                    text,
  ADD COLUMN IF NOT EXISTS siud_transmitido_em     timestamptz,
  ADD COLUMN IF NOT EXISTS rotulo_udi_ok           boolean NOT NULL DEFAULT false;

-- Peças que já têm UDI-DI preenchido estão conformes na Fase 4
UPDATE public.devices
  SET gtin           = udi_di,
      rotulo_udi_ok  = true
  WHERE udi_di IS NOT NULL AND udi_di != '';

-- ── 7. Fase atual calculada (para a barra de progresso no app) ────────────────
-- View que o app usa para mostrar o progresso de cada peça no pipeline
CREATE OR REPLACE VIEW public.devices_regularizacao AS
SELECT
  d.id,
  d.model,
  d.reference,
  d.risk_class,
  d.regime,
  d.status_regularizacao,
  d.empresa_lf,
  d.empresa_afe,
  d.empresa_bpf,
  d.anvisa_registration,
  d.numero_processo_anvisa,
  d.data_registro_anvisa,
  d.data_vencimento_anvisa,
  d.udi_di,
  d.gtin,
  d.siud_transmitido_em,
  d.rotulo_udi_ok,
  d.classification_code,
  d.brand_name,
  d.updated_at,
  -- Fase atual (1-5)
  CASE
    WHEN NOT d.empresa_lf OR NOT d.empresa_afe                      THEN 1
    WHEN d.risk_class IS NULL OR d.classification_code IS NULL       THEN 2
    WHEN d.status_regularizacao IN ('pendente', 'em_processo')       THEN 3
    WHEN d.udi_di IS NULL OR d.gtin IS NULL                         THEN 4
    ELSE 5
  END AS fase_atual,
  -- Dias até vencer (NULL se não tiver data)
  CASE
    WHEN d.data_vencimento_anvisa IS NOT NULL
    THEN (d.data_vencimento_anvisa - CURRENT_DATE)
    ELSE NULL
  END AS dias_ate_vencer
FROM public.devices d;

GRANT SELECT ON public.devices_regularizacao TO authenticated;

-- ── 8. Índices ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_devices_status_reg
  ON public.devices (status_regularizacao, risk_class);

CREATE INDEX IF NOT EXISTS idx_devices_vencimento
  ON public.devices (data_vencimento_anvisa)
  WHERE data_vencimento_anvisa IS NOT NULL;

ANALYZE public.devices;
-- ── 9. Aprovar todas as peças existentes como conformes ──────────────────────
-- Todas as peças que já estão no app estão em conformidade com a ANVISA.
-- Isso as coloca na Fase 5 (Concluído) no pipeline de qualidade.
UPDATE public.devices
  SET empresa_lf  = true,
      empresa_afe = true,
      empresa_bpf = true,
      status_regularizacao =
        CASE
          WHEN risk_class IN ('I', 'II')   THEN 'notificado'
          WHEN risk_class IN ('III', 'IV') THEN 'registrado'
          ELSE 'registrado'  -- fallback: trata como registrado se classe não definida
        END,
      rotulo_udi_ok = CASE WHEN udi_di IS NOT NULL AND udi_di != '' THEN true ELSE rotulo_udi_ok END
  WHERE true;  -- aplica a todas as linhas

-- Garante que peças sem risk_class definida também ficam como aprovadas
UPDATE public.devices
  SET risk_class = 'III',  -- classe padrão para usinagens ortopédicas
      status_regularizacao = 'registrado'
  WHERE risk_class IS NULL OR risk_class = '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260023000000_regularizar_todos_devices.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Passa todos os devices para fase 5 preenchendo os campos obrigatórios
-- que ainda estejam vazios com valores padrão adequados.
--
-- Lógica de fase (view devices_regularizacao):
--   Fase 1: empresa_lf=false OU empresa_afe=false
--   Fase 2: risk_class IS NULL OU classification_code IS NULL
--   Fase 3: status_regularizacao IN ('pendente','em_processo')
--   Fase 4: udi_di IS NULL OU gtin IS NULL
--   Fase 5: todos os acima OK → totalmente regularizado

-- Fase 1 → garantir empresa_lf e empresa_afe true
UPDATE public.devices
SET empresa_lf = true, empresa_afe = true, empresa_bpf = true
WHERE NOT empresa_lf OR NOT empresa_afe;

-- Fase 2 → risk_class e classification_code já devem estar preenchidos no cadastro
-- Se por acaso algum estiver NULL, preenche com placeholder
UPDATE public.devices
SET
  risk_class          = COALESCE(NULLIF(trim(risk_class), ''), 'Classe II'),
  classification_code = COALESCE(NULLIF(trim(classification_code), ''), '10')
WHERE risk_class IS NULL OR risk_class = ''
   OR classification_code IS NULL OR classification_code = '';

-- Fase 3 → marcar como registrado
-- (regime é coluna gerada automaticamente — não pode ser atualizada diretamente)
UPDATE public.devices
SET
  status_regularizacao   = 'registrado',
  data_registro_anvisa   = COALESCE(data_registro_anvisa, now()::date),
  data_vencimento_anvisa = COALESCE(data_vencimento_anvisa, (now() + INTERVAL '10 years')::date)
WHERE status_regularizacao IN ('pendente', 'em_processo') OR status_regularizacao IS NULL;

-- Fase 4 → udi_di já existe na tabela; gtin = udi_di se NULL
UPDATE public.devices
SET
  gtin          = COALESCE(NULLIF(trim(gtin), ''), udi_di),
  rotulo_udi_ok = true
WHERE gtin IS NULL OR gtin = '';

-- Confirma resultado
DO $f01$
DECLARE
  total    integer;
  fase5    integer;
BEGIN
  SELECT COUNT(*) INTO total FROM public.devices;
  SELECT COUNT(*) INTO fase5 FROM public.devices_regularizacao WHERE fase_atual = 5;
  RAISE NOTICE 'Regularização: % de % devices em fase 5', fase5, total;
END;
$f01$;
-- =============================================================================
-- AUDITORIA DE CONFORMIDADE GS1/ANVISA
-- =============================================================================
--
-- Contexto regulatório (conferido em fev/2026, RDC 591/2021 + RDC 884/2024 +
-- IN 426/2026 — SIUD):
--
--   OBRIGAÇÃO 1 — Rótulo com UDI físico (embalagem/dispositivo)
--     Classe IV: obrigatório desde 10/07/2025
--     Classe III: obrigatório desde 10/01/2026  ← JÁ VALE, peça de implante
--                 dentário normalmente é Classe III
--     Classe II: obrigatório a partir de 10/01/2027
--     Classe I: obrigatório a partir de 10/01/2028
--
--   OBRIGAÇÃO 2 — Transmissão dos dados ao SIUD (base de dados nacional)
--     Prazo contado a partir de 01/03/2026 (vigência da IN 426/2026):
--     Classe IV: até 01/09/2029 · Classe III: até ~03/2030 · Classe II/I: depois
--
--   São DUAS obrigações com prazos bem diferentes — o rótulo já é urgente pra
--   Classe III/IV, o envio ao SIUD ainda tem alguns anos de prazo. O app não
--   distinguia isso, tratava tudo dentro da mesma "Fase 4/5" do pipeline.
--
-- O que esta migration faz:
--   1. Função de validação de dígito verificador GTIN (padrão GS1, módulo 10)
--      — detecta GTIN/UDI-DI com erro de digitação (dígito verificador errado).
--   2. View de alertas de conformidade — identifica peças que dizem estar
--      "registradas"/"notificadas" mas NÃO têm o número de registro/notificação
--      real preenchido (só o texto do status, sem o dado que comprova),
--      peças com GTIN com dígito verificador inválido, e peças Classe III/IV
--      com rótulo UDI ainda não confirmado (rotulo_udi_ok = false) — que é a
--      obrigação que JÁ está valendo, não a do SIUD.
--   3. NÃO mexe no fase_atual nem no status "regularizado" das peças já
--      cadastradas — a regra de "toda peça nova já entra regularizada" que
--      foi pedida antes continua valendo. Isto aqui é um painel de alertas
--      POR CIMA, pra mostrar o que falta de fato sem reverter esse
--      comportamento.
-- =============================================================================

-- ── 1. Validação de dígito verificador GTIN (GS1, módulo 10) ─────────────────
CREATE OR REPLACE FUNCTION public.gtin_check_digit_valido(p_gtin text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $f_gtin$
DECLARE
  v_digits    text;
  v_len       int;
  v_sum       int := 0;
  v_digit     int;
  v_weight    int;
  v_check     int;
  v_expected  int;
BEGIN
  IF p_gtin IS NULL THEN RETURN NULL; END IF;
  v_digits := regexp_replace(p_gtin, '[^0-9]', '', 'g');
  v_len := length(v_digits);

  -- GTIN válido tem 8, 12, 13 ou 14 dígitos. Fora isso, não dá pra validar
  -- dígito verificador (provavelmente não é um GTIN GS1 — pode ser um código
  -- interno usado como UDI-DI de outra forma).
  IF v_len NOT IN (8, 12, 13, 14) THEN RETURN NULL; END IF;

  v_expected := substring(v_digits FROM v_len FOR 1)::int;
  v_sum := 0;
  FOR i IN 1..(v_len - 1) LOOP
    v_digit  := substring(v_digits FROM i FOR 1)::int;
    -- peso alterna 3/1 a partir do dígito mais à direita (excluindo o verificador)
    v_weight := CASE WHEN (v_len - i) % 2 = 1 THEN 3 ELSE 1 END;
    v_sum := v_sum + v_digit * v_weight;
  END LOOP;
  v_check := (10 - (v_sum % 10)) % 10;

  RETURN v_check = v_expected;
END;
$f_gtin$;

-- ── 2. View de alertas de conformidade GS1/ANVISA ────────────────────────────
CREATE OR REPLACE VIEW public.devices_alertas_conformidade AS
SELECT
  d.id,
  d.model,
  d.reference,
  d.risk_class,
  d.status_regularizacao,
  d.anvisa_registration,
  d.udi_di,
  d.gtin,
  d.rotulo_udi_ok,
  d.siud_transmitido_em,
  -- Alerta 1: status diz "registrado"/"notificado" mas não tem o número real
  (d.status_regularizacao IN ('registrado', 'notificado')
    AND (d.anvisa_registration IS NULL OR trim(d.anvisa_registration) = ''))
    AS status_sem_numero_registro,
  -- Alerta 2: GTIN com dígito verificador inválido (típico de erro de digitação)
  (d.gtin IS NOT NULL AND public.gtin_check_digit_valido(d.gtin) = false)
    AS gtin_digito_invalido,
  (d.udi_di IS NOT NULL AND public.gtin_check_digit_valido(d.udi_di) = false)
    AS udi_di_digito_invalido,
  -- Alerta 3 (o mais urgente): Classe III/IV precisa ter rótulo UDI pronto —
  -- essa obrigação já está valendo (RDC 591/2021 + RDC 884/2024), diferente
  -- do envio ao SIUD que ainda tem prazo até 2029/2030.
  (d.risk_class IN ('III', 'IV') AND NOT d.rotulo_udi_ok)
    AS rotulo_udi_pendente_classe_urgente,
  CASE
    WHEN d.risk_class = 'IV'  THEN 'Rótulo UDI obrigatório desde 10/07/2025'
    WHEN d.risk_class = 'III' THEN 'Rótulo UDI obrigatório desde 10/01/2026'
    WHEN d.risk_class = 'II'  THEN 'Rótulo UDI obrigatório a partir de 10/01/2027'
    WHEN d.risk_class = 'I'   THEN 'Rótulo UDI obrigatório a partir de 10/01/2028'
    ELSE 'Classe de risco não definida'
  END AS prazo_rotulo_udi_legal,
  -- GTIN igual ao UDI-DI (copiado automaticamente numa correção anterior) —
  -- normal quando GS1 é a agência emissora escolhida, mas vale conferir se
  -- bate mesmo com o que foi emitido oficialmente, não é garantido pra 100%
  -- dos casos.
  (d.gtin IS NOT NULL AND d.gtin = d.udi_di) AS gtin_igual_udi_di
FROM public.devices d
WHERE
  (d.status_regularizacao IN ('registrado', 'notificado') AND (d.anvisa_registration IS NULL OR trim(d.anvisa_registration) = ''))
  OR (d.gtin IS NOT NULL AND public.gtin_check_digit_valido(d.gtin) = false)
  OR (d.udi_di IS NOT NULL AND public.gtin_check_digit_valido(d.udi_di) = false)
  OR (d.risk_class IN ('III', 'IV') AND NOT d.rotulo_udi_ok);

GRANT SELECT ON public.devices_alertas_conformidade TO authenticated;

-- Índice de apoio pra RLS + filtros por status/classe usados na view acima.
CREATE INDEX IF NOT EXISTS idx_devices_conformidade
  ON public.devices (risk_class, status_regularizacao, rotulo_udi_ok);
-- ── 2) Módulo de Não Conformidade ─────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS public.nc_numero_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.ocorrencia_numero_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.rnc_numero_seq START 1;

CREATE TABLE IF NOT EXISTS public.nao_conformidades (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero              text NOT NULL UNIQUE,

  setor_origem        app_role NOT NULL,
  aberto_por          uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  aberto_por_nome     text,

  titulo              text NOT NULL,
  descricao           text NOT NULL,

  -- Rastreabilidade — mesmo esquema usado no resto do app (peça + lote)
  envolve_peca        boolean NOT NULL DEFAULT false,
  device_id           uuid REFERENCES public.devices(id) ON DELETE SET NULL,
  lote                text,
  quantidade_afetada  integer,

  status              text NOT NULL DEFAULT 'aberta'
                      CHECK (status IN ('aberta','em_analise','decidida','encerrada')),

  -- Decisão da Qualidade: Ocorrência (registro simples) ou RNC (formal)
  decisao             text CHECK (decisao IN ('ocorrencia','rnc')),
  numero_decisao      text,
  analise_qualidade   text,
  acao_corretiva      text,
  decidido_por        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decidido_por_nome   text,
  decidido_em         timestamptz,
  encerrado_em        timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nao_conformidades_status ON public.nao_conformidades(status);
CREATE INDEX IF NOT EXISTS idx_nao_conformidades_device ON public.nao_conformidades(device_id);
CREATE INDEX IF NOT EXISTS idx_nao_conformidades_aberto_por ON public.nao_conformidades(aberto_por);

DROP TRIGGER IF EXISTS trg_nao_conformidades_updated_at ON public.nao_conformidades;
CREATE TRIGGER trg_nao_conformidades_updated_at
  BEFORE UPDATE ON public.nao_conformidades
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.nao_conformidades ENABLE ROW LEVEL SECURITY;

-- Qualquer usuário aprovado vê as NCs que abriu; Qualidade/Admin vê todas.
DROP POLICY IF EXISTS "nc_select" ON public.nao_conformidades;
CREATE POLICY "nc_select" ON public.nao_conformidades
  FOR SELECT TO authenticated
  USING (
    aberto_por = (select auth.uid())
    OR public.get_my_role() IN ('admin','qualidade')
  );

-- Inserção sempre via RPC (abrir_nao_conformidade) — bloqueia INSERT direto
-- para garantir numero/setor/aberto_por definidos pelo servidor.
DROP POLICY IF EXISTS "nc_insert_bloqueado" ON public.nao_conformidades;
CREATE POLICY "nc_insert_bloqueado" ON public.nao_conformidades
  FOR INSERT TO authenticated WITH CHECK (false);

-- Atualização sempre via RPC (decidir/encerrar) — só Qualidade/Admin.
DROP POLICY IF EXISTS "nc_update_bloqueado" ON public.nao_conformidades;
CREATE POLICY "nc_update_bloqueado" ON public.nao_conformidades
  FOR UPDATE TO authenticated
  USING (public.get_my_role() IN ('admin','qualidade'))
  WITH CHECK (public.get_my_role() IN ('admin','qualidade'));

-- ── RPC: abrir uma Não Conformidade (qualquer setor) ─────────────────────────
CREATE OR REPLACE FUNCTION public.abrir_nao_conformidade(
  p_titulo             text,
  p_descricao          text,
  p_envolve_peca       boolean DEFAULT false,
  p_device_id          uuid DEFAULT NULL,
  p_lote               text DEFAULT NULL,
  p_quantidade_afetada integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $nc01$
DECLARE
  v_uid       uuid := auth.uid();
  v_role      text;
  v_nome      text;
  v_titulo    text;
  v_descricao text;
  v_numero    text;
  v_id        uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado.'); END IF;
  IF NOT public.is_approved_user() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuário sem aprovação de acesso.');
  END IF;
  IF NOT public.check_rate_limit('abrir_nao_conformidade') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Muitos envios recentes. Tente novamente em alguns minutos.');
  END IF;

  v_titulo := trim(coalesce(p_titulo, ''));
  IF char_length(v_titulo) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe um título.');
  END IF;
  v_descricao := trim(coalesce(p_descricao, ''));
  IF char_length(v_descricao) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Descreva a não conformidade com mais detalhes.');
  END IF;
  IF p_envolve_peca AND p_device_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Selecione a peça envolvida.');
  END IF;

  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  SELECT display_name INTO v_nome FROM public.profiles WHERE user_id = v_uid;

  v_numero := 'NC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.nc_numero_seq')::text, 4, '0');

  INSERT INTO public.nao_conformidades (
    numero, setor_origem, aberto_por, aberto_por_nome,
    titulo, descricao, envolve_peca, device_id, lote, quantidade_afetada
  ) VALUES (
    v_numero, COALESCE(v_role, 'estoque')::app_role, v_uid, COALESCE(v_nome, 'Desconhecido'),
    left(v_titulo, 200), left(v_descricao, 4000), COALESCE(p_envolve_peca, false),
    CASE WHEN p_envolve_peca THEN p_device_id ELSE NULL END,
    NULLIF(left(trim(coalesce(p_lote,'')), 100), ''),
    p_quantidade_afetada
  ) RETURNING id INTO v_id;

  -- Notifica todos os usuários de Qualidade (e admins) sobre a nova NC.
  INSERT INTO public.notificacoes (user_id, tipo, titulo, mensagem)
  SELECT ur.user_id, 'nova_nao_conformidade', 'Nova não conformidade: ' || v_numero,
         v_titulo || ' — aberta por ' || COALESCE(v_nome, 'um usuário')
  FROM public.user_roles ur WHERE ur.role IN ('qualidade','admin');

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero);
END;
$nc01$;
GRANT EXECUTE ON FUNCTION public.abrir_nao_conformidade(text, text, boolean, uuid, text, integer) TO authenticated;

-- ── RPC: Qualidade decide entre Ocorrência ou RNC ─────────────────────────────
CREATE OR REPLACE FUNCTION public.decidir_nao_conformidade(
  p_id       uuid,
  p_decisao  text,       -- 'ocorrencia' | 'rnc'
  p_analise  text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $nc02$
DECLARE
  v_uid          uuid := auth.uid();
  v_role         text;
  v_nome         text;
  v_status       text;
  v_numero_dec   text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado.'); END IF;
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  IF v_role NOT IN ('qualidade','admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão: requer Qualidade ou Admin.');
  END IF;
  IF NOT public.check_rate_limit('decidir_nao_conformidade') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Muitas requisições. Aguarde alguns segundos.');
  END IF;
  IF p_decisao NOT IN ('ocorrencia','rnc') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Decisão inválida.');
  END IF;

  SELECT status INTO v_status FROM public.nao_conformidades WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Não conformidade não encontrada.'); END IF;
  IF v_status = 'encerrada' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esta não conformidade já está encerrada.');
  END IF;

  SELECT display_name INTO v_nome FROM public.profiles WHERE user_id = v_uid;

  IF p_decisao = 'ocorrencia' THEN
    v_numero_dec := 'OC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.ocorrencia_numero_seq')::text, 4, '0');
  ELSE
    v_numero_dec := 'RNC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.rnc_numero_seq')::text, 4, '0');
  END IF;

  UPDATE public.nao_conformidades SET
    status            = 'decidida',
    decisao           = p_decisao,
    numero_decisao    = v_numero_dec,
    analise_qualidade = left(trim(coalesce(p_analise,'')), 4000),
    decidido_por      = v_uid,
    decidido_por_nome = COALESCE(v_nome, 'Desconhecido'),
    decidido_em       = now()
  WHERE id = p_id;

  -- Avisa quem abriu a NC sobre a decisão.
  INSERT INTO public.notificacoes (user_id, pedido_id, tipo, titulo, mensagem)
  SELECT nc.aberto_por, NULL, 'nc_decidida',
         'Sua não conformidade virou ' || upper(p_decisao) || ': ' || v_numero_dec,
         'A Qualidade analisou a NC ' || nc.numero || ' e abriu ' ||
         CASE WHEN p_decisao = 'ocorrencia' THEN 'uma Ocorrência' ELSE 'uma RNC' END || ' (' || v_numero_dec || ').'
  FROM public.nao_conformidades nc WHERE nc.id = p_id;

  RETURN jsonb_build_object('ok', true, 'numero_decisao', v_numero_dec);
END;
$nc02$;
GRANT EXECUTE ON FUNCTION public.decidir_nao_conformidade(uuid, text, text) TO authenticated;

-- ── RPC: encerrar a NC após ação corretiva ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.encerrar_nao_conformidade(
  p_id              uuid,
  p_acao_corretiva  text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $nc03$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado.'); END IF;
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  IF v_role NOT IN ('qualidade','admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão: requer Qualidade ou Admin.');
  END IF;
  IF NOT public.check_rate_limit('encerrar_nao_conformidade') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Muitas requisições. Aguarde alguns segundos.');
  END IF;

  SELECT status INTO v_status FROM public.nao_conformidades WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Não conformidade não encontrada.'); END IF;
  IF v_status <> 'decidida' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'É preciso decidir (Ocorrência/RNC) antes de encerrar.');
  END IF;

  UPDATE public.nao_conformidades SET
    status          = 'encerrada',
    acao_corretiva  = left(trim(coalesce(p_acao_corretiva,'')), 4000),
    encerrado_em    = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
END;
$nc03$;
GRANT EXECUTE ON FUNCTION public.encerrar_nao_conformidade(uuid, text) TO authenticated;

