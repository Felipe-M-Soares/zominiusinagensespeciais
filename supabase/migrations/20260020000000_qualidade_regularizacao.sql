-- =============================================================================
-- 020: Qualidade — campos de regularização sanitária por produto
--
-- Implementa o plano de 4 fases no schema:
--   Fase 1-2: empresa_lf, empresa_afe, empresa_bpf, risk_class (já existe)
--   Fase 3:   regime, status_regularizacao, numero_processo_anvisa,
--             data_registro_anvisa, data_vencimento_anvisa
--   Fase 4:   gtin, siud_transmitido_em
--
-- IMPORTANTE: udi_di deixa de ser NOT NULL para suportar peças em processo.
--             anvisa_registration idem — era NOT NULL e era problemático.
-- =============================================================================

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
