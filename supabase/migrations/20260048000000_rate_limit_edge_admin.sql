-- =============================================================================
-- RATE LIMIT PERSISTENTE PARA EDGE FUNCTIONS ADMINISTRATIVAS
-- =============================================================================
-- admin-create-user, admin-reset-password e delete-account usavam um Map em
-- memória dentro da própria Edge Function. Isso não é confiável sob múltiplas
-- instâncias/cold starts. Esta migration estende check_rate_limit (já usada
-- pelas RPCs de estoque/pedidos) com as ações dessas 3 funções, mantendo os
-- mesmos limites já configurados no código:
--   admin_create_user   : 10 req / 60s   (por IP)
--   admin_reset_password: 10 req / 3600s (por IP)
--   delete_account       : 3  req / 86400s (por IP)
--
-- Diferente das demais ações (que usam auth.uid()), estas continuam por IP,
-- pois o limite existe justamente para conter abuso ANTES/independente de
-- uma sessão de admin específica ser validada repetidamente.
--
-- FIX: esta migration reescreve check_rate_limit() por completo (CREATE OR
-- REPLACE substitui a função inteira, não só o CASE) — a versão anterior
-- desta migration tinha perdido, por engano, várias ações já configuradas em
-- 20260044000000_seguranca_revisao_final.sql (remove_pedido_item,
-- enviar_feedback, registrar_devolucao_troca, as duas de análise de
-- devolução/troca e consumir_credito_cliente), fazendo elas caírem no limite
-- genérico do ELSE. A lista abaixo foi restaurada por completo e já inclui
-- também as ações do módulo de Não Conformidade.

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_action text,
  p_user_id uuid DEFAULT auth.uid()
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f02$
DECLARE
  v_count   integer;
  v_max     integer;
  v_window  integer; -- seconds
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;

  CASE p_action
    WHEN 'stock_movement_atomic'  THEN v_max := 60;  v_window := 60;
    WHEN 'reserve_stock'          THEN v_max := 20;  v_window := 60;
    WHEN 'cancel_pedido'          THEN v_max := 10;  v_window := 60;
    WHEN 'remove_pedido_item'     THEN v_max := 20;  v_window := 60;
    WHEN 'faturar_pedido_sefaz'   THEN v_max := 5;   v_window := 60;
    WHEN 'marcar_pedido_pronto'   THEN v_max := 30;  v_window := 60;
    WHEN 'import_devices'         THEN v_max := 3;   v_window := 300;
    WHEN 'enviar_feedback'                       THEN v_max := 5;   v_window := 3600;
    WHEN 'registrar_devolucao_troca'             THEN v_max := 5;   v_window := 60;
    WHEN 'iniciar_analise_qualidade_devolucao'   THEN v_max := 15;  v_window := 60;
    WHEN 'finalizar_analise_qualidade_devolucao' THEN v_max := 15;  v_window := 60;
    WHEN 'consumir_credito_cliente'              THEN v_max := 10;  v_window := 60;
    WHEN 'abrir_nao_conformidade'                THEN v_max := 20;  v_window := 3600;
    WHEN 'decidir_nao_conformidade'              THEN v_max := 30;  v_window := 60;
    WHEN 'encerrar_nao_conformidade'             THEN v_max := 30;  v_window := 60;
    WHEN 'admin_create_user'      THEN v_max := 10;  v_window := 60;
    WHEN 'admin_reset_password'   THEN v_max := 10;  v_window := 3600;
    WHEN 'delete_account'         THEN v_max := 3;   v_window := 86400;
    ELSE                               v_max := 100; v_window := 60;
  END CASE;

  SELECT COUNT(*) INTO v_count
  FROM public.rate_limit_log
  WHERE user_id = p_user_id
    AND action  = p_action
    AND created_at > now() - (v_window || ' seconds')::interval;

  IF v_count >= v_max THEN RETURN false; END IF;

  INSERT INTO public.rate_limit_log (user_id, action) VALUES (p_user_id, p_action);
  RETURN true;
END; $f02$;

GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, uuid) TO authenticated;
-- service_role: chamado diretamente (via RPC) pelas Edge Functions
-- administrativas (admin-create-user, admin-reset-password, delete-account),
-- que usam o client com a service role key e ainda não têm user_id de
-- sessão confiável no momento do throttle (chave sintética por IP).
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ip_rate_limit_key(text) TO service_role;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.ip_rate_limit_key(text) FROM anon;

-- ── Identidade sintética por IP ────────────────────────────────────────────
-- rate_limit_log.user_id referencia auth.users (FK). Para chaves de rate
-- limit por IP (chamadas ainda não autenticadas ou que não devem depender de
-- uma sessão específica), usamos um UUID determinístico derivado do IP via
-- md5 (pgcrypto já está habilitado no projeto — evita depender de uuid-ossp).
-- Não é um usuário real, só uma chave estável para agrupar tentativas.
CREATE OR REPLACE FUNCTION public.ip_rate_limit_key(p_ip text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $f03$
  SELECT (
    substr(v.h, 1, 8) || '-' || substr(v.h, 9, 4) || '-' || substr(v.h, 13, 4) || '-' ||
    substr(v.h, 17, 4) || '-' || substr(v.h, 21, 12)
  )::uuid
  FROM (SELECT md5(coalesce(p_ip, 'unknown')) AS h) v;
$f03$;

-- rate_limit_log.user_id tem FK para auth.users — chaves sintéticas por IP
-- não existem lá. Relaxamos a FK para permitir também essas chaves.
ALTER TABLE public.rate_limit_log DROP CONSTRAINT IF EXISTS rate_limit_log_user_id_fkey;

COMMENT ON FUNCTION public.ip_rate_limit_key(text) IS
  'Gera uma chave UUID estável a partir de um IP para uso em check_rate_limit, quando não há user_id de sessão confiável (ex.: throttle de Edge Functions administrativas por IP).';
