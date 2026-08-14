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
