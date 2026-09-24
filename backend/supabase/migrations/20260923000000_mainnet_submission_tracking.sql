-- Mainnet-only submission observations. This does not alter testnet invoice or settlement data.
-- The server inserts a row only after the configured chain-196 RPC returns the exact
-- persisted transaction while its preparation is still fresh.
begin;

create table if not exists public.mainnet_submissions (
  preparation_id uuid primary key references public.mainnet_preparations(id),
  invoice_id uuid not null unique references public.invoices(id),
  chain_id integer not null check (chain_id = 196),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
  submitted_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint mainnet_submissions_chain_transaction_unique unique (chain_id, transaction_hash)
);

create or replace function public.validate_mainnet_submission_window()
returns trigger
language plpgsql
as $$
declare
  preparation public.mainnet_preparations%rowtype;
  prepared_at timestamptz;
begin
  select * into preparation
    from public.mainnet_preparations
    where id = new.preparation_id
    for key share;
  if not found
    or preparation.invoice_id is distinct from new.invoice_id
    or preparation.chain_id is distinct from new.chain_id
    or new.chain_id is distinct from 196 then
    raise exception 'mainnet submission does not match a persisted chain-196 preparation';
  end if;

  begin
    prepared_at := (preparation.evidence->>'preparedAt')::timestamptz;
  exception when others then
    raise exception 'persisted mainnet preparation timestamp is invalid';
  end;
  if prepared_at is null
    or new.submitted_at < prepared_at
    or new.submitted_at >= preparation.expires_at then
    raise exception 'mainnet preparation is stale for new submission';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_mainnet_submission_window() from public, anon, authenticated, service_role;

drop trigger if exists mainnet_submissions_fresh_preparation on public.mainnet_submissions;
create trigger mainnet_submissions_fresh_preparation
  before insert on public.mainnet_submissions
  for each row execute function public.validate_mainnet_submission_window();

alter table public.mainnet_submissions enable row level security;
-- Supabase default table grants can be broader than this repository needs.
-- Reset them explicitly so a fresh replay has the same least-privilege matrix
-- as the verified live project.
revoke all privileges on table public.mainnet_submissions
  from public, anon, authenticated, service_role;
grant select, insert on table public.mainnet_submissions to service_role;

drop trigger if exists mainnet_submissions_immutable on public.mainnet_submissions;
create trigger mainnet_submissions_immutable
  before update or delete on public.mainnet_submissions
  for each row execute function public.reject_mainnet_evidence_mutation();

commit;
