-- 50 usuários (40 produção, 5 estoque, 5 admin), 6 máquinas, 20 peças, ~6 meses de histórico
INSERT INTO auth.users(id,email)
SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid, 'u'||i||'@teste' FROM generate_series(1,50) i;
UPDATE public.user_roles SET role = CASE WHEN user_id::text LIKE '%00000000004_' OR user_id::text LIKE '%000000000050' THEN 'admin'
  ELSE 'producao' END::public.app_role;
UPDATE public.profiles SET approved = true;
INSERT INTO public.maquinas_producao (codigo, nome, status)
SELECT 'MQ00'||i, 'Torno '||i, 'operando' FROM generate_series(1,6) i ON CONFLICT DO NOTHING;
INSERT INTO public.produtos_producao (codigo, descricao, pecas_por_hora, ativo)
SELECT 'P-'||lpad(i::text,3,'0'), 'Peça '||i, 20+i*3, true FROM generate_series(1,20) i ON CONFLICT DO NOTHING;
-- histórico: ~15 mil apontamentos em 180 dias (feito como postgres, trigger adiado roda no commit)
INSERT INTO public.apontamentos_producao (produto, descricao_produto, lote, maquina, maquina_codigo, equipamento, operador, turno,
  quantidade, inicio, status, data_apontamento, horas_planejadas, qtde_plan_disp, qtde_por_hora, user_id)
SELECT 'P-'||lpad((1+(g%20))::text,3,'0'), 'Peça', 'L'||g, 'MQ00'||(1+g%6), 'MQ00'||(1+g%6), 'MQ00'||(1+g%6), 'Op '||(g%50),
  'Dia inteiro', 200+(g%300), '0', 'concluido', CURRENT_DATE - (g%180), 8+(g%4), 250, 30,
  ('00000000-0000-0000-0000-'||lpad((1+g%50)::text,12,'0'))::uuid
FROM generate_series(1,15000) g;
ANALYZE;
