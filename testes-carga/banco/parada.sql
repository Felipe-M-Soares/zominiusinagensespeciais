\set u random(1, 50)
\set p random(1, 20)
\set m random(1, 6)
\set q random(50, 900)
\set h random(4, 12)
BEGIN;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-' || lpad(:u::text, 12, '0'), true);
SET LOCAL ROLE authenticated;
INSERT INTO public.paradas_producao (maquina, motivo, tipo, inicio, fim, duracao_min, operador, user_id)
VALUES ('MQ00' || :m, 'Manut de Máq', 'nao_planejada', now() - interval '19 hours', now(), 1170, 'Operador ' || :u,
        ('00000000-0000-0000-0000-' || lpad(:u::text, 12, '0'))::uuid);
COMMIT;
