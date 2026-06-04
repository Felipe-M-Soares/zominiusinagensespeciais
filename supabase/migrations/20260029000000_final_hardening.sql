-- =============================================================================
-- 029: Hardening final — índices, grants e limpeza
-- =============================================================================

-- ── Índices adicionais para queries frequentes ────────────────────────────────

-- profiles: busca por login (case-insensitive) — usado no login
CREATE INDEX IF NOT EXISTS idx_profiles_login_lower
  ON public.profiles (lower(login))
  WHERE login IS NOT NULL;

-- profiles: aprovação + bloqueio (verificado no login e no realtime)
CREATE INDEX IF NOT EXISTS idx_profiles_approved_blocked
  ON public.profiles (user_id, approved, blocked);

-- stock_items: fase + quantity (usado em contagens por fase)
CREATE INDEX IF NOT EXISTS idx_stock_items_fase_qty
  ON public.stock_items (fase, quantity)
  WHERE quantity > 0;

-- pedidos_comerciais: status + created_at (listagem por status)
CREATE INDEX IF NOT EXISTS idx_pedidos_status_created
  ON public.pedidos_comerciais (status, created_at DESC);

-- audit_log: limpeza de registros antigos (>90 dias) via índice
CREATE INDEX IF NOT EXISTS idx_audit_log_cleanup
  ON public.audit_log (created_at)
  WHERE created_at < now() - INTERVAL '90 days';

-- ── GRANTs faltantes em funções ───────────────────────────────────────────────

-- Funções que podem estar sem GRANT após reordenação de migrations
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_user()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved_user()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_role()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_password(uuid,text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_stock_items_from_devices()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lotes_intermediario()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clear_history()                  TO authenticated;

-- Revogar acesso anon em funções admin (defense in depth)
REVOKE ALL ON FUNCTION public.admin_create_user(text,text,text,text)    FROM anon;
REVOKE ALL ON FUNCTION public.admin_reset_password(uuid,text)           FROM anon;
REVOKE ALL ON FUNCTION public.admin_delete_user(uuid)                   FROM anon;
REVOKE ALL ON FUNCTION public.admin_clear_history()                     FROM anon;

-- ── Limpeza automática de audit_log antigo ────────────────────────────────────
-- Remove registros com mais de 90 dias para evitar crescimento ilimitado
CREATE OR REPLACE FUNCTION public.cleanup_audit_log()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $f01$
  DELETE FROM public.audit_log
  WHERE created_at < now() - INTERVAL '90 days';
$f01$;

GRANT EXECUTE ON FUNCTION public.cleanup_audit_log() TO authenticated;

-- ── Trigger de limpeza automática do audit_log ────────────────────────────────
DROP TRIGGER IF EXISTS trg_cleanup_audit_log ON public.audit_log;
CREATE TRIGGER trg_cleanup_audit_log
  AFTER INSERT ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.cleanup_audit_log();

-- ── Comentários de documentação nas tabelas principais ───────────────────────
COMMENT ON TABLE public.profiles    IS 'Perfis de usuário: aprovação, bloqueio, login interno';
COMMENT ON TABLE public.user_roles  IS 'Roles do sistema: admin, estoque, qualidade, comercial, financeiro, producao';
COMMENT ON TABLE public.devices     IS 'Catálogo de dispositivos médicos com conformidade ANVISA';
COMMENT ON TABLE public.stock_items IS 'Estoque por fase: intermediaria, expedicao, retrabalho';
COMMENT ON TABLE public.stock_movements IS 'Histórico de movimentações de estoque com lotes';
COMMENT ON TABLE public.pedidos_comerciais IS 'Pedidos comerciais com NF-e SEFAZ';
COMMENT ON TABLE public.audit_log   IS 'Log de auditoria de ações críticas (retido 90 dias)';
COMMENT ON TABLE public.rate_limit_log IS 'Rate limiting de operações críticas (sliding window)';
