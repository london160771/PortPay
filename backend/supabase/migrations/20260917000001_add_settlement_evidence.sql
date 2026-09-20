-- PortPay Phase 3 — Core Settlement
-- Apply after 20260917000000_create_invoices.sql.

alter table public.invoices
  add column if not exists payment_tx_hash text,
  add column if not exists paid_at timestamptz,
  add column if not exists buyer_address text,
  add column if not exists spent_asset text,
  add column if not exists spent_amount numeric(78, 0),
  add column if not exists stablecoin_received numeric(38, 6),
  add column if not exists quote_id text,
  add column if not exists settlement_contract text,
  add column if not exists settlement_block_number numeric(78, 0);

alter table public.invoices
  add constraint invoices_payment_tx_hash_format_check
    check (payment_tx_hash is null or payment_tx_hash ~ '^0x[a-fA-F0-9]{64}$'),
  add constraint invoices_buyer_address_format_check
    check (buyer_address is null or buyer_address ~ '^0x[a-fA-F0-9]{40}$'),
  add constraint invoices_spent_asset_format_check
    check (spent_asset is null or spent_asset ~ '^0x[a-fA-F0-9]{40}$'),
  add constraint invoices_settlement_contract_format_check
    check (settlement_contract is null or settlement_contract ~ '^0x[a-fA-F0-9]{40}$'),
  add constraint invoices_spent_amount_positive_check
    check (spent_amount is null or spent_amount > 0),
  add constraint invoices_stablecoin_received_positive_check
    check (stablecoin_received is null or stablecoin_received > 0),
  add constraint invoices_settlement_block_number_positive_check
    check (settlement_block_number is null or settlement_block_number >= 0);

create unique index if not exists invoices_payment_tx_hash_unique_idx
  on public.invoices (payment_tx_hash)
  where payment_tx_hash is not null;

create unique index if not exists invoices_quote_id_unique_idx
  on public.invoices (quote_id)
  where quote_id is not null;
