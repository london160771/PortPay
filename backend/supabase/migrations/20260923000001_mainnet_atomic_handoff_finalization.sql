-- Mainnet-only hardening. Does not alter testnet settlement paths or data.
-- Wallet handoff is authorized by a DB timestamp while preparation is fresh;
-- subsequent RPC observation may happen after expiry only through that record.
begin;

alter table public.invoices
  add column if not exists payment_network text;

-- Preserve legacy NULL rows as testnet-compatible. A preparation is not proof of
-- payment: backfill only paid invoices whose transaction is present in the
-- immutable chain-196 settlement ledger and whose preparation belongs to them.
update public.invoices as invoice_row
set payment_network = 'x-layer-mainnet'
where invoice_row.payment_network is null
  and invoice_row.status = 'paid'
  and invoice_row.payment_tx_hash is not null
  and exists (
    select 1
    from public.mainnet_settlements settlement
    join public.mainnet_preparations preparation
      on preparation.id = settlement.preparation_id
    where settlement.invoice_id = invoice_row.id
      and settlement.chain_id = 196
      and lower(settlement.transaction_hash) = lower(invoice_row.payment_tx_hash)
      and preparation.invoice_id = invoice_row.id
      and preparation.chain_id = 196
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoices_payment_network_check'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices add constraint invoices_payment_network_check
      check (payment_network is null or payment_network in ('x-layer-testnet', 'x-layer-mainnet'));
  end if;
end;
$$;

create table if not exists public.mainnet_handoffs (
  id uuid primary key default gen_random_uuid(),
  preparation_id uuid not null references public.mainnet_preparations(id),
  invoice_id uuid not null references public.invoices(id),
  buyer_address text not null,
  chain_id integer not null check (chain_id = 196),
  preparation_hash text not null check (preparation_hash ~ '^0x[0-9a-fA-F]{64}$'),
  calldata_hash text not null check (calldata_hash ~ '^0x[0-9a-fA-F]{64}$'),
  handoff_started_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists mainnet_handoffs_preparation_idx
  on public.mainnet_handoffs (preparation_id, handoff_started_at desc);

-- One server-authorized wallet handoff per immutable preparation. A declined or
-- expired handoff requires a newly prepared transaction, never a mutated retry.
create unique index if not exists mainnet_handoffs_one_per_preparation_unique
  on public.mainnet_handoffs (preparation_id);

create or replace function public.validate_mainnet_handoff()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  preparation public.mainnet_preparations%rowtype;
  invoice_row public.invoices%rowtype;
  handoff_time timestamptz := clock_timestamp();
  prepared_time timestamptz;
begin
  select * into preparation from public.mainnet_preparations
    where id = new.preparation_id for key share;
  if not found or preparation.invoice_id is distinct from new.invoice_id
    or preparation.chain_id is distinct from 196 or new.chain_id is distinct from 196
    or lower(preparation.buyer_address) is distinct from lower(new.buyer_address)
    or preparation.evidence->>'preparationHash' is distinct from new.preparation_hash
    or preparation.attributed_swap_calldata_hash is distinct from new.calldata_hash then
    raise exception 'mainnet handoff does not match immutable preparation';
  end if;
  select * into invoice_row from public.invoices where id = new.invoice_id for key share;
  if not found or invoice_row.status is distinct from 'pending'
    or lower(invoice_row.merchant_address) is distinct from lower(preparation.merchant_address) then
    raise exception 'mainnet handoff requires the matching pending invoice';
  end if;
  begin
    prepared_time := (preparation.evidence->>'preparedAt')::timestamptz;
  exception when others then
    raise exception 'persisted mainnet preparation timestamp is invalid';
  end;
  if prepared_time is null or handoff_time < prepared_time or handoff_time >= preparation.expires_at then
    raise exception 'mainnet preparation is expired for new wallet handoff';
  end if;
  new.handoff_started_at := handoff_time;
  new.created_at := handoff_time;
  return new;
end;
$$;

drop trigger if exists mainnet_handoffs_validate on public.mainnet_handoffs;
create trigger mainnet_handoffs_validate before insert on public.mainnet_handoffs
  for each row execute function public.validate_mainnet_handoff();
drop trigger if exists mainnet_handoffs_immutable on public.mainnet_handoffs;
create trigger mainnet_handoffs_immutable before update or delete on public.mainnet_handoffs
  for each row execute function public.reject_mainnet_evidence_mutation();
revoke all on function public.reject_mainnet_evidence_mutation() from public, anon, authenticated, service_role;
alter table public.mainnet_handoffs enable row level security;
revoke all on function public.validate_mainnet_handoff() from public, anon, authenticated, service_role;

alter table public.mainnet_submissions
  add column if not exists handoff_id uuid references public.mainnet_handoffs(id);
alter table public.mainnet_submissions
  alter column submitted_at set default clock_timestamp();

create or replace function public.validate_mainnet_submission_window()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  preparation public.mainnet_preparations%rowtype;
  handoff public.mainnet_handoffs%rowtype;
  observed_at timestamptz := clock_timestamp();
begin
  select * into preparation from public.mainnet_preparations
    where id = new.preparation_id for key share;
  select * into handoff from public.mainnet_handoffs
    where id = new.handoff_id for key share;
  if not found or handoff.id is null
    or preparation.invoice_id is distinct from new.invoice_id
    or preparation.chain_id is distinct from new.chain_id or new.chain_id is distinct from 196
    or handoff.preparation_id is distinct from new.preparation_id
    or handoff.invoice_id is distinct from new.invoice_id
    or handoff.chain_id is distinct from new.chain_id then
    raise exception 'mainnet submission lacks matching pre-expiry handoff';
  end if;
  if handoff.preparation_hash is distinct from preparation.evidence->>'preparationHash'
    or handoff.calldata_hash is distinct from preparation.attributed_swap_calldata_hash
    or lower(handoff.buyer_address) is distinct from lower(preparation.buyer_address)
    or observed_at < handoff.handoff_started_at then
    raise exception 'mainnet submission does not match its immutable handoff';
  end if;
  -- Observation can be after expiry; only the DB-timed handoff must be pre-expiry.
  new.submitted_at := observed_at;
  return new;
end;
$$;
revoke all on function public.validate_mainnet_submission_window() from public, anon, authenticated, service_role;

-- Reset Supabase's potentially broad default table grants and reproduce the
-- audited service-role matrix on a clean migration replay. The finalizer below
-- runs as its owner; the repository needs direct INSERT only for immutable
-- preparations, handoffs, and submission observations.
revoke all privileges on table
  public.mainnet_preparations,
  public.mainnet_handoffs,
  public.mainnet_submissions,
  public.mainnet_settlements
from public, anon, authenticated, service_role;
grant select, insert on table
  public.mainnet_preparations,
  public.mainnet_handoffs,
  public.mainnet_submissions
to service_role;
grant select on table public.mainnet_settlements to service_role;

-- The RPC is now the only service-role route for inserting a settlement claim.
revoke all on function public.claim_mainnet_settlement(uuid, uuid, integer, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.finalize_mainnet_settlement(
  p_preparation_id uuid,
  p_invoice_id uuid,
  p_chain_id integer,
  p_transaction_hash text,
  p_evidence jsonb
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  preparation public.mainnet_preparations%rowtype;
  invoice_row public.invoices%rowtype;
  prior public.mainnet_settlements%rowtype;
  inserted_count integer;
  paid_time timestamptz := clock_timestamp();
  input_amount numeric;
  output_amount numeric;
  buyer_before numeric;
  buyer_after numeric;
  merchant_before numeric;
  merchant_after numeric;
begin
  if p_chain_id is distinct from 196 or p_transaction_hash is null
    or p_transaction_hash !~ '^0x[0-9a-fA-F]{64}$' or p_evidence is null then
    return 'rejected';
  end if;
  if coalesce(p_evidence->>'inputAmount', '') !~ '^[1-9][0-9]*$'
    or coalesce(p_evidence->>'outputAmount', '') !~ '^[1-9][0-9]*$'
    or coalesce(p_evidence->>'maxInputAmount', '') !~ '^[1-9][0-9]*$'
    or char_length(p_evidence->>'inputAmount') > 78
    or char_length(p_evidence->>'maxInputAmount') > 78
    or char_length(p_evidence->>'outputAmount') > 78
    or coalesce(p_evidence#>>'{balances,buyerInputBefore}', '') !~ '^(0|[1-9][0-9]*)$'
    or coalesce(p_evidence#>>'{balances,buyerInputAfter}', '') !~ '^(0|[1-9][0-9]*)$'
    or coalesce(p_evidence#>>'{balances,merchantOutputBefore}', '') !~ '^(0|[1-9][0-9]*)$'
    or coalesce(p_evidence#>>'{balances,merchantOutputAfter}', '') !~ '^(0|[1-9][0-9]*)$'
    or coalesce(p_evidence#>>'{balances,beforeBlockNumber}', '') !~ '^(0|[1-9][0-9]*)$'
    or coalesce(p_evidence#>>'{balances,receiptBlockNumber}', '') !~ '^(0|[1-9][0-9]*)$'
    or char_length(p_evidence#>>'{balances,buyerInputBefore}') > 78
    or char_length(p_evidence#>>'{balances,buyerInputAfter}') > 78
    or char_length(p_evidence#>>'{balances,merchantOutputBefore}') > 78
    or char_length(p_evidence#>>'{balances,merchantOutputAfter}') > 78
    or char_length(p_evidence#>>'{balances,beforeBlockNumber}') > 78
    or char_length(p_evidence#>>'{balances,receiptBlockNumber}') > 78
    or char_length(p_evidence->>'blockNumber') > 78
    or coalesce(p_evidence#>>'{balances,beforeBlockHash}', '') !~ '^0x[0-9a-fA-F]{64}$'
    or coalesce(p_evidence#>>'{balances,receiptBlockHash}', '') !~ '^0x[0-9a-fA-F]{64}$' then
    return 'rejected';
  end if;
  input_amount := (p_evidence->>'inputAmount')::numeric;
  output_amount := (p_evidence->>'outputAmount')::numeric;
  buyer_before := (p_evidence#>>'{balances,buyerInputBefore}')::numeric;
  buyer_after := (p_evidence#>>'{balances,buyerInputAfter}')::numeric;
  merchant_before := (p_evidence#>>'{balances,merchantOutputBefore}')::numeric;
  merchant_after := (p_evidence#>>'{balances,merchantOutputAfter}')::numeric;
  if buyer_before - buyer_after is distinct from input_amount
    or merchant_after - merchant_before is distinct from output_amount
    or (p_evidence#>>'{balances,receiptBlockNumber}') is distinct from p_evidence->>'blockNumber'
    or (p_evidence#>>'{balances,receiptBlockHash}') is distinct from p_evidence->>'blockHash'
    or (p_evidence#>>'{balances,beforeBlockNumber}')::numeric + 1 <> (p_evidence->>'blockNumber')::numeric
    then
    return 'rejected';
  end if;

  select * into preparation from public.mainnet_preparations
    where id = p_preparation_id for update;
  if not found or preparation.invoice_id is distinct from p_invoice_id
    or preparation.chain_id is distinct from p_chain_id
    or p_evidence->>'maxInputAmount' is distinct from preparation.exact_input_amount
    or input_amount <= 0 or input_amount > preparation.exact_input_amount::numeric
    or lower(p_evidence->>'buyer') is distinct from lower(preparation.buyer_address)
    or lower(p_evidence->>'merchant') is distinct from lower(preparation.merchant_address)
    or lower(p_evidence->>'inputToken') is distinct from lower(preparation.input_token)
    or lower(p_evidence->>'outputToken') is distinct from lower(preparation.output_token)
    or lower(p_evidence->>'router') is distinct from lower(preparation.router_address)
    or p_evidence->>'builderCode' is distinct from preparation.builder_code
    or lower(p_evidence->>'builderPayout') is distinct from lower(preparation.builder_payout_address)
    or p_evidence->>'inputAmount' is distinct from p_evidence#>>'{balances,buyerInputDelta}'
    or p_evidence->>'outputAmount' is distinct from p_evidence#>>'{balances,merchantOutputDelta}'
    or coalesce(p_evidence->>'blockHash', '') !~ '^0x[0-9a-fA-F]{64}$'
    or coalesce(p_evidence->>'blockNumber', '') !~ '^(0|[1-9][0-9]*)$'
    or output_amount < greatest(preparation.minimum_receive::numeric, preparation.stablecoin_invoice_amount::numeric) then
    return 'rejected';
  end if;

  select * into invoice_row from public.invoices where id = p_invoice_id for update;
  if not found then return 'rejected'; end if;

  select * into prior from public.mainnet_settlements
    where invoice_id = p_invoice_id or preparation_id = p_preparation_id
      or (chain_id = p_chain_id and transaction_hash = lower(p_transaction_hash))
    limit 1;
  if found then
    if prior.preparation_id = p_preparation_id and prior.invoice_id = p_invoice_id
      and prior.chain_id = p_chain_id and prior.transaction_hash = lower(p_transaction_hash)
      and prior.evidence = p_evidence and invoice_row.status = 'paid'
      and lower(coalesce(invoice_row.payment_tx_hash, '')) = lower(p_transaction_hash)
      and invoice_row.payment_network = 'x-layer-mainnet' then
      return 'already_paid';
    end if;
    return 'rejected';
  end if;
  if invoice_row.status is distinct from 'pending'
    or invoice_row.payment_network is distinct from 'x-layer-mainnet'
    or lower(invoice_row.merchant_address) is distinct from lower(preparation.merchant_address)
    or output_amount < invoice_row.amount_usdt0::numeric * 1000000 then
    return 'rejected';
  end if;
  if not exists (select 1 from public.mainnet_submissions s
    where s.preparation_id = p_preparation_id and s.invoice_id = p_invoice_id
      and s.chain_id = p_chain_id and s.transaction_hash = lower(p_transaction_hash)
      and s.handoff_id is not null) then
    return 'rejected';
  end if;

  insert into public.mainnet_settlements(preparation_id, invoice_id, chain_id, transaction_hash, evidence)
  values (p_preparation_id, p_invoice_id, p_chain_id, lower(p_transaction_hash), p_evidence)
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count <> 1 then return 'rejected'; end if;

  update public.invoices set
    status = 'paid', updated_at = paid_time, paid_at = paid_time,
    payment_tx_hash = lower(p_transaction_hash), payment_network = 'x-layer-mainnet',
    buyer_address = p_evidence->>'buyer',
    spent_asset = p_evidence->>'inputToken',
    spent_amount = input_amount,
    stablecoin_received = output_amount / 1000000,
    quote_id = preparation.quote_id,
    settlement_contract = p_evidence->>'router',
    settlement_block_number = (p_evidence->>'blockNumber')::numeric
  where id = p_invoice_id and status = 'pending';
  get diagnostics inserted_count = row_count;
  if inserted_count <> 1 then
    raise exception 'mainnet settlement claim could not atomically mark invoice paid';
  end if;
  return 'claimed';
end;
$$;

revoke all on function public.finalize_mainnet_settlement(uuid, uuid, integer, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_mainnet_settlement(uuid, uuid, integer, text, jsonb) to service_role;

-- Canonicalize uniqueness even if callers submit transaction hashes with mixed case.
create unique index if not exists mainnet_settlements_chain_normalized_tx_unique
  on public.mainnet_settlements (chain_id, lower(transaction_hash));
create unique index if not exists mainnet_submissions_chain_normalized_tx_unique
  on public.mainnet_submissions (chain_id, lower(transaction_hash));

commit;
