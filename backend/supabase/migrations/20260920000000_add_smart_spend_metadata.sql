alter table public.invoices
  add column if not exists smart_spend_used boolean,
  add column if not exists smart_spend_recommended_asset text,
  add column if not exists smart_spend_reason text;

update public.invoices
set smart_spend_used = false
where smart_spend_used is null;

alter table public.invoices
  alter column smart_spend_used set default false;
