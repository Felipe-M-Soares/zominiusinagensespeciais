\set u random(1, 50)
\set p random(1, 20)
\set m random(1, 6)
\set q random(50, 900)
\set h random(4, 12)
BEGIN;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-' || lpad(:u::text, 12, '0'), true);
SET LOCAL ROLE authenticated;
\set o random(0, 20)
SELECT public.editar_apontamento_producao(
  (SELECT id FROM public.apontamentos_producao WHERE data_apontamento = CURRENT_DATE - 1 ORDER BY id LIMIT 1 OFFSET :o),
  'MQ00' || :m, 'P-' || lpad(:p::text, 3, '0'), 'Peça', 30, :h, :q, 'Operador ' || :u,
  '[{"tipo_id":1,"tipo_nome":"Refeição","duracao_horas":1}]'::jsonb, '[]'::jsonb);
COMMIT;
