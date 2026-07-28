-- =============================================================================
-- SEGURANÇA — Revisão final pós-auditoria
-- =============================================================================
-- Corrige funções SECURITY DEFINER antigas que ainda não tinham search_path fixo
-- e reduz exposição para anon. Não altera fluxo do app.

ALTER FUNCTION public.resolve_ncm_device_by_id(uuid) SET search_path = public;
ALTER FUNCTION public.get_total_stock_quantity() SET search_path = public;
ALTER FUNCTION public.get_devices_regularizacao_counts() SET search_path = public;

REVOKE ALL ON FUNCTION public.resolve_ncm_device_by_id(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_total_stock_quantity() FROM anon;
REVOKE ALL ON FUNCTION public.get_devices_regularizacao_counts() FROM anon;

GRANT EXECUTE ON FUNCTION public.resolve_ncm_device_by_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_total_stock_quantity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_devices_regularizacao_counts() TO authenticated;

-- =============================================================================
-- DEVOLUÇÃO / TROCA — RPCs de emissão/cancelamento
-- =============================================================================
-- A tabela notas_devolucao_troca foi criada em 20260012000000_financeiro.sql
-- (mesma migration onde o restante do recurso de devolução/troca vive). As
-- RPCs abaixo ficam aqui, e não lá, porque dependem de audit_log (criada em
-- 20260027000000_estoque.sql) e de check_rate_limit/rate_limit_log (criadas
-- em 20260029000000_seguranca.sql) — ambas posteriores ao arquivo financeiro.
-- Colocar essas duas funções em 20260012 quebraria uma instalação nova do
-- zero (a função falharia ao ser criada, pois as tabelas que ela referencia
-- ainda não existiriam nesse ponto da sequência de migrations).

-- ── Atualiza check_rate_limit com mais uma entrada (mesmo padrão já usado
-- em 20260029/20260041: CREATE OR REPLACE reafirma todas as entradas
-- anteriores e soma a nova, sem alterar nenhum limite existente) ────────────
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_action text,
  p_user_id uuid DEFAULT auth.uid()
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f10$
DECLARE
  v_count   integer;
  v_max     integer;
  v_window  integer; -- seconds
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;

  CASE p_action
    WHEN 'stock_movement_atomic'      THEN v_max := 60;  v_window := 60;
    WHEN 'reserve_stock'              THEN v_max := 20;  v_window := 60;
    WHEN 'cancel_pedido'              THEN v_max := 10;  v_window := 60;
    WHEN 'faturar_pedido_sefaz'       THEN v_max := 5;   v_window := 60;
    WHEN 'marcar_pedido_pronto'       THEN v_max := 30;  v_window := 60;
    WHEN 'import_devices'             THEN v_max := 3;   v_window := 300;
    WHEN 'enviar_feedback'            THEN v_max := 5;   v_window := 3600;
    WHEN 'registrar_devolucao_troca'  THEN v_max := 5;   v_window := 60;
    WHEN 'iniciar_analise_qualidade_devolucao'   THEN v_max := 15;  v_window := 60;
    WHEN 'finalizar_analise_qualidade_devolucao' THEN v_max := 15;  v_window := 60;
    ELSE                                    v_max := 100; v_window := 60;
  END CASE;

  SELECT COUNT(*) INTO v_count
  FROM public.rate_limit_log
  WHERE user_id = p_user_id
    AND action  = p_action
    AND created_at > now() - (v_window || ' seconds')::interval;

  IF v_count >= v_max THEN RETURN false; END IF;

  INSERT INTO public.rate_limit_log (user_id, action) VALUES (p_user_id, p_action);
  RETURN true;
END; $f10$;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, uuid) TO authenticated;

-- ── RPC: registra o resultado (autorizada/rejeitada) da emissão ──────────────
CREATE OR REPLACE FUNCTION public.registrar_devolucao_troca(
  p_id              uuid,
  p_status          text,          -- 'autorizada' | 'rejeitada'
  p_status_msg      text,
  p_chave_acesso    text,
  p_protocolo       text,
  p_dh_autorizacao  timestamptz,
  p_xml_nfe         text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f11$
DECLARE
  v_role     text;
  v_uid      uuid := auth.uid();
  v_name     text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;

  SELECT role INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  IF v_role NOT IN ('admin','financeiro') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão: requer role admin ou financeiro');
  END IF;

  IF p_status NOT IN ('autorizada','rejeitada') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Status inválido');
  END IF;

  IF NOT public.check_rate_limit('registrar_devolucao_troca') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Muitas requisições. Aguarde 1 minuto.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.notas_devolucao_troca WHERE id = p_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Registro não encontrado');
  END IF;

  SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid;

  UPDATE public.notas_devolucao_troca SET
    status = p_status, status_msg = p_status_msg,
    chave_acesso = COALESCE(p_chave_acesso, chave_acesso),
    protocolo_sefaz = COALESCE(p_protocolo, protocolo_sefaz),
    dh_autorizacao = COALESCE(p_dh_autorizacao, dh_autorizacao),
    xml_nfe = COALESCE(p_xml_nfe, xml_nfe)
  WHERE id = p_id;

  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (v_uid, COALESCE(v_name, 'Desconhecido'),
    CASE WHEN p_status = 'autorizada' THEN 'emitir_nf_devolucao_troca' ELSE 'rejeitar_nf_devolucao_troca' END,
    'nota_devolucao_troca', p_id,
    jsonb_build_object('protocolo', p_protocolo, 'chave_acesso', p_chave_acesso));

  RETURN jsonb_build_object('ok', true);
END; $f11$;
GRANT EXECUTE ON FUNCTION public.registrar_devolucao_troca(uuid,text,text,text,text,timestamptz,text) TO authenticated;

-- ── RPC: cancelamento local do registro (não transmite evento de cancelamento
-- ao SEFAZ — mesma limitação que o restante do sistema hoje tem para NF-e de
-- venda) ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancelar_devolucao_troca(p_id uuid, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f12$
DECLARE
  v_role text;
  v_uid  uuid := auth.uid();
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  IF v_role NOT IN ('admin','financeiro') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão: requer role admin ou financeiro');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notas_devolucao_troca WHERE id = p_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Registro não encontrado');
  END IF;

  SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid;

  UPDATE public.notas_devolucao_troca
  SET status = 'cancelada', status_msg = COALESCE(p_motivo, status_msg)
  WHERE id = p_id;

  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (v_uid, COALESCE(v_name, 'Desconhecido'), 'cancelar_nf_devolucao_troca', 'nota_devolucao_troca', p_id,
    jsonb_build_object('motivo', p_motivo));

  RETURN jsonb_build_object('ok', true);
END; $f12$;
GRANT EXECUTE ON FUNCTION public.cancelar_devolucao_troca(uuid,text) TO authenticated;

-- =============================================================================
-- QUALIDADE — Análise de devolução/troca (integração Financeiro × Estoque × Qualidade)
-- =============================================================================
-- Fluxo real da empresa: a mercadoria sempre volta acompanhada da NF de venda
-- original. Quem recebe e analisa fisicamente o lote é a Qualidade — só ela
-- decide se o caso é devolução ou troca. As duas RPCs abaixo formalizam isso:
--
--  1. iniciar_analise_qualidade_devolucao — Qualidade registra a chegada física
--     do retorno (vinculado ao pedido/NF original). Cria o rascunho da nota de
--     devolução/troca (mesma tabela notas_devolucao_troca do Financeiro — não
--     duplica nada) com tipo ainda provisório, e dá ENTRADA das peças na fase
--     'retrabalho' do estoque (fila já existente, mesma usada pelo módulo
--     Estoque), com o MESMO LOTE de venda, referenciando a nota no motivo do
--     movimento — preserva rastreabilidade.
--     TRAVA: se já existir uma análise em aberto para o mesmo pedido, recusa
--     criar outra — isso é o que impede a nota original de ser mexida por
--     duas ações ao mesmo tempo.
--
--  2. finalizar_analise_qualidade_devolucao — Qualidade conclui a análise e
--     ALTERA a mesma nota já criada (não cria uma nova): define o tipo real
--     (devolução/troca) ou reprova o caso, grava o laudo, e:
--       • Devolução aprovada → peças saem do retrabalho e entram de volta na
--         expedição (estoque vendável), mesmo lote, e a Qualidade que já
--         estava dando baixa é convertida num crédito ("saldo") para o
--         cliente em contas_financeiras (visível à vendedora, pois a leitura
--         de contas_financeiras já é liberada a qualquer autenticado).
--       • Troca aprovada → a peça devolvida fica retida no retrabalho
--         (decisão de reaproveitamento fica para depois, via o fluxo que já
--         existe em Estoque > Concluir Retrabalho); o Financeiro emite a NF
--         de troca (entrada + saída) a partir do que a Qualidade decidiu.
--       • Reprovado → a nota é cancelada (não gera crédito nem devolve ao
--         estoque vendável); a peça permanece retida no retrabalho para
--         decisão manual do Estoque.
--     Depois de finalizada, a trava é liberada: o Financeiro pode emitir a
--     NF-e (via a mesma tela de Devolução/Troca, botão "Emitir" no registro
--     já existente) usando exatamente os dados que a Qualidade decidiu.

DROP FUNCTION IF EXISTS public.iniciar_analise_qualidade_devolucao(uuid, jsonb, text);
CREATE OR REPLACE FUNCTION public.iniciar_analise_qualidade_devolucao(
  p_pedido_id   uuid,
  p_itens       jsonb,   -- entrada do cliente: só stock_item_id e quantidade são usados como
                         -- "pedido"; todo o resto (descrição, NCM, CFOP, valor, device, lote)
                         -- é sempre resolvido a partir do próprio banco abaixo — nunca confiamos
                         -- em texto/valor vindo do cliente para montar a nota ou o crédito.
  p_observacao  text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f13$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_name text;
  v_pedido RECORD;
  v_cliente RECORD;
  v_item jsonb;
  v_stock_item_id uuid;
  v_lote text;
  v_device uuid;
  v_descricao text;
  v_ncm text;
  v_cfop text;
  v_valor_unit numeric;
  v_pi_qtd numeric;
  v_ja_devolvido numeric;
  v_disponivel numeric;
  v_qtd_final integer;
  v_retrab_id uuid;
  v_valor_total numeric(14,2) := 0;
  v_note_id uuid;
  v_itens_validados jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;

  SELECT role INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  IF v_role NOT IN ('admin','qualidade') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão: requer role admin ou qualidade');
  END IF;

  IF NOT public.check_rate_limit('iniciar_analise_qualidade_devolucao') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Muitas requisições. Aguarde 1 minuto.');
  END IF;

  IF jsonb_array_length(COALESCE(p_itens,'[]'::jsonb)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe ao menos um item recebido');
  END IF;

  SELECT id, cliente_id, nota_fiscal, chave_acesso_nfe INTO v_pedido
  FROM public.pedidos_comerciais WHERE id = p_pedido_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Pedido não encontrado'); END IF;

  -- TRAVA: não deixa abrir uma segunda análise enquanto a primeira não terminar
  IF EXISTS (
    SELECT 1 FROM public.notas_devolucao_troca
    WHERE pedido_id = p_pedido_id AND status_msg LIKE '[QUALIDADE:em_analise]%'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'Já existe uma devolução/troca em análise pela Qualidade para este pedido. Finalize-a antes de abrir outra.');
  END IF;

  SELECT nome, documento, ie, telefone, email,
         COALESCE(NULLIF(trim(logradouro||COALESCE(', '||numero,'')||COALESCE(' — '||bairro,'')||COALESCE(' — '||municipio,'')||COALESCE('/'||uf,'')),''), endereco) AS endereco
  INTO v_cliente FROM public.clientes WHERE id = v_pedido.cliente_id;

  -- ── Valida e reconstrói cada item a partir do banco (nunca do cliente) ─────
  -- Impede que um item forjado (device/lote/valor/qtde inventados) vire
  -- estoque ou crédito financeiro: cada stock_item_id precisa realmente
  -- pertencer a este pedido, e a quantidade é sempre limitada ao que foi
  -- vendido menos o que já foi reivindicado em devoluções/trocas anteriores
  -- (não canceladas) do mesmo pedido — não é possível devolver mais do que
  -- foi vendido, nem duas vezes a mesma peça.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_stock_item_id := NULLIF(v_item->>'stock_item_id','')::uuid;
    IF v_stock_item_id IS NULL THEN CONTINUE; END IF;

    SELECT COALESCE(SUM(pi.quantidade),0), MAX(pi.valor_unitario), MAX(pi.lote),
           MAX(si.device_id), MAX(d.model), MAX(d.ncm), MAX(d.cfop_padrao)
    INTO v_pi_qtd, v_valor_unit, v_lote, v_device, v_descricao, v_ncm, v_cfop
    FROM public.pedido_itens pi
    JOIN public.stock_items si ON si.id = pi.stock_item_id
    JOIN public.devices d ON d.id = si.device_id
    WHERE pi.pedido_id = p_pedido_id AND pi.stock_item_id = v_stock_item_id;

    IF v_pi_qtd IS NULL OR v_pi_qtd <= 0 THEN CONTINUE; END IF; -- item não pertence a este pedido
    IF v_device IS NULL OR COALESCE(trim(v_lote),'') = '' THEN CONTINUE; END IF; -- sem lote não dá pra rastrear

    SELECT COALESCE(SUM((it->>'quantidade')::numeric),0) INTO v_ja_devolvido
    FROM public.notas_devolucao_troca ndt, jsonb_array_elements(ndt.itens) it
    WHERE ndt.pedido_id = p_pedido_id
      AND (it->>'stock_item_id') = v_stock_item_id::text
      AND ndt.status <> 'cancelada';

    v_disponivel := v_pi_qtd - v_ja_devolvido;
    IF v_disponivel <= 0 THEN CONTINUE; END IF;

    v_qtd_final := LEAST(GREATEST(COALESCE((v_item->>'quantidade')::integer,0),0), v_disponivel::integer);
    IF v_qtd_final <= 0 THEN CONTINUE; END IF;

    v_itens_validados := v_itens_validados || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text,
      'descricao', v_descricao, 'ncm', COALESCE(v_ncm,'90213990'), 'cfop', COALESCE(v_cfop,'1202'),
      'quantidade', v_qtd_final, 'valorUnitario', trim(to_char(COALESCE(v_valor_unit,0), 'FM999999999.00')),
      'aliqICMS', '12.00', 'cst', '00',
      'device_id', v_device, 'lote', upper(trim(v_lote)), 'stock_item_id', v_stock_item_id
    ));
    v_valor_total := v_valor_total + (v_qtd_final * COALESCE(v_valor_unit,0));
  END LOOP;

  IF jsonb_array_length(v_itens_validados) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'Nenhum item válido: confira se os itens pertencem a este pedido e se ainda há quantidade disponível (pode já ter sido devolvida/trocada antes).');
  END IF;

  INSERT INTO public.notas_devolucao_troca (
    tipo, pedido_id, avulsa, cliente_nome, cliente_documento, cliente_ie, cliente_endereco,
    cliente_telefone, cliente_email, nf_original_numero, nf_original_chave,
    motivo, itens, valor_frete, valor_total, tipo_nota, tp_nf, serie,
    status, status_msg, modo_teste, created_by
  ) VALUES (
    'devolucao', p_pedido_id, false, v_cliente.nome, v_cliente.documento, v_cliente.ie, v_cliente.endereco,
    v_cliente.telefone, v_cliente.email, v_pedido.nota_fiscal, NULLIF(regexp_replace(COALESCE(v_pedido.chave_acesso_nfe,''),'\D','','g'),''),
    '(Aguardando análise da Qualidade)', v_itens_validados, 0, v_valor_total, 'nfe', '0', '2',
    'rascunho', '[QUALIDADE:em_analise] ' || COALESCE(p_observacao,''), true, v_uid
  ) RETURNING id INTO v_note_id;

  -- Entrada física das peças na fila de Retrabalho (mesmo lote da venda) —
  -- mesma fase/estrutura já usada por Estoque para peças em análise.
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_itens_validados) LOOP
    v_lote   := v_item->>'lote';
    v_device := (v_item->>'device_id')::uuid;
    v_qtd_final := (v_item->>'quantidade')::integer;

    SELECT id INTO v_retrab_id FROM public.stock_items
    WHERE device_id = v_device AND fase = 'retrabalho' AND notes ILIKE '%lote:'||v_lote||'%'
    LIMIT 1;

    IF v_retrab_id IS NULL THEN
      INSERT INTO public.stock_items (device_id, quantity, min_quantity, fase, notes)
      VALUES (v_device, 0, 0, 'retrabalho', 'lote:'||v_lote)
      RETURNING id INTO v_retrab_id;
    END IF;

    UPDATE public.stock_items SET quantity = quantity + v_qtd_final, updated_at = now() WHERE id = v_retrab_id;
    INSERT INTO public.stock_movements (stock_item_id, type, quantity, reason, lote, user_id, user_display_name)
    VALUES (v_retrab_id, 'entrada', v_qtd_final,
      'Devolução/Troca recebida — aguardando análise da Qualidade (NF '||COALESCE(v_pedido.nota_fiscal,'s/nº')||')',
      v_lote, v_uid, (SELECT display_name FROM public.profiles WHERE user_id = v_uid));
  END LOOP;

  SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid;
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (v_uid, COALESCE(v_name,'Desconhecido'), 'iniciar_analise_qualidade_devolucao', 'nota_devolucao_troca', v_note_id,
    jsonb_build_object('pedido_id', p_pedido_id));

  RETURN jsonb_build_object('ok', true, 'id', v_note_id);
END; $f13$;
GRANT EXECUTE ON FUNCTION public.iniciar_analise_qualidade_devolucao(uuid, jsonb, text) TO authenticated;

DROP FUNCTION IF EXISTS public.finalizar_analise_qualidade_devolucao(uuid, text, text, jsonb);
CREATE OR REPLACE FUNCTION public.finalizar_analise_qualidade_devolucao(
  p_id      uuid,
  p_decisao text,          -- 'devolucao' | 'troca' | 'reprovado'
  p_laudo   text,
  p_itens   jsonb DEFAULT NULL  -- opcional: reduz (nunca aumenta) as quantidades já
                                -- validadas por iniciar_analise_qualidade_devolucao
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f14$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_name text;
  v_nota RECORD;
  v_itens_final jsonb;
  v_item jsonb;
  v_item_original jsonb;
  v_stock_item_id uuid;
  v_qtd_solicitada integer;
  v_lote text;
  v_device uuid;
  v_qtd integer;
  v_retrab_id uuid;
  v_expedicao_id uuid;
  v_valor_total numeric(14,2) := 0;
  v_saldo_atual integer;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado'); END IF;

  SELECT role INTO v_role FROM public.user_roles WHERE user_id = v_uid LIMIT 1;
  IF v_role NOT IN ('admin','qualidade') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão: requer role admin ou qualidade');
  END IF;

  IF NOT public.check_rate_limit('finalizar_analise_qualidade_devolucao') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Muitas requisições. Aguarde 1 minuto.');
  END IF;

  IF p_decisao NOT IN ('devolucao','troca','reprovado') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Decisão inválida');
  END IF;

  -- Trava otimista: só finaliza se ainda estiver em análise (evita duas
  -- pessoas concluírem a mesma nota ao mesmo tempo, e evita reprocessar uma
  -- nota que já foi concluída)
  SELECT * INTO v_nota FROM public.notas_devolucao_troca WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Registro não encontrado'); END IF;
  IF v_nota.status_msg IS NULL OR v_nota.status_msg NOT LIKE '[QUALIDADE:em_analise]%' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esta análise já foi concluída (ou não foi iniciada pela Qualidade) — não é possível concluir novamente.');
  END IF;

  -- Nunca confia em item/preço/quantidade novo vindo do cliente aqui: se
  -- p_itens for informado, é só para REDUZIR (contagem física menor que o
  -- declarado) — cada item precisa já existir nos itens validados por
  -- iniciar_analise_qualidade_devolucao (mesmo stock_item_id), e a
  -- quantidade final nunca pode passar da quantidade já validada lá.
  IF p_itens IS NULL THEN
    v_itens_final := v_nota.itens;
  ELSE
    v_itens_final := '[]'::jsonb;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
      v_stock_item_id := NULLIF(v_item->>'stock_item_id','')::uuid;
      IF v_stock_item_id IS NULL THEN CONTINUE; END IF;

      v_item_original := NULL;
      SELECT orig INTO v_item_original
      FROM jsonb_array_elements(v_nota.itens) orig
      WHERE (orig->>'stock_item_id') = v_stock_item_id::text
      LIMIT 1;
      IF v_item_original IS NULL THEN CONTINUE; END IF; -- ignora item que não estava na análise original

      v_qtd_solicitada := LEAST(
        GREATEST(COALESCE((v_item->>'quantidade')::integer,0),0),
        COALESCE((v_item_original->>'quantidade')::integer,0)
      );
      IF v_qtd_solicitada <= 0 THEN CONTINUE; END IF;

      v_itens_final := v_itens_final || jsonb_build_array(jsonb_build_object(
        'id', v_item_original->>'id', 'descricao', v_item_original->>'descricao',
        'ncm', v_item_original->>'ncm', 'cfop', v_item_original->>'cfop',
        'quantidade', v_qtd_solicitada, 'valorUnitario', v_item_original->>'valorUnitario',
        'aliqICMS', v_item_original->>'aliqICMS', 'cst', v_item_original->>'cst',
        'device_id', v_item_original->>'device_id', 'lote', v_item_original->>'lote',
        'stock_item_id', v_item_original->>'stock_item_id'
      ));
    END LOOP;
    IF jsonb_array_length(v_itens_final) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Itens inválidos: devem corresponder aos itens já registrados nesta análise, com quantidade igual ou menor.');
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_itens_final) LOOP
    v_valor_total := v_valor_total + (COALESCE((v_item->>'quantidade')::numeric,0) * COALESCE((v_item->>'valorUnitario')::numeric,0));
  END LOOP;

  UPDATE public.notas_devolucao_troca SET
    tipo        = CASE WHEN p_decisao IN ('devolucao','troca') THEN p_decisao ELSE tipo END,
    itens       = v_itens_final,
    valor_total = v_valor_total,
    motivo      = COALESCE(p_laudo, motivo),
    status      = CASE WHEN p_decisao = 'reprovado' THEN 'cancelada' ELSE status END,
    status_msg  = '[QUALIDADE:' || (CASE WHEN p_decisao = 'reprovado' THEN 'reprovado' ELSE 'aprovado_'||p_decisao END) || '] ' || COALESCE(p_laudo,'')
  WHERE id = p_id;

  IF p_decisao = 'devolucao' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_itens_final) LOOP
      v_lote   := upper(trim(COALESCE(v_item->>'lote','')));
      v_device := NULLIF(v_item->>'device_id','')::uuid;
      v_qtd    := COALESCE((v_item->>'quantidade')::integer, 0);
      IF v_device IS NULL OR v_lote = '' OR v_qtd <= 0 THEN CONTINUE; END IF;

      SELECT id INTO v_retrab_id FROM public.stock_items
      WHERE device_id = v_device AND fase = 'retrabalho' AND notes ILIKE '%lote:'||v_lote||'%'
      LIMIT 1;
      IF v_retrab_id IS NULL THEN CONTINUE; END IF; -- nada a mover (não passou pela entrada inicial)

      SELECT quantity INTO v_saldo_atual FROM public.stock_items WHERE id = v_retrab_id FOR UPDATE;
      v_qtd := LEAST(v_qtd, GREATEST(v_saldo_atual,0));
      IF v_qtd <= 0 THEN CONTINUE; END IF;

      UPDATE public.stock_items SET quantity = quantity - v_qtd, updated_at = now() WHERE id = v_retrab_id;
      INSERT INTO public.stock_movements (stock_item_id, type, quantity, reason, lote, user_id, user_display_name)
      VALUES (v_retrab_id, 'saida', v_qtd,
        'Devolução aprovada pela Qualidade — retorna ao estoque (NF devolução '||COALESCE(v_nota.numero, left(p_id::text,8))||')',
        v_lote, v_uid, (SELECT display_name FROM public.profiles WHERE user_id = v_uid));

      SELECT id INTO v_expedicao_id FROM public.stock_items WHERE device_id = v_device AND fase = 'expedicao' LIMIT 1;
      IF v_expedicao_id IS NULL THEN
        INSERT INTO public.stock_items (device_id, quantity, min_quantity, fase)
        VALUES (v_device, 0, 0, 'expedicao') RETURNING id INTO v_expedicao_id;
      END IF;
      UPDATE public.stock_items SET quantity = quantity + v_qtd, updated_at = now() WHERE id = v_expedicao_id;
      INSERT INTO public.stock_movements (stock_item_id, type, quantity, reason, lote, user_id, user_display_name)
      VALUES (v_expedicao_id, 'entrada', v_qtd,
        'Devolução aprovada pela Qualidade — mesmo lote da venda (NF devolução '||COALESCE(v_nota.numero, left(p_id::text,8))||')',
        v_lote, v_uid, (SELECT display_name FROM public.profiles WHERE user_id = v_uid));
    END LOOP;

    -- Gera o saldo/crédito do cliente — visível à vendedora via contas_financeiras
    -- (contas_financeiras exige valor > 0; sem itens com valor, não há crédito a gerar)
    IF v_valor_total > 0 THEN
      INSERT INTO public.contas_financeiras (
        tipo, descricao, valor, data_emissao, data_vencimento, status, categoria,
        pedido_id, nota_fiscal, observacoes, created_by
      ) VALUES (
        'pagar',
        'Crédito por devolução — ' || COALESCE(v_nota.cliente_nome,'Cliente') ||
          ' — NF original ' || COALESCE(v_nota.nf_original_numero,'s/nº'),
        v_valor_total, CURRENT_DATE, CURRENT_DATE, 'aberto', 'credito_devolucao_cliente',
        v_nota.pedido_id, v_nota.numero, p_laudo, v_uid
      );
    END IF;
  END IF;
  -- Troca aprovada: peça fica retida no retrabalho para decisão de
  -- reaproveitamento (fluxo já existente em Estoque > Concluir Retrabalho).
  -- Reprovado: idem, permanece retida; nenhum crédito é gerado.

  SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid;
  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (v_uid, COALESCE(v_name,'Desconhecido'), 'finalizar_analise_qualidade_devolucao', 'nota_devolucao_troca', p_id,
    jsonb_build_object('decisao', p_decisao));

  RETURN jsonb_build_object('ok', true, 'decisao', p_decisao, 'valor_total', v_valor_total);
END; $f14$;
GRANT EXECUTE ON FUNCTION public.finalizar_analise_qualidade_devolucao(uuid, text, text, jsonb) TO authenticated;

-- ── RLS: Qualidade também precisa VER os registros de devolução/troca (para
-- listar o que está em análise e o histórico já decidido). Escrita continua
-- só através das RPCs SECURITY DEFINER acima — não libera INSERT/UPDATE
-- direto na tabela para a role qualidade. ────────────────────────────────────
DROP POLICY IF EXISTS "notas_dev_troca_select" ON public.notas_devolucao_troca;
CREATE POLICY "notas_dev_troca_select" ON public.notas_devolucao_troca FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','financeiro','qualidade'))
);
