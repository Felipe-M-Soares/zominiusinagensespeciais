-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: usuário com role 'financeiro' precisa ver TODOS os clientes e pedido_itens
-- para que a tela Financeiro mostre todos os pedidos prontos/faturados/enviados,
-- independente de quem criou o cliente.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Recriar policy de clientes garantindo que 'financeiro' enxerga todos
drop policy if exists "clientes_select" on public.clientes;
create policy "clientes_select" on public.clientes
  for select to authenticated using (
    -- admin, funcionario e financeiro vêem todos os clientes
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid()
        and role in ('admin', 'funcionario', 'financeiro')
    )
    -- criadora vê os próprios clientes
    or auth.uid() = created_by
  );

-- 2. Garantir que pedidos_comerciais também libera financeiro
drop policy if exists "pedidos_select" on public.pedidos_comerciais;
create policy "pedidos_select" on public.pedidos_comerciais
  for select to authenticated using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid()
        and role in ('admin', 'funcionario', 'financeiro')
    )
    or vendedora_id = auth.uid()
  );

-- 3. pedido_itens herda visibilidade do pedido
drop policy if exists "pedido_itens_select" on public.pedido_itens;
create policy "pedido_itens_select" on public.pedido_itens
  for select to authenticated using (
    exists (
      select 1 from public.pedidos_comerciais pc
      where pc.id = pedido_id
        and (
          pc.vendedora_id = auth.uid()
          or exists (
            select 1 from public.user_roles
            where user_id = auth.uid()
              and role in ('admin', 'funcionario', 'financeiro')
          )
        )
    )
  );

-- 4. Índice extra para acelerar lookup por role no financeiro
create index if not exists idx_user_roles_role on public.user_roles(role);
