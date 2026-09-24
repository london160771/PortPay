import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InMemoryMainnetReconciliationRepository, SupabaseMainnetReconciliationRepository, type MainnetPreparationEvidence, type MainnetSettlementClaim } from './mainnetReconciliationRepository.js';

function preparation(id: string, invoiceId: string): MainnetPreparationEvidence {
  return { id, invoiceId, chainId: 196 } as MainnetPreparationEvidence;
}
function claim(preparationId: string, invoiceId: string, transactionHash: string): MainnetSettlementClaim {
  return { preparationId, invoiceId, chainId: 196, transactionHash } as MainnetSettlementClaim;
}

describe('atomic mainnet settlement repository claims', () => {
  it('declares replay-safe least-privilege table ACLs across the mainnet migration chain', () => {
    const submissionsMigration = readFileSync(new URL('../../supabase/migrations/20260923000000_mainnet_submission_tracking.sql', import.meta.url), 'utf8').toLowerCase();
    const handoffMigration = readFileSync(new URL('../../supabase/migrations/20260923000001_mainnet_atomic_handoff_finalization.sql', import.meta.url), 'utf8').toLowerCase();
    const compact = (sql: string) => sql.replace(/\s+/g, ' ');
    const submissionsSql = compact(submissionsMigration);
    const handoffSql = compact(handoffMigration);

    expect(submissionsSql).toContain('revoke all privileges on table public.mainnet_submissions from public, anon, authenticated, service_role;');
    expect(submissionsSql).toContain('grant select, insert on table public.mainnet_submissions to service_role;');
    expect(submissionsSql).toContain('revoke all on function public.validate_mainnet_submission_window() from public, anon, authenticated, service_role;');

    expect(handoffSql).toContain('revoke all privileges on table public.mainnet_preparations, public.mainnet_handoffs, public.mainnet_submissions, public.mainnet_settlements from public, anon, authenticated, service_role;');
    expect(handoffSql).toContain('grant select, insert on table public.mainnet_preparations, public.mainnet_handoffs, public.mainnet_submissions to service_role;');
    expect(handoffSql).toContain('grant select on table public.mainnet_settlements to service_role;');
    expect(handoffSql).toContain('grant execute on function public.finalize_mainnet_settlement(uuid, uuid, integer, text, jsonb) to service_role;');
    expect(handoffSql).toContain('revoke all on function public.claim_mainnet_settlement(uuid, uuid, integer, text, jsonb) from public, anon, authenticated, service_role;');
  });

  it('covers the legacy/mainnet overlap cases in the migration backfill predicate', () => {
    const migration = readFileSync(new URL('../../supabase/migrations/20260923000001_mainnet_atomic_handoff_finalization.sql', import.meta.url), 'utf8');
    const backfill = migration.slice(migration.indexOf('update public.invoices as invoice_row'), migration.indexOf('do $$'));
    expect(backfill).toContain('invoice_row.payment_network is null');
    expect(backfill).toContain("invoice_row.status = 'paid'");
    expect(backfill).toContain('invoice_row.payment_tx_hash is not null');
    expect(backfill).toContain('from public.mainnet_settlements settlement');
    expect(backfill).toContain('join public.mainnet_preparations preparation');
    expect(backfill).toContain('settlement.invoice_id = invoice_row.id');
    expect(backfill).toContain('settlement.chain_id = 196');
    expect(backfill).toContain('preparation.invoice_id = invoice_row.id');
    expect(backfill).toContain('preparation.chain_id = 196');
    expect(backfill).toContain('lower(settlement.transaction_hash) = lower(invoice_row.payment_tx_hash)');

    const fixtures = [
      { name: 'A pending with chain-196 preparation only', status: 'pending', network: null, tx: null, prepChain: 196, settlement: null },
      { name: 'B legacy paid with chain-196 preparation only', status: 'paid', network: null, tx: '0xlegacy', prepChain: 196, settlement: null },
      { name: 'C paid with matching verified settlement', status: 'paid', network: null, tx: '0xmainnet', prepChain: 196, settlement: { invoiceMatches: true, preparationMatches: true, chain: 196, tx: '0xmainnet' } },
      { name: 'D explicit testnet', status: 'paid', network: 'x-layer-testnet', tx: '0xtestnet', prepChain: 196, settlement: { invoiceMatches: true, preparationMatches: true, chain: 196, tx: '0xtestnet' } },
      { name: 'E explicit mainnet', status: 'paid', network: 'x-layer-mainnet', tx: '0xmainnet', prepChain: 196, settlement: { invoiceMatches: true, preparationMatches: true, chain: 196, tx: '0xmainnet' } },
    ] as const;
    const applyPredicate = (fixture: typeof fixtures[number]) =>
      fixture.network === null && fixture.status === 'paid' && fixture.tx !== null
        && fixture.prepChain === 196 && fixture.settlement?.invoiceMatches
        && fixture.settlement.preparationMatches && fixture.settlement.chain === 196
        && fixture.settlement.tx.toLowerCase() === fixture.tx.toLowerCase()
        ? 'x-layer-mainnet'
        : fixture.network;

    expect(fixtures.map((fixture) => [fixture.name, applyPredicate(fixture)])).toEqual([
      ['A pending with chain-196 preparation only', null],
      ['B legacy paid with chain-196 preparation only', null],
      ['C paid with matching verified settlement', 'x-layer-mainnet'],
      ['D explicit testnet', 'x-layer-testnet'],
      ['E explicit mainnet', 'x-layer-mainnet'],
    ]);
    expect(migration).toContain('revoke all on function public.reject_mainnet_evidence_mutation() from public, anon, authenticated, service_role');
  });

  it('allows only one concurrent reconciliation for the same invoice', async () => {
    const repository = new InMemoryMainnetReconciliationRepository();
    await repository.savePreparation(preparation('prep-a', 'invoice-a'));
    await repository.savePreparation(preparation('prep-b', 'invoice-a'));
    const outcomes = await Promise.all([
      repository.claimSettlement(claim('prep-a', 'invoice-a', `0x${'a'.repeat(64)}`)),
      repository.claimSettlement(claim('prep-b', 'invoice-a', `0x${'b'.repeat(64)}`)),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(repository.settlementCount()).toBe(1);
  });

  it('does not allow one chain transaction to be reused for another invoice', async () => {
    const repository = new InMemoryMainnetReconciliationRepository();
    await repository.savePreparation(preparation('prep-a', 'invoice-a'));
    await repository.savePreparation(preparation('prep-b', 'invoice-b'));
    const txHash = `0x${'c'.repeat(64)}`;
    const outcomes = await Promise.all([
      repository.claimSettlement(claim('prep-a', 'invoice-a', txHash)),
      repository.claimSettlement(claim('prep-b', 'invoice-b', txHash)),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(repository.settlementCount()).toBe(1);
  });

  it('makes exact duplicate retries idempotently non-mutating and rejects the replay', async () => {
    const repository = new InMemoryMainnetReconciliationRepository();
    await repository.savePreparation(preparation('prep-a', 'invoice-a'));
    const attempt = claim('prep-a', 'invoice-a', `0x${'d'.repeat(64)}`);
    await expect(repository.claimSettlement(attempt)).resolves.toBe('claimed');
    await expect(repository.claimSettlement(attempt)).resolves.toBe('already_paid');
    expect(repository.settlementCount()).toBe(1);
  });

  it('serializes prepared gas/value bigint fields safely into Supabase JSON evidence', async () => {
    let saved: Record<string, unknown> | undefined;
    const client = {
      from() {
        return { async insert(row: Record<string, unknown>) { saved = row; return { error: null }; } };
      },
    } as unknown as SupabaseClient;
    const repository = new SupabaseMainnetReconciliationRepository(client);
    const evidence = {
      id: 'prep-id', invoiceId: 'invoice-a', quoteId: 'quote-a', chainId: 196,
      buyer: '0xbabdfef588cf57efcc7c8857960e3ccdd9167589', merchant: '0x815c2fb8178f0bf80ada8c5b97ff44ece90e6e25',
      inputToken: '0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f', outputToken: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
      exactInputAmount: '1', minimumReceive: '1', router: '0x7c5bee2a8091c3ef39072f64f18fac913060aeaf', spender: '0x8b773d83bc66be128c60e07e17c8901f7a64f000',
      attributedApprovalCalldata: '0x01', attributedApprovalCalldataHash: `0x${'1'.repeat(64)}`, attributedSwapCalldata: '0x02', attributedSwapCalldataHash: `0x${'2'.repeat(64)}`,
      builderCode: 'mainnetcode12345', builderPayout: '0xbabdfef588cf57efcc7c8857960e3ccdd9167589', preparationBlockNumber: '1', preparationBlockHash: `0x${'3'.repeat(64)}`,
      expiresAt: '2026-09-22T00:00:00.000Z', stablecoinInvoiceAmount: '1', quote: {},
      approval: { kind: 'approval', value: 0n, gas: 21_000n, gasPrice: 3n }, swap: { kind: 'swap', value: 0n, gas: 50_000n, gasPrice: 4n },
    } as unknown as MainnetPreparationEvidence;
    await repository.savePreparation(evidence);
    const json = saved?.evidence as { approval: { value: string; gas: string; gasPrice: string }; swap: { value: string; gas: string; gasPrice: string } };
    expect(json.approval).toEqual({ kind: 'approval', value: '0', gas: '21000', gasPrice: '3' });
    expect(json.swap).toEqual({ kind: 'swap', value: '0', gas: '50000', gasPrice: '4' });
    expect(() => JSON.stringify(saved)).not.toThrow();
  });

  it('finalizes settlement and invoice state through one atomic RPC and fails closed on invoice-update errors', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: 'claimed', error: null })
      .mockResolvedValueOnce({ data: 'already_paid', error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'mainnet settlement claim could not atomically mark invoice paid' } });
    const repository = new SupabaseMainnetReconciliationRepository({ rpc } as unknown as SupabaseClient);
    const attempt = claim('prep-atomic', 'invoice-atomic', `0x${'e'.repeat(64)}`);
    await expect(repository.claimSettlement(attempt)).resolves.toBe('claimed');
    await expect(repository.claimSettlement(attempt)).resolves.toBe('already_paid');
    await expect(repository.claimSettlement(attempt)).rejects.toThrow(/atomically mark invoice paid/);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(Array(3).fill('finalize_mainnet_settlement'));
  });

  it('defines insert, paid transition, and rollback-triggering exception in the same SQL function', () => {
    const migration = readFileSync(new URL('../../supabase/migrations/20260923000001_mainnet_atomic_handoff_finalization.sql', import.meta.url), 'utf8');
    const start = migration.indexOf('create or replace function public.finalize_mainnet_settlement');
    const end = migration.indexOf('revoke all on function public.finalize_mainnet_settlement', start);
    const body = migration.slice(start, end);
    expect(body).toContain('insert into public.mainnet_settlements');
    expect(body).toContain('update public.invoices set');
    expect(body).toContain("raise exception 'mainnet settlement claim could not atomically mark invoice paid'");
    expect(body.indexOf('insert into public.mainnet_settlements')).toBeLessThan(body.indexOf('update public.invoices set'));
  });

  it('uses database timestamps for expiring handoffs and later transaction observations', () => {
    const migration = readFileSync(new URL('../../supabase/migrations/20260923000001_mainnet_atomic_handoff_finalization.sql', import.meta.url), 'utf8');
    const handoff = migration.slice(migration.indexOf('create or replace function public.validate_mainnet_handoff'), migration.indexOf('drop trigger if exists mainnet_handoffs_validate'));
    const submission = migration.slice(migration.indexOf('create or replace function public.validate_mainnet_submission_window'), migration.indexOf('revoke all on function public.validate_mainnet_submission_window'));
    expect(handoff).toContain('clock_timestamp()');
    expect(handoff).toContain('handoff_time >= preparation.expires_at');
    expect(submission).toContain('new.submitted_at := observed_at');
    expect(submission).not.toContain('new.submitted_at >= preparation.expires_at');
    expect(submission).toContain('handoff.preparation_hash');
    expect(submission).toContain('handoff.calldata_hash');
  });
});

describe('mainnet submission observations', () => {
  const preparedAt = '2026-09-23T00:00:00.000Z';
  const expiresAt = '2026-09-23T00:01:00.000Z';
  const buyer = '0xbabdfef588cf57efcc7c8857960e3ccdd9167589' as `0x${string}`;
  const preparationHash = `0x${'1'.repeat(64)}` as `0x${string}`;
  const calldataHash = `0x${'2'.repeat(64)}` as `0x${string}`;
  function timedPreparation(id: string, invoiceId: string): MainnetPreparationEvidence {
    return { id, invoiceId, chainId: 196, buyer, preparationHash, attributedSwapCalldataHash: calldataHash, preparedAt, expiresAt } as MainnetPreparationEvidence;
  }
  async function authorize(repository: InMemoryMainnetReconciliationRepository, preparationId: string, invoiceId: string) {
    const handoff = await repository.createHandoff({ preparationId, invoiceId, buyer, chainId: 196, preparationHash, calldataHash });
    if (!handoff) throw new Error('test handoff setup failed');
    return handoff;
  }

  it('records one exact RPC observation idempotently and rejects transaction reuse across invoices', async () => {
    const repository = new InMemoryMainnetReconciliationRepository(() => new Date('2026-09-23T00:00:10.000Z'));
    await repository.savePreparation(timedPreparation('prep-a', 'invoice-a'));
    await repository.savePreparation(timedPreparation('prep-b', 'invoice-b'));
    const handoffA = await authorize(repository, 'prep-a', 'invoice-a');
    const handoffB = await authorize(repository, 'prep-b', 'invoice-b');
    const first = { preparationId: 'prep-a', handoffId: handoffA.id, invoiceId: 'invoice-a', chainId: 196 as const, transactionHash: `0x${'a'.repeat(64)}` as `0x${string}` };
    expect(await repository.recordSubmission(first)).toMatchObject({ submittedAt: '2026-09-23T00:00:10.000Z' });
    expect(await repository.recordSubmission(first)).toMatchObject({ handoffId: handoffA.id });
    expect(await repository.recordSubmission({ ...first, preparationId: 'prep-b', handoffId: handoffB.id, invoiceId: 'invoice-b' })).toBeNull();
    expect(await repository.recordSubmission({ ...first, invoiceId: 'invoice-a', transactionHash: `0x${'b'.repeat(64)}` as `0x${string}` })).toBeNull();
  });

  it('allows observation after expiry only when an immutable handoff was created before expiry', async () => {
    let now = new Date('2026-09-23T00:00:59.000Z');
    const repository = new InMemoryMainnetReconciliationRepository(() => now);
    await repository.savePreparation(timedPreparation('prep-a', 'invoice-a'));
    const handoff = await authorize(repository, 'prep-a', 'invoice-a');
    now = new Date(expiresAt);
    const submission = await repository.recordSubmission({
      preparationId: 'prep-a', handoffId: handoff.id, invoiceId: 'invoice-a', chainId: 196,
      transactionHash: `0x${'c'.repeat(64)}` as `0x${string}`,
    });
    expect(submission?.submittedAt).toBe(expiresAt);
    expect(await repository.getHandoff(handoff.id)).toMatchObject({ handoffStartedAt: '2026-09-23T00:00:59.000Z' });
  });

  it('does not authorize a wallet handoff after expiry', async () => {
    const repository = new InMemoryMainnetReconciliationRepository(() => new Date(expiresAt));
    await repository.savePreparation(timedPreparation('prep-expired', 'invoice-expired'));
    expect(await repository.createHandoff({ preparationId: 'prep-expired', invoiceId: 'invoice-expired', buyer, chainId: 196, preparationHash, calldataHash })).toBeNull();
  });
});
