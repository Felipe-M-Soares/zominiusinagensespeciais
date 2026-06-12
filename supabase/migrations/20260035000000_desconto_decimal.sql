-- Migration: permite desconto com casas decimais (ex: 25.4%)
-- Antes: desconto_pct integer
-- Depois: desconto_pct numeric(5,2)  → suporta 0.00 a 999.99

ALTER TABLE pedidos_comerciais
  ALTER COLUMN desconto_pct TYPE numeric(5,2)
    USING desconto_pct::numeric(5,2);

-- Garante valor padrão consistente
ALTER TABLE pedidos_comerciais
  ALTER COLUMN desconto_pct SET DEFAULT 0;
