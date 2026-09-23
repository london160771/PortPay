import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InMemoryMainnetReconciliationRepository, SupabaseMainnetReconciliationRepository, type MainnetPreparationEvidence, type MainnetSettlementClaim } from './mainnetReconciliationRepository.js';

function preparation(id: string, invoiceId: string): MainnetPreparationEvidence {
  return { id, invoiceId, chainId: 196 } as MainnetPreparationEvidence;
}
function claim(preparationId: string, invoiceId: string, transactionHash: string): MainnetSettlementClaim {
  return { preparationId, invoiceId, chainId: 196, transactionHash } as MainnetSettlementClaim;
}

describe('atomic mainnet settlement repository claims', () => {
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
    await expect(repository.claimSettlement(attempt)).resolves.toBe(true);
    await expect(repository.claimSettlement(attempt)).resolves.toBe(false);
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
});
