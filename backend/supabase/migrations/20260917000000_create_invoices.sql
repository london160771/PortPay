-- PortPay Phase 2 — Merchant Invoice Flow
-- Run this migration in the Supabase SQL editor or through the Supabase CLI.

create extension if not exists pgcrypto;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  amount_usdt0 numeric(38, 6) not null check (amount_usdt0 > 0),
  merchant_address text not null check (merchant_address ~ '^0x[a-fA-F0-9]{40}$'),
  payment_url text not null unique,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists invoices_merchant_created_at_idx
  on public.invoices (merchant_address, created_at desc);

create or replace function public.set_invoices_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
before update on public.invoices
for each row execute function public.set_invoices_updated_at();

-- The backend uses SUPABASE_SERVICE_ROLE_KEY and is the only database client in Phase 2.
alter table public.invoices enable row level security;
