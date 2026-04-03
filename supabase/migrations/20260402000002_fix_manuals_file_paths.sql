-- =============================================================================
-- FIX: Corrige file_paths de manuais antigos que foram salvos com o nome original
-- (com hífens, acentos, espaços) em vez do nome sanitizado usado no storage.
--
-- PROBLEMA: Arquivos como "IT-5.2.05-Chave-Torque-Retriver.pdf" foram salvos
-- no storage com nome sanitizado ("it_5.2.05_chave_torque_retriver.pdf"),
-- mas o banco guardou o path com o nome original.
-- Resultado: createSignedUrl() retorna "Object not found".
--
-- COMO USAR:
-- 1. Cole este SQL no Supabase SQL Editor
-- 2. Execute para ver quais registros serão afetados (o SELECT no final)
-- 3. Se os paths estiverem corretos, execute o UPDATE
-- =============================================================================

-- Função auxiliar para sanitizar o nome do arquivo (espelha o TypeScript)
CREATE OR REPLACE FUNCTION sanitize_filename(input text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  result text;
BEGIN
  -- Converte para lowercase
  result := lower(input);
  -- Substitui hífens e espaços por underscore
  result := regexp_replace(result, '[-\s]+', '_', 'g');
  -- Remove caracteres especiais exceto letras, números, ponto, underscore, hífen
  result := regexp_replace(result, '[^a-z0-9._-]', '_', 'g');
  -- Colapsa múltiplos underscores
  result := regexp_replace(result, '_+', '_', 'g');
  RETURN result;
END;
$$;

-- Preview: mostra quais registros têm paths que provavelmente não batem com o storage
-- Execute primeiro para verificar antes de fazer o UPDATE
SELECT
  id,
  title,
  file_path AS path_atual,
  -- Reconstrói o path sanitizado: timestamp + _ + nome_sanitizado
  split_part(file_path, '_', 1) || '_' || 
    sanitize_filename(
      -- Remove o timestamp (primeiro segmento) do path
      substring(file_path from position('_' in file_path) + 1)
    ) AS path_corrigido,
  -- Mostra se são diferentes (esses precisam de correção)
  file_path != (
    split_part(file_path, '_', 1) || '_' || 
    sanitize_filename(substring(file_path from position('_' in file_path) + 1))
  ) AS precisa_correcao
FROM public.manuals
ORDER BY created_at;

-- ATENÇÃO: Só execute o UPDATE abaixo APÓS confirmar o SELECT acima.
-- Verifique se os "path_corrigido" realmente existem no Supabase Storage > manuals
-- antes de atualizar.

-- UPDATE public.manuals
-- SET file_path = (
--   split_part(file_path, '_', 1) || '_' || 
--   sanitize_filename(substring(file_path from position('_' in file_path) + 1))
-- )
-- WHERE file_path != (
--   split_part(file_path, '_', 1) || '_' || 
--   sanitize_filename(substring(file_path from position('_' in file_path) + 1))
-- );
