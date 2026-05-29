-- =============================================================================
-- 010: Módulo Comercial — clientes, pedidos, itens, notificações
-- =============================================================================

-- ── Clientes ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clientes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  documento   text,
  telefone    text,
  email       text,
  endereco    text,
  observacoes text,
  ie          text,
  cep         text,
  logradouro  text,
  numero      text,
  bairro      text,
  municipio   text,
  uf          char(2),
  c_mun       char(7),
  ind_ie_dest int DEFAULT 9,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS clientes_updated_at ON public.clientes;
CREATE TRIGGER clientes_updated_at BEFORE UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Pedidos Comerciais ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedidos_comerciais (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id          uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  vendedora_id        uuid REFERENCES auth.users(id),
  vendedora_nome      text,
  status              text NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente','separando','pronto','faturado','enviado','cancelado')),
  observacoes         text,
  frete               numeric(10,2) NOT NULL DEFAULT 0,
  desconto_pct        integer NOT NULL DEFAULT 0 CHECK (desconto_pct BETWEEN 0 AND 100),
  separado_por        uuid REFERENCES auth.users(id),
  separado_em         timestamptz,
  faturado_por        uuid REFERENCES auth.users(id),
  faturado_em         timestamptz,
  nota_fiscal         text,
  nf_criada_por       uuid REFERENCES auth.users(id),
  nf_criada_em        timestamptz,
  enviado_em          timestamptz,
  lotes_separados     jsonb,
  chave_acesso_nfe    text,
  protocolo_sefaz     text,
  dh_autorizacao_nfe  timestamptz,
  tipo_nf             text CHECK (tipo_nf IN ('nfe','nfce')),
  xml_nfe             text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pedidos_comerciais ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS pedidos_updated_at ON public.pedidos_comerciais;
CREATE TRIGGER pedidos_updated_at BEFORE UPDATE ON public.pedidos_comerciais FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_chave_acesso ON public.pedidos_comerciais(chave_acesso_nfe) WHERE chave_acesso_nfe IS NOT NULL;

-- ── Itens do Pedido ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedido_itens (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id            uuid NOT NULL REFERENCES public.pedidos_comerciais(id) ON DELETE CASCADE,
  stock_item_id        uuid NOT NULL REFERENCES public.stock_items(id) ON DELETE CASCADE,
  lote                 text,
  quantidade           integer NOT NULL CHECK (quantidade > 0),
  quantidade_reservada integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pedido_itens ENABLE ROW LEVEL SECURITY;

-- ── Notificações ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notificacoes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pedido_id  uuid REFERENCES public.pedidos_comerciais(id) ON DELETE CASCADE,
  tipo       text NOT NULL,
  titulo     text NOT NULL,
  mensagem   text,
  lida       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;

-- ── RLS Comercial ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "clientes_select" ON public.clientes;
CREATE POLICY "clientes_select" ON public.clientes FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','funcionario','financeiro'))
  OR auth.uid() = created_by
);
DROP POLICY IF EXISTS "clientes_insert" ON public.clientes;
CREATE POLICY "clientes_insert" ON public.clientes FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
DROP POLICY IF EXISTS "clientes_update" ON public.clientes;
CREATE POLICY "clientes_update" ON public.clientes FOR UPDATE TO authenticated USING (
  auth.uid() = created_by OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);
DROP POLICY IF EXISTS "clientes_delete" ON public.clientes;
CREATE POLICY "clientes_delete" ON public.clientes FOR DELETE TO authenticated USING (
  auth.uid() = created_by OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "pedidos_select" ON public.pedidos_comerciais;
CREATE POLICY "pedidos_select" ON public.pedidos_comerciais FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','funcionario','financeiro'))
  OR vendedora_id = auth.uid()
);
DROP POLICY IF EXISTS "pedidos_insert" ON public.pedidos_comerciais;
CREATE POLICY "pedidos_insert" ON public.pedidos_comerciais FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "pedidos_update" ON public.pedidos_comerciais;
CREATE POLICY "pedidos_update" ON public.pedidos_comerciais FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "pedidos_delete" ON public.pedidos_comerciais;
CREATE POLICY "pedidos_delete" ON public.pedidos_comerciais FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "pedido_itens_select" ON public.pedido_itens;
CREATE POLICY "pedido_itens_select" ON public.pedido_itens FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.pedidos_comerciais pc WHERE pc.id = pedido_id AND (
    pc.vendedora_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','funcionario','financeiro'))
  ))
);
DROP POLICY IF EXISTS "pedido_itens_insert" ON public.pedido_itens;
CREATE POLICY "pedido_itens_insert" ON public.pedido_itens FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "pedido_itens_update" ON public.pedido_itens;
CREATE POLICY "pedido_itens_update" ON public.pedido_itens FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "pedido_itens_delete" ON public.pedido_itens;
CREATE POLICY "pedido_itens_delete" ON public.pedido_itens FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "notif_select" ON public.notificacoes;
CREATE POLICY "notif_select" ON public.notificacoes FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "notif_insert" ON public.notificacoes;
CREATE POLICY "notif_insert" ON public.notificacoes FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "notif_update" ON public.notificacoes;
CREATE POLICY "notif_update" ON public.notificacoes FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- ── Índices ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pedidos_status         ON public.pedidos_comerciais(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_vendedora      ON public.pedidos_comerciais(vendedora_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente        ON public.pedidos_comerciais(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido    ON public.pedido_itens(pedido_id);
CREATE INDEX IF NOT EXISTS idx_pedido_itens_stock     ON public.pedido_itens(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_clientes_created_by    ON public.clientes(created_by);
CREATE INDEX IF NOT EXISTS idx_notif_user_lida        ON public.notificacoes(user_id, lida, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_roles_role        ON public.user_roles(role);
