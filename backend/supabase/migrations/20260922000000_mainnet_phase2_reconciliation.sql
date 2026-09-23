-- Mainnet Phase 2 only. This schema does not alter testnet invoices or reconciliation.
-- All token amounts are text so Postgres/PostgREST never round a uint256 through numeric/JS number.

create table if not exists public.mainnet_preparations (
  id uuid primary key,
  invoice_id uuid not null references public.invoices(id),
  quote_id text not null check (char_length(quote_id) between 1 and 256),
  buyer_address text not null,
  merchant_address text not null,
  chain_id integer not null check (chain_id = 196),
  input_token text not null,
  output_token text not null,
  exact_input_amount text not null check (exact_input_amount ~ '^[1-9][0-9]*$' and char_length(exact_input_amount) <= 78),
  minimum_receive text not null check (minimum_receive ~ '^[1-9][0-9]*$' and char_length(minimum_receive) <= 78),
  router_address text not null,
  spender_address text not null,
  attributed_approval_calldata text not null check (attributed_approval_calldata ~ '^0x[0-9a-fA-F]+$'),
  attributed_approval_calldata_hash text not null check (attributed_approval_calldata_hash ~ '^0x[0-9a-fA-F]{64}$'),
  attributed_swap_calldata text not null check (attributed_swap_calldata ~ '^0x[0-9a-fA-F]+$'),
  attributed_swap_calldata_hash text not null check (attributed_swap_calldata_hash ~ '^0x[0-9a-fA-F]{64}$'),
  builder_code text not null check (char_length(builder_code) = 16 and builder_code <> 'kob1lkgsg6infkg3'),
  builder_payout_address text not null,
  preparation_block_number text not null check (preparation_block_number ~ '^(0|[1-9][0-9]*)$'),
  preparation_block_hash text not null check (preparation_block_hash ~ '^0x[0-9a-fA-F]{64}$'),
  expires_at timestamptz not null,
  stablecoin_invoice_amount text not null check (stablecoin_invoice_amount ~ '^[1-9][0-9]*$' and char_length(stablecoin_invoice_amount) <= 78),
  evidence jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists mainnet_preparations_invoice_idx
  on public.mainnet_preparations (invoice_id, created_at desc);

create or replace function public.reject_mainnet_evidence_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'mainnet evidence is immutable';
end;
$$;

drop trigger if exists mainnet_preparations_immutable on public.mainnet_preparations;
create trigger mainnet_preparations_immutable
  before update or delete on public.mainnet_preparations
  for each row execute function public.reject_mainnet_evidence_mutation();

create table if not exists public.mainnet_settlements (
  id uuid primary key default gen_random_uuid(),
  preparation_id uuid not null unique references public.mainnet_preparations(id),
  invoice_id uuid not null unique references public.invoices(id),
  chain_id integer not null check (chain_id = 196),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  constraint mainnet_settlements_chain_transaction_unique unique (chain_id, transaction_hash)
);

alter table public.mainnet_preparations enable row level security;
alter table public.mainnet_settlements enable row level security;

drop trigger if exists mainnet_settlements_immutable on public.mainnet_settlements;
create trigger mainnet_settlements_immutable
  before update or delete on public.mainnet_settlements
  for each row execute function public.reject_mainnet_evidence_mutation();

revoke all on public.mainnet_preparations, public.mainnet_settlements from public, anon, authenticated;
grant select, insert on public.mainnet_preparations to service_role;
grant select, insert on public.mainnet_settlements to service_role;

create or replace function public.claim_mainnet_settlement(
  p_preparation_id uuid,
  p_invoice_id uuid,
  p_chain_id integer,
  p_transaction_hash text,
  p_evidence jsonb
)
returns boolean
language plpgsql
as $$
declare
  preparation public.mainnet_preparations%rowtype;
begin
  if p_chain_id is distinct from 196
    or p_transaction_hash is null
    or p_transaction_hash !~ '^0x[0-9a-fA-F]{64}$'
    or p_evidence is null then
    return false;
  end if;

  select * into preparation
    from public.mainnet_preparations
    where id = p_preparation_id
    for share;
  if not found
    or preparation.invoice_id is distinct from p_invoice_id
    or preparation.chain_id is distinct from p_chain_id
    or lower(p_evidence->>'buyer') is distinct from lower(preparation.buyer_address)
    or lower(p_evidence->>'merchant') is distinct from lower(preparation.merchant_address)
    or lower(p_evidence->>'inputToken') is distinct from lower(preparation.input_token)
    or lower(p_evidence->>'outputToken') is distinct from lower(preparation.output_token)
    or p_evidence->>'inputAmount' is distinct from preparation.exact_input_amount
    or lower(p_evidence->>'router') is distinct from lower(preparation.router_address)
    or p_evidence->>'builderCode' is distinct from preparation.builder_code
    or lower(p_evidence->>'builderPayout') is distinct from lower(preparation.builder_payout_address)
    or coalesce(p_evidence->>'blockHash', '') !~ '^0x[0-9a-fA-F]{64}$'
    or coalesce(p_evidence->>'blockNumber', '') !~ '^(0|[1-9][0-9]*)$' then
    return false;
  end if;

  if coalesce(p_evidence->>'outputAmount', '') !~ '^[1-9][0-9]*$'
    or char_length(p_evidence->>'outputAmount') > 78 then
    return false;
  end if;

  if (p_evidence->>'outputAmount')::numeric < greatest(
    preparation.minimum_receive::numeric,
    preparation.stablecoin_invoice_amount::numeric
  ) then
    return false;
  end if;

  insert into public.mainnet_settlements (
    preparation_id, invoice_id, chain_id, transaction_hash, evidence
  ) values (
    p_preparation_id, p_invoice_id, p_chain_id, lower(p_transaction_hash), p_evidence
  ) on conflict do nothing;

  return found;
end;
$$;

revoke all on function public.claim_mainnet_settlement(uuid, uuid, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_mainnet_settlement(uuid, uuid, integer, text, jsonb) to service_role;
