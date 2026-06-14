-- =============================================================================
-- BANCO-03 + PERF: Índices adicionais para performance
-- =============================================================================

-- ── financeiro_lancamentos: extrato por período (coluna real: data_lancamento) ─
CREATE INDEX IF NOT EXISTS idx_financeiro_lanc_data_created
  ON public.financeiro_lancamentos (data_lancamento DESC, created_by)
  WHERE data_lancamento IS NOT NULL;

-- ── financeiro_lancamentos: tipo + conta (relatórios de DRE) ─────────────────
CREATE INDEX IF NOT EXISTS idx_financeiro_lanc_tipo
  ON public.financeiro_lancamentos (tipo, data_lancamento DESC);

-- ── stock_movements: histórico por item ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_created
  ON public.stock_movements (stock_item_id, created_at DESC);

-- ── stock_items: busca por device ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_stock_items_device_id
  ON public.stock_items (device_id, fase, quantity)
  WHERE quantity > 0;

-- ── audit_log: busca por entidade (ex: todos os logs de um pedido) ────────────
CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON public.audit_log (entity_type, entity_id, created_at DESC)
  WHERE entity_id IS NOT NULL;
