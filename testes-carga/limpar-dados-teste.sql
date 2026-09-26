-- Remove o que o teste de carga k6 gravou (peça TESTE-CARGA / operador "Teste de carga").
DELETE FROM public.apontamentos_producao WHERE produto = 'TESTE-CARGA' AND operador = 'Teste de carga';
DELETE FROM public.tempo_peca_padrao     WHERE produto = 'TESTE-CARGA';
