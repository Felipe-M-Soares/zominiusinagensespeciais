-- ── Clientes ──────────────────────────────────────────────────────────────────
create table if not exists public.clientes (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  documento     text,           -- CPF / CNPJ
  telefone      text,
  email         text,
  endereco      text,
  observacoes   text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz default now() not null,
  updated_at    timestamptz default now() not null
);

alter table public.clientes enable row level security;

-- Qualquer usuário autenticado pode ver e criar clientes
create policy "clientes_select" on public.clientes for select to authenticated using (true);
create policy "clientes_insert" on public.clientes for insert to authenticated with check (auth.uid() = created_by);
-- Admins e quem criou podem editar/excluir
create policy "clientes_update" on public.clientes for update to authenticated using (
  auth.uid() = created_by
  or exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
);
create policy "clientes_delete" on public.clientes for delete to authenticated using (
  auth.uid() = created_by
  or exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
);

-- ── Pedidos Comerciais ────────────────────────────────────────────────────────
create table if not exists public.pedidos_comerciais (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references public.clientes(id) on delete restrict,
  vendedora_id    uuid references auth.users(id),
  vendedora_nome  text,
  status          text not null default 'pendente'
                  check (status in ('pendente','faturado','cancelado')),
  observacoes     text,
  faturado_por    uuid references auth.users(id),
  faturado_em     timestamptz,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);

alter table public.pedidos_comerciais enable row level security;

create policy "pedidos_select" on public.pedidos_comerciais for select to authenticated using (true);
create policy "pedidos_insert" on public.pedidos_comerciais for insert to authenticated with check (true);
create policy "pedidos_update" on public.pedidos_comerciais for update to authenticated using (true);
create policy "pedidos_delete" on public.pedidos_comerciais for delete to authenticated using (
  exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
);

-- ── Itens do Pedido ───────────────────────────────────────────────────────────
create table if not exists public.pedido_itens (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       uuid not null references public.pedidos_comerciais(id) on delete cascade,
  stock_item_id   uuid not null references public.stock_items(id) on delete restrict,
  lote            text not null,
  quantidade      integer not null check (quantidade > 0),
  quantidade_reservada integer not null default 0,
  created_at      timestamptz default now() not null
);

alter table public.pedido_itens enable row level security;

create policy "pedido_itens_select" on public.pedido_itens for select to authenticated using (true);
create policy "pedido_itens_insert" on public.pedido_itens for insert to authenticated with check (true);
create policy "pedido_itens_update" on public.pedido_itens for update to authenticated using (true);
create policy "pedido_itens_delete" on public.pedido_itens for delete to authenticated using (true);

-- ── Trigger updated_at ────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clientes_updated_at on public.clientes;
create trigger clientes_updated_at before update on public.clientes
  for each row execute procedure public.set_updated_at();

drop trigger if exists pedidos_updated_at on public.pedidos_comerciais;
create trigger pedidos_updated_at before update on public.pedidos_comerciais
  for each row execute procedure public.set_updated_at();

-- Índices úteis
create index if not exists idx_pedidos_status on public.pedidos_comerciais(status);
create index if not exists idx_pedidos_cliente on public.pedidos_comerciais(cliente_id);
create index if not exists idx_pedido_itens_pedido on public.pedido_itens(pedido_id);
create index if not exists idx_pedido_itens_stock on public.pedido_itens(stock_item_id);
