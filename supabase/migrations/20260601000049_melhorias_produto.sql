-- =============================================================================
-- 018: Melhorias de produto
-- 1. prazo_entrega em pedidos_comerciais
-- 2. Tabela de comentários internos por pedido
-- 3. Tabela de favoritos de peças por vendedora
-- =============================================================================

-- ── 1. Prazo de entrega ───────────────────────────────────────────────────────
ALTER TABLE public.pedidos_comerciais
  ADD COLUMN IF NOT EXISTS prazo_entrega date;

CREATE INDEX IF NOT EXISTS idx_pedidos_prazo_entrega
  ON public.pedidos_comerciais (prazo_entrega)
  WHERE prazo_entrega IS NOT NULL AND status NOT IN ('cancelado','enviado');

-- ── 2. Comentários internos por pedido ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedido_comentarios (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id   uuid        NOT NULL REFERENCES public.pedidos_comerciais(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name   text        NOT NULL,
  texto       text        NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 2000),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comentarios_pedido
  ON public.pedido_comentarios (pedido_id, created_at DESC);

ALTER TABLE public.pedido_comentarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comentarios_read" ON public.pedido_comentarios;
CREATE POLICY "comentarios_read" ON public.pedido_comentarios
  FOR SELECT TO authenticated USING (
    public.is_approved_user() OR public.is_admin_user()
  );

DROP POLICY IF EXISTS "comentarios_insert" ON public.pedido_comentarios;
CREATE POLICY "comentarios_insert" ON public.pedido_comentarios
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid() AND (public.is_approved_user() OR public.is_admin_user())
  );

-- ── 3. Favoritos de peças por vendedora ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.peca_favoritas (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id  uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);

ALTER TABLE public.peca_favoritas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "favoritas_self" ON public.peca_favoritas;
CREATE POLICY "favoritas_self" ON public.peca_favoritas
  FOR ALL USING (user_id = auth.uid());
