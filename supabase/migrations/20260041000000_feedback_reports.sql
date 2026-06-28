-- =============================================================================
-- FEEDBACK / REPORT DE PROBLEMAS — usuário envia, só admin lê
-- =============================================================================
-- Como em outras correções, esta vai em arquivo novo (timestamp maior) em
-- vez de editar um arquivo já aplicado — ver nota em
-- 20260040000000_correcoes_pendentes.sql sobre por que isso é necessário.

CREATE TABLE IF NOT EXISTS public.feedback_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name   text,
  tipo        text NOT NULL CHECK (tipo IN ('bug','sugestao','outro')),
  mensagem    text NOT NULL CHECK (char_length(mensagem) BETWEEN 5 AND 4000),
  pagina      text,                  -- rota onde o usuário estava (ex: /comercial) — só contexto, não é PII
  app_version text,                  -- versão do app no momento do envio, para triagem
  status      text NOT NULL DEFAULT 'novo' CHECK (status IN ('novo','em_analise','resolvido','arquivado')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feedback_reports ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_feedback_reports_status_created
  ON public.feedback_reports (status, created_at DESC);

-- RLS: qualquer autenticado pode INSERIR o próprio (sem poder se passar por
-- outro usuário — user_id é travado para auth.uid() via RPC abaixo, não
-- diretamente pela tabela, para também poder aplicar rate limit).
-- Apenas admin pode LER ou ATUALIZAR status (ex: marcar como resolvido).
-- Ningém pode DELETAR via API (somente o painel do Supabase, se necessário).
DROP POLICY IF EXISTS "feedback_reports_select_admin" ON public.feedback_reports;
CREATE POLICY "feedback_reports_select_admin" ON public.feedback_reports
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "feedback_reports_update_admin" ON public.feedback_reports;
CREATE POLICY "feedback_reports_update_admin" ON public.feedback_reports
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Nenhuma policy de INSERT direto na tabela — toda escrita passa pela RPC
-- enviar_feedback() abaixo, que valida, aplica rate limit, e fixa o
-- user_id/user_name no servidor (o cliente nunca escolhe esses valores).

-- Atualiza o CASE de check_rate_limit (CREATE OR REPLACE substitui a função
-- já existente no banco; mesma assinatura, só adiciona uma entrada nova ao
-- CASE — nenhum limite existente é alterado).
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_action text,
  p_user_id uuid DEFAULT auth.uid()
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f01$
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
    WHEN 'faturar_pedido_sefaz'   THEN v_max := 5;   v_window := 60;
    WHEN 'marcar_pedido_pronto'   THEN v_max := 30;  v_window := 60;
    WHEN 'import_devices'         THEN v_max := 3;   v_window := 300;
    WHEN 'enviar_feedback'        THEN v_max := 5;   v_window := 3600; -- 5 por hora
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
END;
$f01$;

GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, uuid) TO authenticated;

-- RPC de envio: única forma de gravar em feedback_reports. Sanitiza o
-- tamanho da mensagem (defesa extra além do CHECK), aplica rate limit, e
-- preenche user_id/user_name a partir da sessão autenticada — nunca do que
-- o cliente envia, evitando que alguém grave feedback em nome de outro
-- usuário.
CREATE OR REPLACE FUNCTION public.enviar_feedback(
  p_tipo text,
  p_mensagem text,
  p_pagina text DEFAULT NULL,
  p_app_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f02$
DECLARE
  v_user_name text;
  v_msg text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado.');
  END IF;

  IF NOT public.check_rate_limit('enviar_feedback') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Muitos envios recentes. Tente novamente em alguns minutos.');
  END IF;

  IF p_tipo NOT IN ('bug','sugestao','outro') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Tipo inválido.');
  END IF;

  v_msg := trim(coalesce(p_mensagem, ''));
  IF char_length(v_msg) < 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Mensagem muito curta.');
  END IF;
  v_msg := left(v_msg, 4000);

  SELECT display_name INTO v_user_name FROM public.profiles WHERE user_id = auth.uid();

  INSERT INTO public.feedback_reports (user_id, user_name, tipo, mensagem, pagina, app_version)
  VALUES (
    auth.uid(),
    coalesce(v_user_name, 'Desconhecido'),
    p_tipo,
    v_msg,
    left(coalesce(p_pagina, ''), 200),
    left(coalesce(p_app_version, ''), 50)
  );

  RETURN jsonb_build_object('ok', true);
END;
$f02$;

GRANT EXECUTE ON FUNCTION public.enviar_feedback(text, text, text, text) TO authenticated;

-- RPC de listagem para o admin — evita SELECT * direto, mantém um único
-- ponto de leitura auditável. RLS já restringe a admin, mas a RPC reforça
-- a checagem explicitamente (defesa em profundidade).
CREATE OR REPLACE FUNCTION public.listar_feedback_reports(p_status text DEFAULT NULL)
RETURNS SETOF public.feedback_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f03$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Acesso não autorizado.';
  END IF;

  RETURN QUERY
    SELECT * FROM public.feedback_reports
    WHERE p_status IS NULL OR status = p_status
    ORDER BY created_at DESC;
END;
$f03$;

GRANT EXECUTE ON FUNCTION public.listar_feedback_reports(text) TO authenticated;

-- RPC para o admin atualizar o status de um report (resolvido/arquivado/etc)
CREATE OR REPLACE FUNCTION public.atualizar_status_feedback(p_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f04$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso não autorizado.');
  END IF;

  IF p_status NOT IN ('novo','em_analise','resolvido','arquivado') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Status inválido.');
  END IF;

  UPDATE public.feedback_reports SET status = p_status WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
END;
$f04$;

GRANT EXECUTE ON FUNCTION public.atualizar_status_feedback(uuid, text) TO authenticated;

COMMENT ON TABLE public.feedback_reports IS
  'Relatos de bug/sugestão enviados pelos usuários. Escrita somente via enviar_feedback() (nunca INSERT direto). Leitura restrita a admin.';
