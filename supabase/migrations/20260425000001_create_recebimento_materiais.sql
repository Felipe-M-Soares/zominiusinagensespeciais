-- ============================================================
-- Tabela de Recebimento de Materiais
-- ============================================================
-- Registra a chegada de materiais com lote, quantidade e
-- descrição. Independente do controle de estoque de peças
-- (stock_items). Permite confirmar a retirada posterior.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.recebimento_materiais (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote                 text NOT NULL,
  quantity             integer NOT NULL CHECK (quantity > 0),
  descricao            text NOT NULL,
  fornecedor           text,
  status               text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'retirado')),
  user_id              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_display_name    text,
  retirado_por         text,
  retirado_em          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Trigger: atualiza updated_at
CREATE OR REPLACE FUNCTION public.touch_recebimento_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recebimento_updated_at ON public.recebimento_materiais;
CREATE TRIGGER trg_recebimento_updated_at
  BEFORE UPDATE ON public.recebimento_materiais
  FOR EACH ROW EXECUTE FUNCTION public.touch_recebimento_updated_at();

-- RLS
ALTER TABLE public.recebimento_materiais ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer usuário aprovado
DROP POLICY IF EXISTS "recebimento_select" ON public.recebimento_materiais;
CREATE POLICY "recebimento_select" ON public.recebimento_materiais
  FOR SELECT USING (public.is_approved_user());

-- Inserção: qualquer aprovado pode registrar recebimentos
DROP POLICY IF EXISTS "recebimento_insert" ON public.recebimento_materiais;
CREATE POLICY "recebimento_insert" ON public.recebimento_materiais
  FOR INSERT WITH CHECK (public.is_approved_user());

-- Atualização (confirmar retirada): qualquer aprovado pode marcar como retirado
DROP POLICY IF EXISTS "recebimento_update" ON public.recebimento_materiais;
CREATE POLICY "recebimento_update" ON public.recebimento_materiais
  FOR UPDATE USING (public.is_approved_user());

-- Exclusão: apenas admins
DROP POLICY IF EXISTS "recebimento_delete" ON public.recebimento_materiais;
CREATE POLICY "recebimento_delete" ON public.recebimento_materiais
  FOR DELETE USING (public.is_admin_user());

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_recebimento_status     ON public.recebimento_materiais(status);
CREATE INDEX IF NOT EXISTS idx_recebimento_lote       ON public.recebimento_materiais(lote);
CREATE INDEX IF NOT EXISTS idx_recebimento_created_at ON public.recebimento_materiais(created_at DESC);
