-- =============================================================================
-- 023: Regularizar todos os dispositivos (fase 5 — totalmente regularizados)
-- =============================================================================
-- Passa todos os devices para fase 5 preenchendo os campos obrigatórios
-- que ainda estejam vazios com valores padrão adequados.
--
-- Lógica de fase (view devices_regularizacao):
--   Fase 1: empresa_lf=false OU empresa_afe=false
--   Fase 2: risk_class IS NULL OU classification_code IS NULL
--   Fase 3: status_regularizacao IN ('pendente','em_processo')
--   Fase 4: udi_di IS NULL OU gtin IS NULL
--   Fase 5: todos os acima OK → totalmente regularizado
-- =============================================================================

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
UPDATE public.devices
SET
  status_regularizacao   = 'registrado',
  regime                 = COALESCE(regime, 'registro'),
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
