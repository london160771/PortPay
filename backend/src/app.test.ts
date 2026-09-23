import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { InMemoryInvoiceRepository } from './invoices/repository.js';
import type { Invoice } from './invoices/types.js';

const invoice: Invoice = {
  id: '00000000-0000-4000-8000-000000000001', title: 'Mainnet approval test', amountUsdt0: '1',
  merchantAddress: '0x815c2fb8178f0bf80ada8c5b97ff44ece90e6e25',
  paymentUrl: 'http://localhost:5173/pay/00000000-0000-4000-8000-000000000001', status: 'pending',
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
    expect(paths).toContain('/api/invoices/:invoiceId/reconcile');
    expect(paths).toContain('/api/history/merchant');
    expect(paths).toContain('/api/history/buyer');
    expect(paths).toContain('/api/integration/invoices');
    expect(paths).toContain('/api/integration/invoices/:invoiceId/status');
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
});
