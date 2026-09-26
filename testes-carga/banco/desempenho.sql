\set u random(1, 50)
\set p random(1, 20)
\set m random(1, 6)
\set q random(50, 900)
\set h random(4, 12)
BEGIN;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-' || lpad(:u::text, 12, '0'), true);
SET LOCAL ROLE authenticated;
SELECT public.calcular_oee(date_trunc('year', CURRENT_DATE)::date + 181, (date_trunc('year', CURRENT_DATE) + interval '1 year - 1 day')::date);
SELECT public.resumo_mensal_producao(7, EXTRACT(YEAR FROM CURRENT_DATE)::int);
SELECT public.resumo_mensal_producao(8, EXTRACT(YEAR FROM CURRENT_DATE)::int);
SELECT public.resumo_mensal_producao(9, EXTRACT(YEAR FROM CURRENT_DATE)::int);
SELECT produto, mes, pecas, horas_produtivas FROM public.tempo_peca_mensal
  WHERE mes >= date_trunc('month', CURRENT_DATE) - interval '1 month';
COMMIT;
