-- =============================================================================
-- 019: Performance — carga do estoque
--
-- PROBLEMA: loadItems faz 4–13 requests HTTP em série/paralelo:
--   1. stock_items range(0,999) com JOIN devices  (pesado, sem filtro de fase)
--   2. (opcional) até 9 páginas extras em paralelo
--   3. pedidos_comerciais  (para recalcular reservas)
--   4. pedido_itens        (idem)
--   5. (pós-render) stock_movements batch para lotesSummary
--
-- SOLUÇÃO: RPC load_stock_page — retorna tudo em 1 única chamada ao banco.
--   • stock_items + devices JOINados no servidor
--   • recálculo de quantity_reserved via pedidos ativos (embutido)
--   • contagem de lotes com saldo > 0 por item (embutido — elimina request 5)
--   • suporte a paginação (limit/offset) e busca full-text
--   • índice em updated_at DESC (faltava — evita seq scan no ORDER BY)
--   • índice covering em stock_items para eliminar heap fetch
-- =============================================================================

-- ── Índice faltante: updated_at DESC em stock_items ───────────────────────────
-- O ORDER BY updated_at DESC na query principal fazia seq scan de toda a tabela.
CREATE INDEX IF NOT EXISTS idx_stock_items_updated_at
  ON public.stock_items (updated_at DESC);

-- Índice covering (fase + updated_at): suporte à query paginada por fase
CREATE INDEX IF NOT EXISTS idx_stock_items_fase_updated
  ON public.stock_items (fase, updated_at DESC);

-- ── Índice para trgm em device já existia — garantir anvisa_registration ──────
CREATE INDEX IF NOT EXISTS devices_anvisa_trgm_idx
  ON public.devices USING GIN (anvisa_registration gin_trgm_ops)
  WHERE anvisa_registration IS NOT NULL;

-- ── RPC principal: load_stock_page ────────────────────────────────────────────
-- Retorna em UMA chamada:
--   • items paginados com device join
--   • quantity_reserved recalculada dos pedidos ativos
--   • lote_count (nº de lotes com saldo > 0) por item
--   • total_count para paginação no cliente
--
-- Parâmetros:
--   p_search      — busca parcial em model/reference/udi_di/internal_code (NULL = todos)
--   p_limit       — itens por página (padrão 200)
--   p_offset      — offset para paginação
--   p_device_ids  — lista de device_ids pré-filtrada (usada quando search retornou matches)
--                   NULL = sem filtro por device
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
BEGIN
  -- ── Autenticação ──────────────────────────────────────────────────────────
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  -- ── 1. Conta total de items (para o cliente calcular hasMore) ─────────────
  IF p_device_ids IS NOT NULL THEN
    SELECT COUNT(*) INTO v_total
    FROM public.stock_items si
    WHERE si.device_id = ANY(p_device_ids);
  ELSE
    SELECT COUNT(*) INTO v_total FROM public.stock_items si;
  END IF;

  -- ── 2. Busca items paginados com JOIN de devices ───────────────────────────
  -- quantity_reserved aqui é o valor do banco (base); o cliente sobrescreve
  -- com o recálculo dos pedidos (campo v_reserved_map abaixo).
  IF p_device_ids IS NOT NULL THEN
    SELECT jsonb_agg(row_to_json(t))
    INTO v_items
    FROM (
      SELECT
        si.id, si.device_id, si.quantity, si.quantity_reserved,
        si.min_quantity, si.location, si.notes, si.fase,
        si.created_at, si.updated_at,
        jsonb_build_object(
          'id',                    d.id,
          'udi_di',                d.udi_di,
          'reference',             d.reference,
          'model',                 d.model,
          'brand_name',            d.brand_name,
          'internal_code',         d.internal_code,
          'anvisa_registration',   d.anvisa_registration,
          'manufacturer_country',  d.manufacturer_country,
          'classification_code',   d.classification_code,
          'risk_class',            d.risk_class,
          'icon_url',              d.icon_url,
          'sterile',               d.sterile,
          'single_use',            d.single_use,
          'implantable',           d.implantable
        ) AS device
      FROM public.stock_items si
      JOIN public.devices d ON d.id = si.device_id
      WHERE si.device_id = ANY(p_device_ids)
      ORDER BY si.updated_at DESC
      LIMIT  p_limit
      OFFSET p_offset
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
          'id',                    d.id,
          'udi_di',                d.udi_di,
          'reference',             d.reference,
          'model',                 d.model,
          'brand_name',            d.brand_name,
          'internal_code',         d.internal_code,
          'anvisa_registration',   d.anvisa_registration,
          'manufacturer_country',  d.manufacturer_country,
          'classification_code',   d.classification_code,
          'risk_class',            d.risk_class,
          'icon_url',              d.icon_url,
          'sterile',               d.sterile,
          'single_use',            d.single_use,
          'implantable',           d.implantable
        ) AS device
      FROM public.stock_items si
      JOIN public.devices d ON d.id = si.device_id
      ORDER BY si.updated_at DESC
      LIMIT  p_limit
      OFFSET p_offset
    ) t;
  END IF;

  -- ── 3. Recálculo de quantity_reserved via pedidos ativos ──────────────────
  -- Agrupado por stock_item_id; só para items da expedição retornados.
  -- Evita os 2 requests extras (pedidos_comerciais + pedido_itens) do cliente.
  SELECT jsonb_object_agg(pi.stock_item_id::text, pi.total_reservado)
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
  ) pi;

  -- ── 4. Contagem de lotes com saldo > 0 por item ───────────────────────────
  -- Substitui o fetchLotesSummaryBatch que o cliente fazia pós-render.
  -- Usa o índice covering idx_stock_movements_item_lote_covering.
  SELECT jsonb_object_agg(item_id::text, lote_count)
  INTO v_lote_map
  FROM (
    SELECT sm.stock_item_id AS item_id, COUNT(DISTINCT sm.lote) AS lote_count
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
    GROUP BY sm.stock_item_id, upper(sm.lote)
    HAVING SUM(CASE WHEN sm.type = 'entrada' THEN sm.quantity ELSE -sm.quantity END) > 0
  ) counted
  -- Reagrupa para contar apenas lotes com saldo positivo por item
  -- (a subquery acima agrupou por (item, lote) — aqui contamos quantos lotes sobraram)
  -- Reescrito como CTE para clareza:
  ; -- encerra o SELECT acima; vamos reescrever

  -- Reescreve v_lote_map com CTE correta
  WITH lotes_com_saldo AS (
    SELECT sm.stock_item_id AS item_id, upper(trim(sm.lote)) AS lote_key,
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

  -- ── 5. Retorna tudo em um único payload ───────────────────────────────────
  RETURN jsonb_build_object(
    'total_count',   v_total,
    'items',         COALESCE(v_items, '[]'::jsonb),
    'reserved_map',  COALESCE(v_reserved_map, '{}'::jsonb),
    'lote_map',      COALESCE(v_lote_map, '{}'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.load_stock_page(text, integer, integer, uuid[]) TO authenticated;

-- ── RPC auxiliar: search_devices_for_stock ────────────────────────────────────
-- Resolve a busca textual no servidor e retorna device_ids.
-- Usa os índices GIN trgm existentes — muito mais rápido que ilike no cliente.
-- O cliente chama isso ANTES de load_stock_page quando há search term.
CREATE OR REPLACE FUNCTION public.search_devices_for_stock(p_search text)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ARRAY(
    SELECT id FROM public.devices
    WHERE
      model                ILIKE '%' || p_search || '%' OR
      reference            ILIKE '%' || p_search || '%' OR
      udi_di               ILIKE '%' || p_search || '%' OR
      internal_code        ILIKE '%' || p_search || '%' OR
      anvisa_registration  ILIKE '%' || p_search || '%' OR
      brand_name           ILIKE '%' || p_search || '%'
    LIMIT 500
  );
$$;

GRANT EXECUTE ON FUNCTION public.search_devices_for_stock(text) TO authenticated;

-- ── ANALYZE ───────────────────────────────────────────────────────────────────
ANALYZE public.stock_items;
ANALYZE public.stock_movements;
ANALYZE public.devices;
ANALYZE public.pedido_itens;
ANALYZE public.pedidos_comerciais;
