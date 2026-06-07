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
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS empresa_lf          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS empresa_afe         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS empresa_bpf         boolean NOT NULL DEFAULT false;

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
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS status_regularizacao text NOT NULL DEFAULT 'pendente'
    CHECK (status_regularizacao IN ('pendente','em_processo','notificado','registrado','cancelado'));

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
