-- =============================================================================
-- 028: Documentação sobre criptografia do token_api
-- =============================================================================
-- O campo token_api está na tabela financeiro_contas_bancarias.
-- Está armazenado em plain text. Para criptografar, use pgsodium (Supabase Vault).
--
-- Como ativar: Supabase Dashboard → Database → Extensions → pgsodium → Enable
-- Após ativar, execute:
--   ALTER TABLE public.financeiro_contas_bancarias
--     ADD COLUMN IF NOT EXISTS token_api_enc bytea;
-- E migre os dados com pgsodium.crypto_secretbox().
--
-- Por enquanto, apenas adiciona comentário documentando o risco.
-- =============================================================================

DO $f01$
BEGIN
  -- Adiciona comentário na coluna se a tabela existir
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'financeiro_contas_bancarias'
      AND column_name = 'token_api'
  ) THEN
    COMMENT ON COLUMN public.financeiro_contas_bancarias.token_api IS
      'Token API de integração externa — armazenado em plain text. Migrar para pgsodium quando disponível.';
    RAISE NOTICE 'Comentário adicionado em financeiro_contas_bancarias.token_api';
  ELSE
    RAISE NOTICE 'Coluna token_api não encontrada — ignorando migration 028';
  END IF;
END;
$f01$;
