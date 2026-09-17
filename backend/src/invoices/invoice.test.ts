import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { InMemoryInvoiceRepository } from './repository.js';
import type { Invoice } from './types.js';

const MERCHANT = '0x1111111111111111111111111111111111111111';
const OTHER_MERCHANT = '0x2222222222222222222222222222222222222222';

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
});
