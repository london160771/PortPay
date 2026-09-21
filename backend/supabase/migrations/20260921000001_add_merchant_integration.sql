-- PortPay pre-mainnet merchant integration readiness.
-- The external reference stays offchain and is never used as settlement authority.

alter table public.invoices
  add column if not exists external_order_reference text;

alter table public.invoices
  add constraint invoices_external_order_reference_length_check
    check (external_order_reference is null or char_length(btrim(external_order_reference)) between 1 and 160);

create index if not exists invoices_merchant_external_reference_idx
  on public.invoices (merchant_address, external_order_reference)
  where external_order_reference is not null;
