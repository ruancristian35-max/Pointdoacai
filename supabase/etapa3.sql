-- Execute depois de schema.sql. Tabela de eventos para deduplicação de webhooks.
create table if not exists public.payment_events (
 id bigint generated always as identity primary key,
 provider text not null,
 provider_event_id text not null,
 order_id uuid references public.orders(id),
 event_type text not null,
 received_at timestamptz not null default now(),
 unique (provider, provider_event_id)
);
alter table public.payment_events enable row level security;
create index if not exists payment_events_order_idx on public.payment_events(order_id);
-- Não crie policies públicas: operações somente pelo backend service_role.
