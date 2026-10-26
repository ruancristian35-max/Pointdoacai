-- Execute no SQL Editor do seu projeto Supabase.
create table if not exists public.orders (
 id uuid primary key,
 created_at timestamptz not null default now(),
 customer_name text not null,
 customer_phone text not null,
 delivery_type text not null check (delivery_type in ('Entrega','Retirada')),
 delivery_address text,
 items jsonb not null,
 total_cents integer not null check (total_cents > 0),
 payment_method text not null check (payment_method in ('Pix','Cartão')),
 status text not null default 'pending_payment' check (status in ('pending_payment','awaiting_payment','paid','cancelled','failed')),
 provider_payment_id text unique
);
alter table public.orders enable row level security;
-- Sem policies: navegador/anon não acessa pedidos. Apenas backend com service_role.
create index if not exists orders_created_at_idx on public.orders(created_at desc);
