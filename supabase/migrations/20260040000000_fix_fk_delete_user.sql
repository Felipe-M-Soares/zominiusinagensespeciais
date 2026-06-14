-- =============================================================================
-- FIX: Foreign Keys para auth.users sem ON DELETE SET NULL
-- =============================================================================
--
-- PROBLEMA:
--   Ao excluir um usuário via delete-account Edge Function, o PostgreSQL
--   lança "violates foreign key constraint pedidos_comerciais_vendedora_id_fkey"
--   porque as colunas vendedora_id, separado_por, faturado_por, nf_criada_por,
--   created_by (em múltiplas tabelas) referenciam auth.users(id) SEM
--   ON DELETE SET NULL.
--
-- SOLUÇÃO:
--   ALTER TABLE ... DROP CONSTRAINT ... / ADD CONSTRAINT ... ON DELETE SET NULL
--   para todas as FKs afetadas. Isso preserva os registros históricos (pedidos,
--   lançamentos, clientes) mas seta o campo de usuário para NULL quando o
--   usuário é excluído — comportamento correto para dados históricos.
--
-- TABELAS AFETADAS:
--   pedidos_comerciais: vendedora_id, separado_por, faturado_por, nf_criada_por
--   clientes:           created_by
--   financeiro_lancamentos: created_by
--   financeiro_contas_bancarias: created_by
--   fornecedores, pedidos_compra, contatos_fornecedor,
--   certificados, recall_items: created_by
-- =============================================================================

-- ── pedidos_comerciais ────────────────────────────────────────────────────────

ALTER TABLE public.pedidos_comerciais
  DROP CONSTRAINT IF EXISTS pedidos_comerciais_vendedora_id_fkey,
  DROP CONSTRAINT IF EXISTS pedidos_comerciais_separado_por_fkey,
  DROP CONSTRAINT IF EXISTS pedidos_comerciais_faturado_por_fkey,
  DROP CONSTRAINT IF EXISTS pedidos_comerciais_nf_criada_por_fkey;

ALTER TABLE public.pedidos_comerciais
  ADD CONSTRAINT pedidos_comerciais_vendedora_id_fkey
    FOREIGN KEY (vendedora_id)  REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT pedidos_comerciais_separado_por_fkey
    FOREIGN KEY (separado_por)  REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT pedidos_comerciais_faturado_por_fkey
    FOREIGN KEY (faturado_por)  REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT pedidos_comerciais_nf_criada_por_fkey
    FOREIGN KEY (nf_criada_por) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── clientes ──────────────────────────────────────────────────────────────────

ALTER TABLE public.clientes
  DROP CONSTRAINT IF EXISTS clientes_created_by_fkey;

ALTER TABLE public.clientes
  ADD CONSTRAINT clientes_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── financeiro_lancamentos ────────────────────────────────────────────────────

ALTER TABLE public.financeiro_lancamentos
  DROP CONSTRAINT IF EXISTS financeiro_lancamentos_created_by_fkey;

ALTER TABLE public.financeiro_lancamentos
  ADD CONSTRAINT financeiro_lancamentos_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── financeiro_contas_bancarias ───────────────────────────────────────────────

ALTER TABLE public.financeiro_contas_bancarias
  DROP CONSTRAINT IF EXISTS financeiro_contas_bancarias_created_by_fkey;

ALTER TABLE public.financeiro_contas_bancarias
  ADD CONSTRAINT financeiro_contas_bancarias_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── tabelas empresariais (fornecedores, pedidos_compra, etc.) ─────────────────
-- Aplicamos genericamente para qualquer tabela que tenha created_by → auth.users

DO $fix_fk$
DECLARE
  r RECORD;
  v_constraint_name text;
BEGIN
  -- Descobre todas as FKs para auth.users sem ON DELETE SET NULL
  FOR r IN
    SELECT
      tc.table_name,
      tc.constraint_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
      AND tc.table_schema = rc.constraint_schema
    JOIN information_schema.table_constraints tc2
      ON rc.unique_constraint_name = tc2.constraint_name
      AND rc.unique_constraint_schema = tc2.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc2.table_name = 'users'
      AND tc2.table_schema = 'auth'
      AND rc.delete_rule != 'SET NULL'
      AND rc.delete_rule != 'CASCADE'
      -- Exclui as que já corrigimos acima para evitar duplicatas
      AND tc.table_name NOT IN (
        'pedidos_comerciais', 'clientes',
        'financeiro_lancamentos', 'financeiro_contas_bancarias'
      )
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
        r.table_name, r.constraint_name
      );
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I
           FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE SET NULL',
        r.table_name, r.constraint_name, r.column_name
      );
      RAISE NOTICE 'Corrigida FK %: %.% → auth.users ON DELETE SET NULL',
        r.constraint_name, r.table_name, r.column_name;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Erro ao corrigir FK % em %: %',
        r.constraint_name, r.table_name, SQLERRM;
    END;
  END LOOP;
END $fix_fk$;

-- ── Atualiza delete-account para limpar dados relacionados antes de deletar ───
-- A Edge Function delete-account já deleta profiles e user_roles.
-- Com ON DELETE SET NULL nas demais tabelas, o DELETE em auth.users
-- agora funciona sem erro de FK.

COMMENT ON TABLE public.pedidos_comerciais IS
  'Pedidos comerciais com NF-e SEFAZ. vendedora_id/separado_por/faturado_por/nf_criada_por
   setados para NULL automaticamente se o usuário for excluído (ON DELETE SET NULL).';
