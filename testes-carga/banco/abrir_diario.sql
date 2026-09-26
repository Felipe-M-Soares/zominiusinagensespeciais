\set u random(1, 50)
\set p random(1, 20)
\set m random(1, 6)
\set q random(50, 900)
\set h random(4, 12)
BEGIN;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-' || lpad(:u::text, 12, '0'), true);
SET LOCAL ROLE authenticated;
SELECT id, codigo, nome, status FROM public.maquinas_producao ORDER BY codigo;
SELECT codigo, descricao, pecas_por_hora FROM public.produtos_producao WHERE ativo ORDER BY codigo;
SELECT id, nome, categoria FROM public.tipo_parada_producao WHERE ativo ORDER BY id;
SELECT id, maquina_codigo, produto, quantidade, qtde_plan_disp, horas_planejadas, turno, operador, created_at
  FROM public.apontamentos_producao WHERE data_apontamento = CURRENT_DATE ORDER BY created_at DESC;
SELECT id, maquina, motivo, inicio, duracao_min FROM public.paradas_producao
  WHERE inicio >= CURRENT_DATE AND inicio < CURRENT_DATE + 1 ORDER BY inicio DESC;
SELECT produto, maquina, pecas_hora, amostras FROM public.tempo_peca_padrao;
COMMIT;
