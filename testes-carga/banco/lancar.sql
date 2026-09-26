\set u random(1, 50)
\set p random(1, 20)
\set m random(1, 6)
\set q random(50, 900)
\set h random(4, 12)
BEGIN;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-' || lpad(:u::text, 12, '0'), true);
SET LOCAL ROLE authenticated;
SELECT public.criar_apontamento_ppi51(CURRENT_DATE, 'Dia inteiro', 'MQ00' || :m, 'MQ00' || :m,
  'P-' || lpad(:p::text, 3, '0'), 'Peça', 30, :h, 250, :q, 0, 24, NULL, :h, '', '', '', NULL, NULL, 'Operador ' || :u,
  '[{"tipo_id":1,"tipo_nome":"Refeição","duracao_horas":1},{"tipo_id":7,"tipo_nome":"SetUp","duracao_horas":0.5}]'::jsonb,
  '[{"tipo_id":2,"tipo_nome":"Gap","quantidade":2}]'::jsonb);
COMMIT;
