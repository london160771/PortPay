import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { InMemoryInvoiceRepository } from './repository.js';
import type { Invoice } from './types.js';
import type { SettlementAdapter } from '../settlement/types.js';

const MERCHANT = '0x1111111111111111111111111111111111111111';
const OTHER_MERCHANT = '0x2222222222222222222222222222222222222222';
const BUYER = '0x3333333333333333333333333333333333333333';

async function withServer<T>(app: ReturnType<typeof createApp>, callback: (baseUrl: string) => Promise<T>) {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not expose a port.');

  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

describe('merchant invoice API', () => {
  it('creates, persists, lists, and resolves an invoice through its payment link ID', async () => {
    const repository = new InMemoryInvoiceRepository();
    const app = createApp(repository);

    await withServer(app, async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/api/invoices`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Harbor design consultation',
          amountUsdt0: '20.00',
          merchantAddress: MERCHANT,
        }),
      });
      const created = (await createResponse.json()) as { invoice: Invoice };

      expect(createResponse.status).toBe(201);
      expect(created.invoice.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.invoice.amountUsdt0).toBe('20');
      expect(created.invoice.merchantAddress).toBe(MERCHANT);
      expect(created.invoice.status).toBe('pending');
      expect(created.invoice.paymentUrl).toBe(`http://localhost:5173/invoice/${created.invoice.id}`);
      expect(await repository.findById(created.invoice.id)).toEqual(created.invoice);

      const listResponse = await fetch(`${baseUrl}/api/invoices?merchantAddress=${MERCHANT}`);
      const listed = (await listResponse.json()) as { invoices: Invoice[] };
      expect(listResponse.status).toBe(200);
      expect(listed.invoices).toHaveLength(1);
      expect(listed.invoices[0].id).toBe(created.invoice.id);

      const detailResponse = await fetch(`${baseUrl}/api/invoices/${created.invoice.id}`);
      const detail = (await detailResponse.json()) as { invoice: Invoice };
      expect(detailResponse.status).toBe(200);
      expect(detail.invoice).toEqual(created.invoice);
    });
  });

  it('rejects missing or invalid invoice input and IDs cleanly', async () => {
    const app = createApp(new InMemoryInvoiceRepository());

    await withServer(app, async (baseUrl) => {
      const invalidResponse = await fetch(`${baseUrl}/api/invoices`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: ' ', amountUsdt0: '-1', merchantAddress: 'bad' }),
      });
      const invalid = (await invalidResponse.json()) as { error: string };
      expect(invalidResponse.status).toBe(400);
      expect(invalid.error).toContain('title');

      const invalidAmountResponse = await fetch(`${baseUrl}/api/invoices`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Valid title', amountUsdt0: '20.1234567', merchantAddress: MERCHANT }),
      });
      const invalidAmount = (await invalidAmountResponse.json()) as { error: string };
      expect(invalidAmountResponse.status).toBe(400);
      expect(invalidAmount.error).toContain('Amount');

      const invalidIdResponse = await fetch(`${baseUrl}/api/invoices/not-a-uuid`);
      expect(invalidIdResponse.status).toBe(400);

      const missingIdResponse = await fetch(`${baseUrl}/api/invoices/00000000-0000-4000-8000-000000000000`);
      expect(missingIdResponse.status).toBe(404);

      const missingMerchantResponse = await fetch(`${baseUrl}/api/invoices`);
      expect(missingMerchantResponse.status).toBe(400);
    });
  });

  it('returns persisted paid status without exposing a manual payment mutation', async () => {
    const repository = new InMemoryInvoiceRepository();
    const paidInvoice: Invoice = {
      id: '00000000-0000-4000-8000-000000000001',
      title: 'Already confirmed by a later phase',
      amountUsdt0: '1',
      merchantAddress: OTHER_MERCHANT,
      paymentUrl: 'http://localhost:5173/invoice/00000000-0000-4000-8000-000000000001',
      status: 'paid',
      createdAt: '2026-09-17T00:00:00.000Z',
      updatedAt: '2026-09-17T00:00:00.000Z',
    };
    await repository.create(paidInvoice);

    await withServer(createApp(repository), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/invoices/${paidInvoice.id}`);
      const body = (await response.json()) as { invoice: Invoice };
      expect(response.status).toBe(200);
      expect(body.invoice.status).toBe('paid');
    });
  });

  it('issues a buyer quote and reconciles a confirmed adapter payment into paid status', async () => {
    const repository = new InMemoryInvoiceRepository();
    const adapter: SettlementAdapter = {
      name: 'TestnetSettlementAdapter',
      async createQuote(createdInvoice, buyerAddress) {
        return {
          invoiceId: createdInvoice.id,
          invoiceIdHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          quote: {
            invoiceId: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            buyer: buyerAddress as `0x${string}`,
            merchant: createdInvoice.merchantAddress as `0x${string}`,
            asset: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            assetAmount: '80000000000000000',
            stablecoin: '0xcccccccccccccccccccccccccccccccccccccccc',
            stablecoinAmount: '20000000',
            chainId: 1952,
            settlementContract: '0xdddddddddddddddddddddddddddddddddddddddd',
            expiry: '1893456000',
          },
          quoteId: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          signature: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          assetDecimals: 18,
          stablecoinDecimals: 6,
          assetAmount: '0.08',
          stablecoinAmount: '20',
          referencePriceUsd: '250.00',
          expiresAt: '2030-01-01T00:00:00.000Z',
        };
      },
      async reconcilePayment(createdInvoice, input) {
        return {
          paymentTxHash: input.txHash,
          paidAt: '2026-09-17T00:01:00.000Z',
          buyerAddress: input.buyerAddress,
          spentAsset: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          spentAmount: '80000000000000000',
          stablecoinReceived: createdInvoice.amountUsdt0,
          quoteId: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          settlementContract: '0xdddddddddddddddddddddddddddddddddddddddd',
          settlementBlockNumber: '42',
        };
      },
    };
    const app = createApp(repository, adapter);
    const buyer = '0x2222222222222222222222222222222222222222';
    const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

    await withServer(app, async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/api/invoices`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Coffee beans', amountUsdt0: '20', merchantAddress: MERCHANT }),
      });
      const created = (await createResponse.json()) as { invoice: Invoice };

      const quoteResponse = await fetch(`${baseUrl}/api/invoices/${created.invoice.id}/quote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ buyerAddress: buyer }),
      });
      expect(quoteResponse.status).toBe(200);

      const reconcileResponse = await fetch(`${baseUrl}/api/invoices/${created.invoice.id}/reconcile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txHash, buyerAddress: buyer }),
      });
      const reconciled = (await reconcileResponse.json()) as { invoice: Invoice };
      expect(reconcileResponse.status).toBe(200);
      expect(reconciled.invoice.status).toBe('paid');
      expect(reconciled.invoice.paymentTxHash).toBe(txHash);
      expect(reconciled.invoice.stablecoinReceived).toBe('20');

      const duplicateResponse = await fetch(`${baseUrl}/api/invoices/${created.invoice.id}/reconcile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txHash: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd', buyerAddress: buyer }),
      });
      expect(duplicateResponse.status).toBe(409);
    });
  });

  it('returns paid-only buyer and merchant history with settlement evidence', async () => {
    const repository = new InMemoryInvoiceRepository();
    const paidInvoice: Invoice = {
      id: '00000000-0000-4000-8000-000000000002',
      title: 'Phase 4 receipt test',
      amountUsdt0: '1',
      merchantAddress: MERCHANT,
      paymentUrl: 'http://localhost:5173/invoice/00000000-0000-4000-8000-000000000002',
      status: 'paid',
      createdAt: '2026-09-17T00:00:00.000Z',
      updatedAt: '2026-09-17T00:05:00.000Z',
      paymentTxHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      paidAt: '2026-09-17T00:05:00.000Z',
      buyerAddress: BUYER,
      spentAsset: '0x4444444444444444444444444444444444444444',
      spentAmount: '4000000000000000',
      stablecoinReceived: '1',
      quoteId: '0x5555555555555555555555555555555555555555555555555555555555555555',
      settlementContract: '0x6666666666666666666666666666666666666666',
      settlementBlockNumber: '42',
    };
    const pendingInvoice: Invoice = {
      ...paidInvoice,
      id: '00000000-0000-4000-8000-000000000003',
      title: 'Still waiting',
      status: 'pending',
      paymentUrl: 'http://localhost:5173/invoice/00000000-0000-4000-8000-000000000003',
      paymentTxHash: undefined,
      paidAt: undefined,
    };
    await repository.create(paidInvoice);
    await repository.create(pendingInvoice);

    await withServer(createApp(repository), async (baseUrl) => {
      const merchantResponse = await fetch(`${baseUrl}/api/history/merchant?merchantAddress=${MERCHANT}`);
      const merchantHistory = (await merchantResponse.json()) as { payments: Invoice[] };
      expect(merchantResponse.status).toBe(200);
      expect(merchantHistory.payments.map((payment) => payment.id)).toEqual([paidInvoice.id]);
      expect(merchantHistory.payments[0].paymentTxHash).toBe(paidInvoice.paymentTxHash);

      const buyerResponse = await fetch(`${baseUrl}/api/history/buyer?buyerAddress=${BUYER}`);
      const buyerHistory = (await buyerResponse.json()) as { payments: Invoice[] };
      expect(buyerResponse.status).toBe(200);
      expect(buyerHistory.payments).toHaveLength(1);
      expect(buyerHistory.payments[0].stablecoinReceived).toBe('1');

      const invalidResponse = await fetch(`${baseUrl}/api/history/buyer?buyerAddress=bad`);
      expect(invalidResponse.status).toBe(400);
      const missingResponse = await fetch(`${baseUrl}/api/history/merchant`);
      expect(missingResponse.status).toBe(400);
    });
  });
});
