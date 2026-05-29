-- ── Evolução da tabela pedidos_comerciais para o fluxo completo ───────────────
--
-- Fluxo: pendente → separando → pronto → faturado → enviado | cancelado
--
-- pendente   = vendedora criou o pedido
-- separando  = estoque está separando os lotes
-- pronto     = estoque separou e marcou como pronto (aguarda financeiro)
-- faturado   = financeiro criou a nota fiscal (NF)
-- enviado    = NF emitida, pedido enviado ao cliente
-- cancelado  = cancelado em qualquer etapa

-- Altera o check de status para incluir os novos estados
alter table public.pedidos_comerciais
  drop constraint if exists pedidos_comerciais_status_check;

alter table public.pedidos_comerciais
  add constraint pedidos_comerciais_status_check
  check (status in ('pendente','separando','pronto','faturado','enviado','cancelado'));

-- Novos campos
alter table public.pedidos_comerciais
  add column if not exists frete            numeric(10,2) default 0,
  add column if not exists separado_por     uuid references auth.users(id),
  add column if not exists separado_em      timestamptz,
  add column if not exists nota_fiscal      text,          -- número ou código da NF
  add column if not exists nf_criada_por    uuid references auth.users(id),
  add column if not exists nf_criada_em     timestamptz,
  add column if not exists enviado_em       timestamptz,
  add column if not exists lotes_separados  jsonb;         -- snapshot dos lotes escolhidos pelo estoque

-- Índice para a nova aba "Pedidos" no estoque (filtra por status)
create index if not exists idx_pedidos_status_created on public.pedidos_comerciais(status, created_at desc);

-- Tabela de notificações internas (vendedora recebe aviso de "enviado")
create table if not exists public.notificacoes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  pedido_id    uuid references public.pedidos_comerciais(id) on delete cascade,
  tipo         text not null,   -- 'pedido_enviado' | 'pedido_pronto' etc
  titulo       text not null,
  mensagem     text,
  lida         boolean not null default false,
  created_at   timestamptz default now() not null
);

alter table public.notificacoes enable row level security;

-- Cada usuário vê apenas as próprias notificações
drop policy if exists "notif_select" on public.notificacoes;
create policy "notif_select" on public.notificacoes
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "notif_insert" on public.notificacoes;
create policy "notif_insert" on public.notificacoes
  for insert to authenticated with check (true);

drop policy if exists "notif_update" on public.notificacoes;
create policy "notif_update" on public.notificacoes
  for update to authenticated using (auth.uid() = user_id);

create index if not exists idx_notif_user_lida on public.notificacoes(user_id, lida, created_at desc);
