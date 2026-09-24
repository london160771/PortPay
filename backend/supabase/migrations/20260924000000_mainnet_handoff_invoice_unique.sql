-- One Mainnet wallet handoff per invoice, enforced independently of handoff IDs.
begin;

create unique index mainnet_handoffs_one_per_invoice_unique
  on public.mainnet_handoffs (invoice_id);

commit;
