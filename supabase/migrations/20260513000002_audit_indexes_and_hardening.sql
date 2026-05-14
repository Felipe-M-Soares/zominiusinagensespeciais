-- =============================================================================
-- AUDITORIA 2026-05-13: Índices adicionais e hardening de RLS
-- Identificado na auditoria completa de 13/05/2026
-- =============================================================================

-- ── PERF: Índices adicionais para queries frequentes ─────────────────────────

-- profiles: busca por login (usado em admin-create-user e autenticação)
CREATE INDEX IF NOT EXISTS idx_profiles_login
  ON public.profiles (login)
  WHERE login IS NOT NULL;

-- profiles: busca por approved + blocked (usado em auth check)
CREATE INDEX IF NOT EXISTS idx_profiles_approved_blocked
  ON public.profiles (approved, blocked)
  WHERE approved = false OR blocked = true;

-- stock_movements: busca por stock_item_id (join frequente)
CREATE INDEX IF NOT EXISTS idx_stock_movements_stock_item_id
  ON public.stock_movements (stock_item_id, created_at DESC);

-- pedido_itens: busca por pedido_id (join frequente em faturamento)
CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido_id
  ON public.pedido_itens (pedido_id);

-- pedidos_comerciais: busca por status (filtro mais comum na UI)
CREATE INDEX IF NOT EXISTS idx_pedidos_comerciais_status
  ON public.pedidos_comerciais (status, created_at DESC)
  WHERE status IS NOT NULL;

-- pedidos_comerciais: busca por cliente_id (histórico por cliente)
CREATE INDEX IF NOT EXISTS idx_pedidos_comerciais_cliente_id
  ON public.pedidos_comerciais (cliente_id, created_at DESC);

-- recebimento_materiais: busca por created_at (listagem cronológica)
CREATE INDEX IF NOT EXISTS idx_recebimento_materiais_created_at
  ON public.recebimento_materiais (created_at DESC);

-- ── SEG: Garantir que clientes só são visíveis para usuários aprovados ────────
-- (proteção adicional — já coberto por RLS geral, mas explícito é melhor)

-- Verificar e forçar RLS na tabela clientes se ainda não estiver ativo
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

-- ── ANALYZE: Atualiza estatísticas para o planner usar os novos índices ───────
ANALYZE public.profiles;
ANALYZE public.stock_movements;
ANALYZE public.pedido_itens;
ANALYZE public.pedidos_comerciais;
ANALYZE public.clientes;
