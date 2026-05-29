-- Adiciona quantidade reservada ao stock_items (expedição)
-- Quando um pedido é confirmado, as peças ficam reservadas
-- quantity_available = quantity - quantity_reserved

alter table public.stock_items
  add column if not exists quantity_reserved integer not null default 0;

-- Índice para consultas de disponibilidade
create index if not exists idx_stock_items_fase_reserved
  on public.stock_items(fase, quantity_reserved);
