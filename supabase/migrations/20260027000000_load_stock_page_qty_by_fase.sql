-- =============================================================================
-- 027: Adiciona qty_by_fase ao RPC load_stock_page
-- Retorna soma de quantity por fase para o header do Estoque mostrar o total
-- real mesmo quando há paginação (cliente só recebe até 500 itens por página)
-- =============================================================================

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
AS $f01$
DECLARE
  v_total        bigint;
  v_items        jsonb;
  v_reserved_map jsonb;
  v_lote_map     jsonb;
  v_qty_by_fase  jsonb;
  v_limit        integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_limit := LEAST(COALESCE(p_limit, 200), 500);

  -- 1. Total de itens
  IF p_device_ids IS NOT NULL THEN
    SELECT COUNT(*) INTO v_total FROM public.stock_items WHERE device_id = ANY(p_device_ids);
  ELSE
    SELECT COUNT(*) INTO v_total FROM public.stock_items;
  END IF;

  -- 2. Items paginados
  IF p_device_ids IS NOT NULL THEN
    SELECT jsonb_agg(row_to_json(t)) INTO v_items FROM (
      SELECT si.id, si.device_id, si.quantity, si.quantity_reserved,
        si.min_quantity, si.location, si.notes, si.fase, si.created_at, si.updated_at,
        jsonb_build_object('id',d.id,'udi_di',d.udi_di,'reference',d.reference,'model',d.model,
          'brand_name',d.brand_name,'internal_code',d.internal_code,
          'anvisa_registration',d.anvisa_registration,'manufacturer_country',d.manufacturer_country,
          'classification_code',d.classification_code,'risk_class',d.risk_class,
          'icon_url',d.icon_url,'sterile',d.sterile,'single_use',d.single_use,'implantable',d.implantable
        ) AS device
      FROM public.stock_items si JOIN public.devices d ON d.id = si.device_id
      WHERE si.device_id = ANY(p_device_ids)
      ORDER BY si.updated_at DESC LIMIT v_limit OFFSET COALESCE(p_offset,0)
    ) t;
  ELSE
    SELECT jsonb_agg(row_to_json(t)) INTO v_items FROM (
      SELECT si.id, si.device_id, si.quantity, si.quantity_reserved,
        si.min_quantity, si.location, si.notes, si.fase, si.created_at, si.updated_at,
        jsonb_build_object('id',d.id,'udi_di',d.udi_di,'reference',d.reference,'model',d.model,
          'brand_name',d.brand_name,'internal_code',d.internal_code,
          'anvisa_registration',d.anvisa_registration,'manufacturer_country',d.manufacturer_country,
          'classification_code',d.classification_code,'risk_class',d.risk_class,
          'icon_url',d.icon_url,'sterile',d.sterile,'single_use',d.single_use,'implantable',d.implantable
        ) AS device
      FROM public.stock_items si JOIN public.devices d ON d.id = si.device_id
      ORDER BY si.updated_at DESC LIMIT v_limit OFFSET COALESCE(p_offset,0)
    ) t;
  END IF;

  -- 3. reserved_map
  SELECT jsonb_object_agg(agg.stock_item_id::text, agg.total_reservado) INTO v_reserved_map
  FROM (
    SELECT pi.stock_item_id, SUM(pi.quantidade) AS total_reservado
    FROM public.pedido_itens pi JOIN public.pedidos_comerciais pc ON pc.id = pi.pedido_id
    WHERE pc.status IN ('pendente','separando')
      AND pi.stock_item_id IN (
        SELECT (elem->>'id')::uuid FROM jsonb_array_elements(COALESCE(v_items,'[]'::jsonb)) elem
        WHERE elem->>'fase' = 'expedicao'
      )
    GROUP BY pi.stock_item_id
  ) agg;

  -- 4. lote_map
  WITH lotes_com_saldo AS (
    SELECT sm.stock_item_id AS item_id, upper(trim(sm.lote)) AS lote_key,
      SUM(CASE WHEN sm.type='entrada' THEN sm.quantity ELSE -sm.quantity END) AS saldo
    FROM public.stock_movements sm
    WHERE sm.stock_item_id IN (
        SELECT (elem->>'id')::uuid FROM jsonb_array_elements(COALESCE(v_items,'[]'::jsonb)) elem
      )
      AND sm.lote IS NOT NULL
      AND lower(trim(sm.lote)) NOT IN ('a-definir','a definir','sem lote')
      AND (sm.reason IS NULL OR sm.reason NOT IN (
        'Recebido de Intermediário','Retrabalho concluído — recebido do Retrabalho',
        'Rollback — falha ao criar item de retrabalho','Rollback — falha ao criar item de expedição',
        'Rollback — falha ao registrar entrada na expedição'))
    GROUP BY sm.stock_item_id, upper(trim(sm.lote))
    HAVING SUM(CASE WHEN sm.type='entrada' THEN sm.quantity ELSE -sm.quantity END) > 0
  ),
  lote_counts AS (SELECT item_id, COUNT(*) AS lote_count FROM lotes_com_saldo GROUP BY item_id)
  SELECT jsonb_object_agg(item_id::text, lote_count) INTO v_lote_map FROM lote_counts;

  -- 5. Totais por fase (para exibir total real independente da paginação)
  SELECT jsonb_build_object(
    'intermediaria', COALESCE(SUM(quantity) FILTER (WHERE fase = 'intermediaria'), 0)::bigint,
    'expedicao',     COALESCE(SUM(quantity) FILTER (WHERE fase = 'expedicao'), 0)::bigint,
    'retrabalho',    COALESCE(SUM(quantity) FILTER (WHERE fase = 'retrabalho'), 0)::bigint
  ) INTO v_qty_by_fase FROM public.stock_items;

  RETURN jsonb_build_object(
    'total_count',  v_total,
    'items',        COALESCE(v_items,        '[]'::jsonb),
    'reserved_map', COALESCE(v_reserved_map, '{}'::jsonb),
    'lote_map',     COALESCE(v_lote_map,     '{}'::jsonb),
    'qty_by_fase',  COALESCE(v_qty_by_fase,  '{}'::jsonb)
  );
END;
$f01$;

GRANT EXECUTE ON FUNCTION public.load_stock_page(text, integer, integer, uuid[]) TO authenticated;
