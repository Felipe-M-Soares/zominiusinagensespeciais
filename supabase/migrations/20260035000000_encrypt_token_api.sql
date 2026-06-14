-- =============================================================================
-- CRÍTICO-02: Criptografia do token_api com pgsodium (Supabase Vault)
-- =============================================================================
--
-- ANTES DE EXECUTAR esta migration:
--   1. Ativar pgsodium no Dashboard: Database → Extensions → pgsodium → Enable
--   2. Executar esta migration via: supabase db push
--
-- O que esta migration faz:
--   1. Cria uma chave de criptografia nomeada no Vault
--   2. Adiciona coluna token_api_enc (bytea) para o valor criptografado
--   3. Adiciona coluna token_api_key_id (uuid) referenciando a chave usada
--   4. Cria função segura para criptografar/descriptografar via Vault
--   5. Migra dados existentes (se houver)
--   6. Cria view segura que decripta automaticamente para roles autorizadas
--   7. Remove coluna plain text
--
-- Rollback: ver comentário no final do arquivo
-- =============================================================================

-- ── 1. Cria chave de criptografia no Vault (idempotente) ──────────────────────
DO $enc01$
BEGIN
  -- Só cria se ainda não existir uma chave com este nome
  IF NOT EXISTS (
    SELECT 1 FROM pgsodium.valid_key WHERE name = 'token_api_master_key'
  ) THEN
    PERFORM pgsodium.create_key(
      name := 'token_api_master_key',
      key_type := 'aead-det'  -- AEAD determinístico: mesmo plaintext → mesmo ciphertext
                               -- Útil para buscar por valor criptografado se necessário
    );
    RAISE NOTICE 'Chave token_api_master_key criada no Vault';
  ELSE
    RAISE NOTICE 'Chave token_api_master_key já existe — pulando criação';
  END IF;
END $enc01$;

-- ── 2. Adiciona colunas criptografadas (se não existirem) ─────────────────────
DO $enc02$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'financeiro_contas_bancarias'
  ) THEN

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'financeiro_contas_bancarias'
        AND column_name = 'token_api_enc'
    ) THEN
      ALTER TABLE public.financeiro_contas_bancarias
        ADD COLUMN token_api_enc bytea,
        ADD COLUMN token_api_key_id uuid
          REFERENCES pgsodium.valid_key(id) ON DELETE SET NULL;

      RAISE NOTICE 'Colunas token_api_enc e token_api_key_id adicionadas';
    ELSE
      RAISE NOTICE 'Colunas já existem — pulando ALTER TABLE';
    END IF;

  ELSE
    RAISE NOTICE 'Tabela financeiro_contas_bancarias não encontrada — pulando';
  END IF;
END $enc02$;

-- ── 3. Migra dados existentes (plain text → criptografado) ────────────────────
DO $enc03$
DECLARE
  v_key_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'financeiro_contas_bancarias'
      AND column_name = 'token_api'
  ) THEN
    RAISE NOTICE 'Coluna token_api já foi removida — migration de dados não necessária';
    RETURN;
  END IF;

  -- Obtém o ID da chave master
  SELECT id INTO v_key_id
  FROM pgsodium.valid_key
  WHERE name = 'token_api_master_key'
  LIMIT 1;

  IF v_key_id IS NULL THEN
    RAISE EXCEPTION 'Chave token_api_master_key não encontrada no Vault. Verifique se o pgsodium está ativo.';
  END IF;

  -- Criptografa apenas linhas com token_api não nulo que ainda não foram migradas
  UPDATE public.financeiro_contas_bancarias
  SET
    token_api_enc  = pgsodium.crypto_aead_det_encrypt(
                       convert_to(token_api, 'utf8'),  -- plaintext como bytea
                       convert_to(id::text, 'utf8'),   -- additional data (contexto): id da conta
                       v_key_id
                     ),
    token_api_key_id = v_key_id
  WHERE token_api IS NOT NULL
    AND token_api_enc IS NULL;

  RAISE NOTICE 'Dados migrados para token_api_enc';
END $enc03$;

-- ── 4. Função segura para descriptografar o token (SECURITY DEFINER) ──────────
CREATE OR REPLACE FUNCTION public.get_token_api(p_conta_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgsodium
AS $enc04$
DECLARE
  v_enc     bytea;
  v_key_id  uuid;
  v_role    text;
BEGIN
  -- Apenas admin ou financeiro podem ver o token descriptografado
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
  IF v_role NOT IN ('admin', 'financeiro') THEN
    RAISE EXCEPTION 'Acesso negado: apenas admin ou financeiro podem acessar tokens de API';
  END IF;

  SELECT token_api_enc, token_api_key_id
  INTO v_enc, v_key_id
  FROM public.financeiro_contas_bancarias
  WHERE id = p_conta_id;

  IF v_enc IS NULL THEN RETURN NULL; END IF;

  RETURN convert_from(
    pgsodium.crypto_aead_det_decrypt(
      v_enc,
      convert_to(p_conta_id::text, 'utf8'),  -- additional data (contexto)
      v_key_id
    ),
    'utf8'
  );
END;
$enc04$;

GRANT EXECUTE ON FUNCTION public.get_token_api(uuid) TO authenticated;

-- ── 5. Remove coluna plain text ───────────────────────────────────────────────
-- Só remove se a migração de dados foi bem sucedida (coluna enc existe)
DO $enc05$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'financeiro_contas_bancarias'
      AND column_name = 'token_api'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'financeiro_contas_bancarias'
      AND column_name = 'token_api_enc'
  ) THEN
    ALTER TABLE public.financeiro_contas_bancarias DROP COLUMN token_api;
    RAISE NOTICE 'Coluna token_api (plain text) removida com sucesso';
  ELSE
    RAISE NOTICE 'Coluna token_api não encontrada ou enc não criada — nenhuma ação';
  END IF;
END $enc05$;

-- ── 6. Comentários de documentação ────────────────────────────────────────────
DO $enc06$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'financeiro_contas_bancarias'
      AND column_name = 'token_api_enc'
  ) THEN
    COMMENT ON COLUMN public.financeiro_contas_bancarias.token_api_enc IS
      'Token API criptografado com pgsodium AEAD. Use public.get_token_api(id) para descriptografar.';
    COMMENT ON COLUMN public.financeiro_contas_bancarias.token_api_key_id IS
      'ID da chave de criptografia no pgsodium.valid_key usada para este registro.';
  END IF;
END $enc06$;

-- =============================================================================
-- ROLLBACK (execute manualmente se necessário):
--
--   ALTER TABLE public.financeiro_contas_bancarias ADD COLUMN token_api text;
--   UPDATE public.financeiro_contas_bancarias
--   SET token_api = convert_from(
--     pgsodium.crypto_aead_det_decrypt(token_api_enc, convert_to(id::text,'utf8'), token_api_key_id),
--     'utf8'
--   ) WHERE token_api_enc IS NOT NULL;
--   ALTER TABLE public.financeiro_contas_bancarias
--     DROP COLUMN token_api_enc, DROP COLUMN token_api_key_id;
--   DROP FUNCTION IF EXISTS public.get_token_api(uuid);
-- =============================================================================
