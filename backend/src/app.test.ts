import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { InMemoryInvoiceRepository } from './invoices/repository.js';
import type { Invoice } from './invoices/types.js';
import { MainnetReceiptVerificationError } from './settlement/mainnetReceipt.js';

const invoice: Invoice = {
  id: '00000000-0000-4000-8000-000000000001', title: 'Mainnet approval test', amountUsdt0: '1',
  merchantAddress: '0x815c2fb8178f0bf80ada8c5b97ff44ece90e6e25',
  paymentUrl: 'http://localhost:5173/pay/00000000-0000-4000-8000-000000000001', status: 'pending', paymentNetwork: 'x-layer-mainnet',
  createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z',
};

async function withServer<T>(app: ReturnType<typeof createApp>, callback: (baseUrl: string) => Promise<T>) {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not expose its port.');
  try { return await callback(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

describe('backend routes', () => {
  it('exposes receipt/history routes alongside the existing invoice and settlement routes', () => {
    const app = createApp(new InMemoryInvoiceRepository());
    const expressApp = app as unknown as {
      _router?: { stack?: Array<{ route?: { path?: string } }> };
      router?: { stack?: Array<{ route?: { path?: string } }> };
    };
    const routes = expressApp.router?.stack ?? expressApp._router?.stack ?? [];
    const paths = routes.flatMap((layer) => (layer.route?.path ? [layer.route.path] : []));
    expect(paths).toContain('/health');
    expect(paths).toContain('/api/invoices');
    expect(paths).toContain('/api/invoices/:invoiceId');
    expect(paths).toContain('/api/invoices/:invoiceId/quote');
    expect(paths).toContain('/api/invoices/:invoiceId/mainnet/approval-preparation');
    expect(paths).toContain('/api/invoices/:invoiceId/mainnet/readiness-recheck');
    expect(paths).toContain('/api/invoices/:invoiceId/mainnet/submitted');
    expect(paths).toContain('/api/invoices/:invoiceId/mainnet/submission-recovery');
    expect(paths).toContain('/api/invoices/:invoiceId/mainnet/reconcile');
    expect(paths).toContain('/api/invoices/:invoiceId/reconcile');
    expect(paths).toContain('/api/history/merchant');
    expect(paths).toContain('/api/history/buyer');
    expect(paths).toContain('/api/integration/invoices');
    expect(paths).toContain('/api/integration/invoices/:invoiceId/status');
  });

  it('keeps testnet settlement routes and invoice selection unavailable in production', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const repository = new InMemoryInvoiceRepository();
      const app = createApp(repository, undefined, { enableInternalTestnet: true });
      const expressApp = app as unknown as { router?: { stack?: Array<{ route?: { path?: string } }> } };
      const paths = (expressApp.router?.stack ?? []).flatMap((layer) => layer.route?.path ? [layer.route.path] : []);
      expect(paths).not.toContain('/api/invoices/:invoiceId/quote');
      expect(paths).not.toContain('/api/invoices/:invoiceId/reconcile');

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/invoices`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Mainnet only', amountUsdt0: '1', merchantAddress: invoice.merchantAddress, paymentNetwork: 'x-layer-testnet' }),
        });
        expect(response.status).toBe(201);
        expect((await response.json()).invoice.paymentNetwork).toBe('x-layer-mainnet');
      });
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('serves mainnet approval preparation through its isolated injected service', async () => {
    const repository = new InMemoryInvoiceRepository();
    await repository.create(invoice);
    let requestedBuyer = '';
    const app = createApp(repository, undefined, {
      mainnetApprovalPreparation: async (requestedInvoice, buyerAddress) => {
        expect(requestedInvoice.id).toBe(invoice.id);
        requestedBuyer = buyerAddress;
        return { status: 'APPROVAL_REQUIRED', reason: 'Exact approval simulated.' };
      },
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invoices/${invoice.id}/mainnet/approval-preparation`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ buyerAddress: '0xbabdfef588cf57efcc7c8857960e3ccdd9167589' }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'APPROVAL_REQUIRED', reason: 'Exact approval simulated.' });
    });

    expect(requestedBuyer.toLowerCase()).toBe('0xbabdfef588cf57efcc7c8857960e3ccdd9167589');
  });

  it('recovers only the server-recorded submission for the supplied invoice, preparation, and buyer', async () => {
    const repository = new InMemoryInvoiceRepository();
    await repository.create(invoice);
    const calls: unknown[][] = [];
    const submission = {
      status: 'submitted' as const, preparationId: '00000000-0000-4000-8000-000000000002',
      handoffId: '00000000-0000-4000-8000-000000000003', transactionHash: `0x${'a'.repeat(64)}` as `0x${string}`,
      submittedAt: '2026-09-23T00:00:10.000Z', expiresAt: '2026-09-23T00:01:00.000Z',
    };
    const app = createApp(repository, undefined, {
      mainnetPayment: {
        async getAttemptStatus() { return 'none' as const; },
        async recheck() { throw new Error('not expected'); },
        async recordSubmission() { throw new Error('not expected'); },
        async recoverSubmission(...args: unknown[]) { calls.push(args); return submission; },
        async reconcile() { throw new Error('not expected'); },
      },
    });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invoices/${invoice.id}/mainnet/submission-recovery`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparationId: submission.preparationId, buyerAddress: '0xbabdfef588cf57efcc7c8857960e3ccdd9167589', transactionHash: `0x${'f'.repeat(64)}` }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ submission });
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(1)).toEqual([submission.preparationId, '0xbabdfef588cf57efcc7c8857960e3ccdd9167589']);
  });

  it('shows an unresolved one-shot Mainnet handoff to the merchant without marking the invoice paid', async () => {
    const repository = new InMemoryInvoiceRepository();
    await repository.create(invoice);
    const app = createApp(repository, undefined, {
      mainnetPayment: {
        async getAttemptStatus() { return 'unresolved' as const; },
        async recheck() { throw new Error('not expected'); },
        async recordSubmission() { throw new Error('not expected'); },
        async recoverSubmission() { return null; },
        async reconcile() { throw new Error('not expected'); },
      },
    });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invoices/${invoice.id}`);
      expect(response.status).toBe(200);
      expect((await response.json()).invoice).toMatchObject({ status: 'pending', mainnetAttemptStatus: 'unresolved' });
    });
    expect(await repository.findById(invoice.id)).toMatchObject({ status: 'pending' });
  });

  it('rejects mainnet preparation for missing or non-pending invoices before calling the service', async () => {
    const repository = new InMemoryInvoiceRepository();
    const alreadyPaid = { ...invoice, id: '00000000-0000-4000-8000-000000000002', status: 'paid' as const };
    await repository.create(alreadyPaid);
    let calls = 0;
    const app = createApp(repository, undefined, {
      mainnetApprovalPreparation: async () => { calls += 1; return { status: 'APPROVAL_REQUIRED', reason: 'not expected' }; },
    });
    await withServer(app, async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/api/invoices/00000000-0000-4000-8000-000000000099/mainnet/approval-preparation`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buyerAddress: '0xbabdfef588cf57efcc7c8857960e3ccdd9167589' }),
      });
      const paid = await fetch(`${baseUrl}/api/invoices/${alreadyPaid.id}/mainnet/approval-preparation`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buyerAddress: '0xbabdfef588cf57efcc7c8857960e3ccdd9167589' }),
      });
      expect(missing.status).toBe(404);
      expect(paid.status).toBe(409);
    });
    expect(calls).toBe(0);
  });

  it('keeps mainnet submission and reconciliation requests minimal and marks paid only after verifier success', async () => {
    const repository = new InMemoryInvoiceRepository();
    await repository.create(invoice);
    const paidWrite = vi.spyOn(repository, 'markPaid');
    const calls: unknown[][] = [];
    const txHash = `0x${'a'.repeat(64)}`;
    const mainnetPayment = {
      async getAttemptStatus() { return 'none' as const; },
      async recheck(...args: unknown[]) {
        calls.push(['recheck', ...args]);
        const preflightOnly = (args[4] as { preflightOnly?: boolean } | undefined)?.preflightOnly;
        return preflightOnly
          ? { status: 'PREFLIGHT_PASSED' as const, ready: false, reason: 'read-only gates passed', preparationId: '00000000-0000-4000-8000-000000000002', checkedAt: new Date().toISOString() }
          : { status: 'READY' as const, ready: true, reason: 'all gates passed', preparationId: '00000000-0000-4000-8000-000000000002', handoffId: '00000000-0000-4000-8000-000000000003', checkedAt: new Date().toISOString() };
      },
      async recordSubmission(...args: unknown[]) { calls.push(['submitted', ...args]); return { status: 'submitted' as const, preparationId: '00000000-0000-4000-8000-000000000002', handoffId: '00000000-0000-4000-8000-000000000003', transactionHash: txHash as `0x${string}`, submittedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30_000).toISOString() }; },
      async recoverSubmission() { return null; },
      async reconcile(...args: unknown[]) {
        calls.push(['reconcile', ...args]);
        const retry = (args[0] as Invoice).status === 'paid';
        if (!retry) await repository.markPaid(invoice.id, {
          paymentNetwork: 'x-layer-mainnet',
          paymentTxHash: txHash, paidAt: new Date().toISOString(), buyerAddress: '0xbabdfef588cf57efcc7c8857960e3ccdd9167589',
          spentAsset: '0xa8ddb5cd96b5222afe198316e9a57caa642850d5', spentAmount: '4800000000000000',
          stablecoinReceived: '1', quoteId: 'server-quote', settlementContract: '0x7c5bee2a8091c3ef39072f64f18fac913060aeaf', settlementBlockNumber: '100',
        });
        return {
          verification: {
            status: 'paid', invoiceId: invoice.id, paymentTxHash: txHash as `0x${string}`,
            buyer: '0xbabdfef588cf57efcc7c8857960e3ccdd9167589', merchant: invoice.merchantAddress,
            spentAsset: '0xa8ddb5cd96b5222afe198316e9a57caa642850d5', spentAmount: '4800000000000000',
            stablecoin: '0x779ded0c9e1022225f8e0630b35a9b54be713736', stablecoinReceived: '1000000',
            router: '0x7c5bee2a8091c3ef39072f64f18fac913060aeaf', blockNumber: '100', blockHash: `0x${'b'.repeat(64)}`,
            confirmationDepth: 2, builderCode: 'mainnetcode12345', builderCodeCheck: { status: 'VERIFIED' }, canonical: true, claimDisposition: retry ? 'already_paid' : 'claimed',
            balanceEvidence: {},
          },
          preparation: { quoteId: 'server-quote' },
        } as never;
      },
    };
    const app = createApp(repository, undefined, { mainnetPayment });
    const preparationId = '00000000-0000-4000-8000-000000000002';
    await withServer(app, async (baseUrl) => {
      const unsigned = await fetch(`${baseUrl}/api/invoices/${invoice.id}/mainnet/readiness-recheck`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparationId, buyerAddress: '0xbabdfef588cf57efcc7c8857960e3ccdd9167589' }),
      });
      expect(unsigned.status).toBe(400);
      const preflight = await fetch(`${baseUrl}/api/invoices/${invoice.id}/mainnet/readiness-recheck`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparationId, buyerAddress: '0xbabdfef588cf57efcc7c8857960e3ccdd9167589', preflightOnly: true }),
      });
      expect(preflight.status).toBe(200);
      expect((await preflight.json()).status).toBe('PREFLIGHT_PASSED');
      const recheck = await fetch(`${baseUrl}/api/invoices/${invoice.id}/mainnet/readiness-recheck`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparationId, buyerAddress: '0xbabdfef588cf57efcc7c8857960e3ccdd9167589', buyerSignature: `0x${'a'.repeat(130)}`, router: '0x1111111111111111111111111111111111111111' }),
      });
      expect(recheck.status).toBe(200);
      const submitted = await fetch(`${baseUrl}/api/invoices/${invoice.id}/mainnet/submitted`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparationId, handoffId: '00000000-0000-4000-8000-000000000003', txHash, merchantAddress: '0x1111111111111111111111111111111111111111', amount: '999' }),
      });
      expect(submitted.status).toBe(202);
      const invoiceBefore = await repository.findById(invoice.id);
      expect(invoiceBefore?.status).toBe('pending');
      const reconciled = await fetch(`${baseUrl}/api/invoices/${invoice.id}/mainnet/reconcile`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparationId, txHash, buyerAddress: '0x1111111111111111111111111111111111111111', calldata: '0xdeadbeef' }),
      });
      expect(reconciled.status).toBe(200);
      expect((await reconciled.json()).invoice.status).toBe('paid');
      expect(await repository.findById(invoice.id)).toMatchObject({ status: 'paid', paymentTxHash: txHash, quoteId: 'server-quote' });
      expect(paidWrite).toHaveBeenCalledTimes(1); // test service simulates the atomic DB RPC; the route performs no second write.
      const retry = await fetch(`${baseUrl}/api/invoices/${invoice.id}/mainnet/reconcile`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparationId, txHash }),
      });
      expect(retry.status).toBe(200);
      expect(calls.filter(([kind]) => kind === 'reconcile')).toHaveLength(2);
    });
    expect(calls.filter(([kind]) => kind === 'recheck')).toHaveLength(2);
    expect(calls[0]?.[5]).toMatchObject({ preflightOnly: true });
    expect(calls[1]?.[5]).toMatchObject({ preflightOnly: false });
    expect(calls[2]?.slice(1)).toHaveLength(4);
    expect(calls[3]?.slice(1)).toHaveLength(3);
    expect((calls[3]?.[1] as Invoice).id).toBe(invoice.id);
    expect(calls[3]?.[2]).toBe(preparationId);
    expect(calls[3]?.[3]).toBe(txHash);
  });

  it('does not mark a mainnet invoice paid when receipt verification reports a reverted transaction', async () => {
    const repository = new InMemoryInvoiceRepository();
    await repository.create(invoice);
    const mainnetPayment = {
      async getAttemptStatus() { return 'none' as const; },
      async recheck() { return { status: 'BLOCKED' as const, ready: false, reason: 'not relevant', preparationId: '00000000-0000-4000-8000-000000000002', checkedAt: new Date().toISOString() }; },
      async recordSubmission() { throw new Error('not relevant'); },
      async recoverSubmission() { return null; },
      async reconcile() { throw new MainnetReceiptVerificationError('FAILED_TRANSACTION', 'The mainnet transaction reverted.'); },
    };
    const app = createApp(repository, undefined, { mainnetPayment });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invoices/${invoice.id}/mainnet/reconcile`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparationId: '00000000-0000-4000-8000-000000000002', txHash: `0x${'f'.repeat(64)}` }),
      });
      expect(response.status).toBe(422);
      expect(await repository.findById(invoice.id)).toMatchObject({ status: 'pending' });
    });
  });

  it('does not accept a matching transaction hash as a paid retry for a legacy testnet invoice', async () => {
    const repository = new InMemoryInvoiceRepository();
    const txHash = `0x${'a'.repeat(64)}`;
    await repository.create({ ...invoice, status: 'paid', paymentNetwork: 'x-layer-testnet', paymentTxHash: txHash });
    let calls = 0;
    const app = createApp(repository, undefined, {
      mainnetPayment: {
        async getAttemptStatus() { return 'none' as const; },
        async recheck() { throw new Error('not expected'); },
        async recordSubmission() { throw new Error('not expected'); },
        async recoverSubmission() { return null; },
        async reconcile() { calls += 1; throw new Error('not expected'); },
      },
    });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invoices/${invoice.id}/mainnet/reconcile`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preparationId: '00000000-0000-4000-8000-000000000002', txHash }),
      });
      expect(response.status).toBe(409);
    });
    expect(calls).toBe(0);
  });
});
