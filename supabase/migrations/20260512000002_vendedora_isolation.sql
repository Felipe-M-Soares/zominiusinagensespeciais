-- ── Isolamento de Clientes e Pedidos por Vendedora ──────────────────────────
--
-- Antes: qualquer autenticada via "clientes_select using (true)" podia ver todos
-- Agora: vendedoras vêem apenas registros seus; admins e funcionários vêem tudo
--
-- RLS de clientes ─────────────────────────────────────────────────────────────
drop policy if exists "clientes_select" on public.clientes;
create policy "clientes_select" on public.clientes for select to authenticated using (
  -- admin/funcionário vê tudo
  exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role in ('admin', 'funcionario', 'financeiro')
  )
  -- criadora vê os próprios
  or auth.uid() = created_by
);

-- RLS de pedidos_comerciais ───────────────────────────────────────────────────
drop policy if exists "pedidos_select" on public.pedidos_comerciais;
create policy "pedidos_select" on public.pedidos_comerciais for select to authenticated using (
  -- admin/funcionário vê tudo
  exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role in ('admin', 'funcionario', 'financeiro')
  )
  -- vendedora vê apenas pedidos dela
  or vendedora_id = auth.uid()
);

-- RLS de pedido_itens (herda visibilidade pelo pedido) ───────────────────────
drop policy if exists "pedido_itens_select" on public.pedido_itens;
create policy "pedido_itens_select" on public.pedido_itens for select to authenticated using (
  exists (
    select 1 from public.pedidos_comerciais pc
    where pc.id = pedido_id and (
      pc.vendedora_id = auth.uid()
      or exists (
        select 1 from public.user_roles
        where user_id = auth.uid() and role in ('admin', 'funcionario', 'financeiro')
      )
    )
  )
);

-- Índice para acelerar queries por vendedora
create index if not exists idx_pedidos_vendedora on public.pedidos_comerciais(vendedora_id);
create index if not exists idx_clientes_created_by on public.clientes(created_by);
