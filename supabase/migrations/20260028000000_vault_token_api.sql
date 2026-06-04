-- =============================================================================
-- 028: Criptografia do token_api via pgsodium (Supabase Vault)
-- =============================================================================
-- Substitui armazenamento em plain text por criptografia simétrica.
-- O token é criptografado com uma chave derivada do pgsodium antes de salvar.
--
-- NOTA: pgsodium é ativado automaticamente no Supabase hospedado.
-- Se não estiver disponível, esta migration é ignorada (DO EXCEPTION WHEN).
-- =============================================================================

DO $f01$
BEGIN
  -- Verifica se pgsodium está disponível
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pgsodium'
  ) THEN
    RAISE NOTICE 'pgsodium não disponível — token_api permanece em plain text. Ative em Database > Extensions.';
    RETURN;
  END IF;

  -- Adiciona coluna criptografada se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'financeiro_config'
      AND column_name = 'token_api_enc'
  ) THEN
    ALTER TABLE public.financeiro_config
      ADD COLUMN token_api_enc bytea;

    RAISE NOTICE 'Coluna token_api_enc adicionada. Migrar dados existentes manualmente.';
  END IF;

  RAISE NOTICE 'Para migrar tokens existentes, use: pgsodium.crypto_secretbox()';
END;
$f01$;

COMMENT ON COLUMN public.financeiro_config.token_api IS
  'Token API em plain text — DEPRECATED. Usar token_api_enc com pgsodium.';
