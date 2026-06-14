-- =============================================================================
-- COMERCIAL — Clientes, pedidos, itens, RPCs, NCM/CFOP, melhorias de produto
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 20260010000000_comercial_tables.sql
-- ─────────────────────────────────────────────────────────────────────────────

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
                      CHECK (status IN ('pendente','separando','pronto','faturado','enviado','cancelado','retorno')),
  observacoes         text,
  frete               numeric(10,2) NOT NULL DEFAULT 0,
  desconto_pct        numeric(5,2) NOT NULL DEFAULT 0 CHECK (desconto_pct BETWEEN 0 AND 100),
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
  stock_item_id        uuid NOT NULL, -- FK adicionada depois em _estoque via ALTER TABLE (stock_items criada lá)
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
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','comercial','estoque','financeiro'))
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
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','comercial','estoque','financeiro'))
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
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','comercial','estoque','financeiro'))
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260011000000_comercial_rpcs.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── cancel_pedido ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_pedido(p_pedido_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f01$
BEGIN
  UPDATE public.stock_items si
  SET quantity_reserved = GREATEST(0, si.quantity_reserved - pi.quantidade_reservada)
  FROM public.pedido_itens pi
  WHERE pi.pedido_id = p_pedido_id AND pi.stock_item_id = si.id;

  UPDATE public.pedidos_comerciais SET status = 'cancelado' WHERE id = p_pedido_id;
  RETURN jsonb_build_object('success', true);
END;
$f01$;

-- ── marcar_pedido_pronto ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.marcar_pedido_pronto(p_pedido_id uuid, p_user_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f02$
DECLARE
  v_pedido      RECORD;
  v_ls          RECORD;
  v_item        RECORD;
  v_exp_item_id uuid;
  v_cliente     text;
  v_vendedora   text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;

  SELECT pc.id, pc.status, pc.lotes_separados, cl.nome AS cliente_nome, pc.vendedora_nome
  INTO v_pedido
  FROM public.pedidos_comerciais pc JOIN public.clientes cl ON cl.id = pc.cliente_id
  WHERE pc.id = p_pedido_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado'); END IF;
  IF v_pedido.status != 'separando' THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido não está em separação'); END IF;

  v_cliente   := COALESCE(v_pedido.cliente_nome, 'Cliente');
  v_vendedora := COALESCE(v_pedido.vendedora_nome, p_user_name, 'Estoque');

  IF v_pedido.lotes_separados IS NOT NULL AND jsonb_array_length(v_pedido.lotes_separados) > 0 THEN
    FOR v_ls IN
      SELECT (elem->>'stock_item_id')::uuid AS stock_item_id,
             (elem->>'lote')                AS lote,
             (elem->>'quantidade')::int     AS quantidade
      FROM jsonb_array_elements(v_pedido.lotes_separados) AS elem
    LOOP
      SELECT si2.id INTO v_exp_item_id FROM public.stock_items si1
      JOIN public.stock_items si2 ON si2.device_id = si1.device_id AND si2.fase = 'expedicao'
      WHERE si1.id = v_ls.stock_item_id AND si1.fase != 'expedicao' LIMIT 1;
      IF v_exp_item_id IS NULL THEN v_exp_item_id := v_ls.stock_item_id; END IF;

      UPDATE public.stock_items SET quantity = GREATEST(0, quantity - v_ls.quantidade), updated_at = now() WHERE id = v_exp_item_id;
      UPDATE public.stock_items si SET quantity_reserved = COALESCE((
        SELECT SUM(pi2.quantidade) FROM public.pedido_itens pi2
        JOIN public.pedidos_comerciais pc2 ON pc2.id = pi2.pedido_id
        WHERE pi2.stock_item_id = v_exp_item_id AND pc2.status IN ('pendente','separando') AND pc2.id != p_pedido_id
      ), 0) WHERE si.id = v_exp_item_id;

      INSERT INTO public.stock_movements(stock_item_id, type, quantity, lote, reason, user_display_name)
      VALUES (v_exp_item_id, 'saida', v_ls.quantidade, v_ls.lote,
        'Pedido comercial — cliente: ' || v_cliente || ' (lote: ' || COALESCE(v_ls.lote,'—') || ')', v_vendedora);
    END LOOP;
  ELSE
    FOR v_item IN SELECT pi.stock_item_id, pi.quantidade, pi.lote FROM public.pedido_itens pi WHERE pi.pedido_id = p_pedido_id
    LOOP
      SELECT si2.id INTO v_exp_item_id FROM public.stock_items si1
      JOIN public.stock_items si2 ON si2.device_id = si1.device_id AND si2.fase = 'expedicao'
      WHERE si1.id = v_item.stock_item_id AND si1.fase != 'expedicao' LIMIT 1;
      IF v_exp_item_id IS NULL THEN v_exp_item_id := v_item.stock_item_id; END IF;

      UPDATE public.stock_items SET quantity = GREATEST(0, quantity - v_item.quantidade), updated_at = now() WHERE id = v_exp_item_id;
      UPDATE public.stock_items si SET quantity_reserved = COALESCE((
        SELECT SUM(pi2.quantidade) FROM public.pedido_itens pi2
        JOIN public.pedidos_comerciais pc2 ON pc2.id = pi2.pedido_id
        WHERE pi2.stock_item_id = v_exp_item_id AND pc2.status IN ('pendente','separando') AND pc2.id != p_pedido_id
      ), 0) WHERE si.id = v_exp_item_id;

      INSERT INTO public.stock_movements(stock_item_id, type, quantity, lote, reason, user_display_name)
      VALUES (v_exp_item_id, 'saida', v_item.quantidade, v_item.lote,
        'Pedido comercial — cliente: ' || v_cliente || ' (separação concluída)', v_vendedora);
    END LOOP;
  END IF;

  UPDATE public.pedidos_comerciais
  SET status = 'pronto', separado_por = auth.uid(), separado_em = now()
  WHERE id = p_pedido_id AND status = 'separando';

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado ou status inválido'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$f02$;

-- ── faturar_pedido ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.faturar_pedido(p_pedido_id uuid, p_nf text, p_user_id uuid, p_user_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f03$
DECLARE v_item RECORD;
BEGIN
  UPDATE public.pedidos_comerciais SET status='faturado', nota_fiscal=p_nf, faturado_em=now()
  WHERE id=p_pedido_id AND status='pronto';
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Pedido não encontrado ou status inválido'); END IF;

  FOR v_item IN SELECT pi.stock_item_id, pi.quantidade, pi.lote FROM public.pedido_itens pi WHERE pi.pedido_id=p_pedido_id
  LOOP
    UPDATE public.stock_items SET quantity=GREATEST(0,quantity-v_item.quantidade), quantity_reserved=GREATEST(0,quantity_reserved-v_item.quantidade) WHERE id=v_item.stock_item_id;
    INSERT INTO public.stock_movements(stock_item_id,type,quantity,reason,lote,user_id,user_display_name)
    VALUES(v_item.stock_item_id,'saida',v_item.quantidade,'NF '||p_nf,v_item.lote,p_user_id,p_user_name);
  END LOOP;
  RETURN jsonb_build_object('ok',true);
END;
$f03$;

-- ── faturar_pedido_sefaz ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.faturar_pedido_sefaz(uuid,text,text,text,timestamptz,uuid,text);
DROP FUNCTION IF EXISTS public.faturar_pedido_sefaz(uuid,text,text,text,timestamptz,uuid,text,text);

CREATE OR REPLACE FUNCTION public.faturar_pedido_sefaz(
  p_pedido_id uuid, p_nf text, p_chave_acesso text, p_protocolo text,
  p_dh_autorizacao timestamptz, p_user_id uuid, p_user_name text, p_xml_nfe text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f04$
DECLARE v_item RECORD;
BEGIN
  UPDATE public.pedidos_comerciais SET
    status='enviado', nota_fiscal=p_nf, chave_acesso_nfe=p_chave_acesso,
    protocolo_sefaz=p_protocolo, dh_autorizacao_nfe=p_dh_autorizacao,
    nf_criada_por=p_user_id, nf_criada_em=now(), enviado_em=now(), xml_nfe=p_xml_nfe
  WHERE id=p_pedido_id AND status='pronto';
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Pedido não encontrado ou status inválido'); END IF;

  FOR v_item IN SELECT pi.stock_item_id, pi.quantidade, pi.lote FROM public.pedido_itens pi WHERE pi.pedido_id=p_pedido_id
  LOOP
    UPDATE public.stock_items SET quantity=GREATEST(0,quantity-v_item.quantidade), quantity_reserved=GREATEST(0,quantity_reserved-v_item.quantidade) WHERE id=v_item.stock_item_id;
    INSERT INTO public.stock_movements(stock_item_id,type,quantity,reason,lote,user_id,user_display_name)
    VALUES(v_item.stock_item_id,'saida',v_item.quantidade,'SEFAZ '||p_nf||' | Prot: '||p_protocolo,v_item.lote,p_user_id,p_user_name);
  END LOOP;
  RETURN jsonb_build_object('ok',true,'nf',p_nf);
END;
$f04$;
GRANT EXECUTE ON FUNCTION public.faturar_pedido_sefaz(uuid,text,text,text,timestamptz,uuid,text,text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260014000000_ncm_cfop_trigger.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_ncm_device(
  p_risk_class text, p_implantable boolean, p_body_region text,
  p_classification text, p_primary_material text
) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f01$
DECLARE
  v_body     text := lower(coalesce(p_body_region,''));
  v_class    text := lower(coalesce(p_classification,''));
  v_material text := lower(coalesce(p_primary_material,''));
BEGIN
  IF p_implantable = true AND (v_body LIKE '%oral%' OR v_body LIKE '%dent%' OR v_body LIKE '%buc%') THEN
    IF v_class LIKE '%implant%' OR v_class LIKE '%fixture%' OR v_class LIKE '%parafus%' THEN RETURN '9021.29.10'; END IF;
    IF v_class LIKE '%pilar%' OR v_class LIKE '%abutment%' OR v_class LIKE '%proteti%' OR v_class LIKE '%protese%' OR v_class LIKE '%prótese%' THEN RETURN '9021.39.90'; END IF;
    IF v_material LIKE '%titani%' OR v_material LIKE '%ti-6%' OR v_material LIKE '%titanium%' THEN RETURN '9021.29.10'; END IF;
    RETURN '9021.39.90';
  END IF;
  IF v_body LIKE '%oral%' OR v_body LIKE '%dent%' OR v_body LIKE '%buc%' THEN
    IF v_class LIKE '%instrumen%' OR v_class LIKE '%tool%' OR v_class LIKE '%broca%' OR v_class LIKE '%fresa%' OR v_class LIKE '%kit%' THEN RETURN '9018.49.90'; END IF;
    RETURN '9021.39.90';
  END IF;
  IF p_risk_class IN ('III','IV') AND p_implantable = true THEN RETURN '9021.39.90'; END IF;
  IF p_risk_class IN ('I','II') THEN RETURN '9018.90.99'; END IF;
  RETURN '9021.39.90';
END;
$f01$;

CREATE OR REPLACE FUNCTION public.resolve_cfop_device(p_implantable boolean)
RETURNS text LANGUAGE sql IMMUTABLE AS $f02$ SELECT '5102'; $f02$;

CREATE OR REPLACE FUNCTION public.trg_auto_ncm_cfop()
RETURNS trigger LANGUAGE plpgsql AS $f03$
BEGIN
  IF NEW.ncm IS NULL OR NEW.ncm = '' OR NEW.ncm = '90213990' THEN
    NEW.ncm := replace(public.resolve_ncm_device(NEW.risk_class, NEW.implantable, NEW.body_region, NEW.classification_code, NEW.primary_material), '.', '');
  END IF;
  IF NEW.cfop_padrao IS NULL OR NEW.cfop_padrao = '' OR NEW.cfop_padrao = '5102' THEN
    NEW.cfop_padrao := public.resolve_cfop_device(NEW.implantable);
  END IF;
  IF NEW.unidade IS NULL OR NEW.unidade = '' THEN NEW.unidade := 'UN'; END IF;
  RETURN NEW;
END;
$f03$;

DROP TRIGGER IF EXISTS trg_devices_auto_ncm_cfop ON public.devices;
CREATE TRIGGER trg_devices_auto_ncm_cfop
  BEFORE INSERT OR UPDATE OF risk_class, implantable, body_region, classification_code, primary_material
  ON public.devices FOR EACH ROW EXECUTE FUNCTION public.trg_auto_ncm_cfop();

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260018000000_melhorias_produto.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. prazo_entrega em pedidos_comerciais
-- 2. Tabela de comentários internos por pedido
-- 3. Tabela de favoritos de peças por vendedora

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

-- ── RPC: resolve NCM por device_id (usado pelo botão "Sugerir NCM" no frontend) ──
CREATE OR REPLACE FUNCTION public.resolve_ncm_device_by_id(p_device_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_rec record;
BEGIN
  SELECT risk_class, implantable, body_region, classification_code, primary_material
    INTO v_rec FROM public.devices WHERE id = p_device_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN replace(
    public.resolve_ncm_device(
      v_rec.risk_class, v_rec.implantable, v_rec.body_region,
      v_rec.classification_code, v_rec.primary_material
    ), '.', ''
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_ncm_device_by_id(uuid) TO authenticated;
