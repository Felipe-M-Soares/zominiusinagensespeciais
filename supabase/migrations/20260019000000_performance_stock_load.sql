-- =============================================================================
-- 019: Performance — carga do estoque
--
-- Substitui 4–13 requests HTTP por 1 chamada ao banco (RPC load_stock_page).
-- Também corrige ausência de índice em updated_at (seq scan no ORDER BY).
--
-- Problemas corrigidos vs versão anterior:
--   • Bloco SQL morto removido (dupla atribuição de v_lote_map)
--   • search_devices_for_stock: adicionado guard auth.uid()
--   • load_stock_page: p_limit clampado a 500 (DoS prevention)
-- =============================================================================

-- ── Índice faltante: updated_at DESC em stock_items ───────────────────────────
-- O ORDER BY updated_at DESC fazia seq scan de toda a tabela.
CREATE INDEX IF NOT EXISTS idx_stock_items_updated_at
  ON public.stock_items (updated_at DESC);

-- Índice covering (fase + updated_at)
CREATE INDEX IF NOT EXISTS idx_stock_items_fase_updated
  ON public.stock_items (fase, updated_at DESC);

-- Índice trgm em anvisa_registration (faltava)
CREATE INDEX IF NOT EXISTS devices_anvisa_trgm_idx
  ON public.devices USING GIN (anvisa_registration gin_trgm_ops)
  WHERE anvisa_registration IS NOT NULL;

-- ── RPC auxiliar: search_devices_for_stock ────────────────────────────────────
-- Resolve busca textual no servidor usando índices GIN trgm.
-- Chamado pelo cliente ANTES de load_stock_page quando há termo de busca.
-- Fix: guard auth.uid() adicionado (estava ausente na versão anterior).
CREATE OR REPLACE FUNCTION public.search_devices_for_stock(p_search text)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- SEG: rejeita chamadas não autenticadas (padrão do projeto)
  IF auth.uid() IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  RETURN ARRAY(
    SELECT id FROM public.devices
    WHERE
      model               ILIKE '%' || p_search || '%' OR
      reference           ILIKE '%' || p_search || '%' OR
      udi_di              ILIKE '%' || p_search || '%' OR
      internal_code       ILIKE '%' || p_search || '%' OR
      anvisa_registration ILIKE '%' || p_search || '%' OR
      brand_name          ILIKE '%' || p_search || '%'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_devices_for_stock(text) TO authenticated;

-- ── RPC principal: load_stock_page ────────────────────────────────────────────
-- Retorna em UMA chamada:
--   • items paginados com device join
--   • reserved_map: quantity_reserved recalculada dos pedidos ativos
--   • lote_map: contagem de lotes com saldo > 0 por item
--   • total_count para o cliente
--
-- Fixes vs versão anterior:
--   • p_limit clampado a LEAST(p_limit, 500) — previne DoS
--   • bloco SQL morto (dupla atribuição de v_lote_map) removido
--   • lote_map calculado com CTE limpa e única
CREATE OR REPLACE FUNCTION public.load_stock_page(
  p_search      text    DEFAULT NULL,
  p_limit       integer DEFAULT 200,
  p_offset      integer DEFAULT 0,
  p_device_ids  uuid[]  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total        bigint;
  v_items        jsonb;
  v_reserved_map jsonb;
  v_lote_map     jsonb;
  v_limit        integer;
BEGIN
  -- SEG: rejeita chamadas não autenticadas
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  -- DoS prevention: limita o máximo de linhas retornadas independente do que o cliente pede
  v_limit := LEAST(COALESCE(p_limit, 200), 500);

  -- ── 1. Conta total ────────────────────────────────────────────────────────
  IF p_device_ids IS NOT NULL THEN
    SELECT COUNT(*) INTO v_total
    FROM public.stock_items
    WHERE device_id = ANY(p_device_ids);
  ELSE
    SELECT COUNT(*) INTO v_total FROM public.stock_items;
  END IF;

  -- ── 2. Items paginados com JOIN de devices ────────────────────────────────
  IF p_device_ids IS NOT NULL THEN
    SELECT jsonb_agg(row_to_json(t))
    INTO v_items
    FROM (
      SELECT
        si.id, si.device_id, si.quantity, si.quantity_reserved,
        si.min_quantity, si.location, si.notes, si.fase,
        si.created_at, si.updated_at,
        jsonb_build_object(
          'id',                   d.id,
          'udi_di',               d.udi_di,
          'reference',            d.reference,
          'model',                d.model,
          'brand_name',           d.brand_name,
          'internal_code',        d.internal_code,
          'anvisa_registration',  d.anvisa_registration,
          'manufacturer_country', d.manufacturer_country,
          'classification_code',  d.classification_code,
          'risk_class',           d.risk_class,
          'icon_url',             d.icon_url,
          'sterile',              d.sterile,
          'single_use',           d.single_use,
          'implantable',          d.implantable
        ) AS device
      FROM public.stock_items si
      JOIN public.devices d ON d.id = si.device_id
      WHERE si.device_id = ANY(p_device_ids)
      ORDER BY si.updated_at DESC
      OFFSET COALESCE(p_offset, 0)
    ) t;
  ELSE
    SELECT jsonb_agg(row_to_json(t))
    INTO v_items
    FROM (
      SELECT
        si.id, si.device_id, si.quantity, si.quantity_reserved,
        si.min_quantity, si.location, si.notes, si.fase,
        si.created_at, si.updated_at,
        jsonb_build_object(
          'id',                   d.id,
          'udi_di',               d.udi_di,
          'reference',            d.reference,
          'model',                d.model,
          'brand_name',           d.brand_name,
          'internal_code',        d.internal_code,
          'anvisa_registration',  d.anvisa_registration,
          'manufacturer_country', d.manufacturer_country,
          'classification_code',  d.classification_code,
          'risk_class',           d.risk_class,
          'icon_url',             d.icon_url,
          'sterile',              d.sterile,
          'single_use',           d.single_use,
          'implantable',          d.implantable
        ) AS device
      FROM public.stock_items si
      JOIN public.devices d ON d.id = si.device_id
      ORDER BY si.updated_at DESC
      LIMIT  v_limit
      OFFSET COALESCE(p_offset, 0)
    ) t;
  END IF;

  -- ── 3. reserved_map: quantity_reserved real via pedidos ativos ───────────
  -- Apenas para items de expedição na página atual.
  -- Substitui os 2 requests extras (pedidos_comerciais + pedido_itens) do cliente.
  SELECT jsonb_object_agg(agg.stock_item_id::text, agg.total_reservado)
  INTO v_reserved_map
  FROM (
    SELECT pi.stock_item_id, SUM(pi.quantidade) AS total_reservado
    FROM public.pedido_itens pi
    JOIN public.pedidos_comerciais pc ON pc.id = pi.pedido_id
    WHERE pc.status IN ('pendente', 'separando')
      AND pi.stock_item_id IN (
        SELECT (elem->>'id')::uuid
        FROM jsonb_array_elements(COALESCE(v_items, '[]'::jsonb)) elem
        WHERE elem->>'fase' = 'expedicao'
      )
    GROUP BY pi.stock_item_id
  ) agg;

  -- ── 4. lote_map: contagem de lotes com saldo > 0 por item ────────────────
  -- CTE única e correta (sem código morto).
  -- Substitui o fetchLotesSummaryBatch que o cliente fazia pós-render.
  WITH lotes_com_saldo AS (
    SELECT
      sm.stock_item_id                                                          AS item_id,
      upper(trim(sm.lote))                                                      AS lote_key,
      SUM(CASE WHEN sm.type = 'entrada' THEN sm.quantity ELSE -sm.quantity END) AS saldo
    FROM public.stock_movements sm
    WHERE sm.stock_item_id IN (
        SELECT (elem->>'id')::uuid
        FROM jsonb_array_elements(COALESCE(v_items, '[]'::jsonb)) elem
      )
      AND sm.lote IS NOT NULL
      AND lower(trim(sm.lote)) NOT IN ('a-definir', 'a definir', 'sem lote')
      AND (sm.reason IS NULL OR sm.reason NOT IN (
        'Recebido de Intermediário',
        'Retrabalho concluído — recebido do Retrabalho',
        'Rollback — falha ao criar item de retrabalho',
        'Rollback — falha ao criar item de expedição',
        'Rollback — falha ao registrar entrada na expedição'
      ))
    GROUP BY sm.stock_item_id, upper(trim(sm.lote))
    HAVING SUM(CASE WHEN sm.type = 'entrada' THEN sm.quantity ELSE -sm.quantity END) > 0
  ),
  lote_counts AS (
    SELECT item_id, COUNT(*) AS lote_count
    FROM lotes_com_saldo
    GROUP BY item_id
  )
  SELECT jsonb_object_agg(item_id::text, lote_count)
  INTO v_lote_map
  FROM lote_counts;

  -- ── 5. Retorna payload unificado ──────────────────────────────────────────
  RETURN jsonb_build_object(
    'total_count',  v_total,
    'items',        COALESCE(v_items,        '[]'::jsonb),
    'reserved_map', COALESCE(v_reserved_map, '{}'::jsonb),
    'lote_map',     COALESCE(v_lote_map,     '{}'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.load_stock_page(text, integer, integer, uuid[]) TO authenticated;

-- ── ANALYZE ───────────────────────────────────────────────────────────────────
ANALYZE public.stock_items;
ANALYZE public.stock_movements;
ANALYZE public.devices;
ANALYZE public.pedido_itens;
ANALYZE public.pedidos_comerciais;
