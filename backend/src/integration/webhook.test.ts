import { describe, expect, it, vi } from 'vitest';
import {
  buildPaymentConfirmedEvent,
  deliverPaymentConfirmedWebhook,
  signWebhookPayload,
  verifyWebhookSignature,
} from './webhook.js';
import type { Invoice } from '../invoices/types.js';
import type { MerchantCredential } from '../config/runtime.js';

const paidInvoice: Invoice = {
  id: 'eb2eae24-f8c9-47b4-9a7f-20942fd83e6e',
  title: 'Website order',
  amountUsdt0: '1',
  merchantAddress: '0x815c2fb8178f0bf80ada8c5b97ff44ece90e6e25',
  externalOrderReference: 'order-1001',
  paymentUrl: 'http://localhost:5173/pay/eb2eae24-f8c9-47b4-9a7f-20942fd83e6e',
  status: 'paid',
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:01:00.000Z',
  paymentTxHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  paidAt: '2026-09-21T00:01:00.000Z',
  buyerAddress: '0xbabdfef588cf57efcc7c8857960e3ccdd9167589',
  spentAsset: '0x756546fce7d7ca3bb4be127904b002baf13b432e',
  spentAmount: '4000000000000000',
  stablecoinReceived: '1',
  quoteId: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  settlementContract: '0xeaab8d9507dcb3323c6045544d0bae546bfed90b',
  settlementBlockNumber: '41487796',
};

const credential: MerchantCredential = {
  environment: 'test',
  apiKey: 'server-only-test-key',
  merchantAddress: paidInvoice.merchantAddress,
  webhookUrl: 'https://merchant.example.test/webhooks/portpay',
  webhookSecret: 'server-only-webhook-secret',
};

describe('payment-confirmed webhooks', () => {
  it('builds a verified-payment-only event and signs it', () => {
    const event = buildPaymentConfirmedEvent(paidInvoice);
    expect(event).toMatchObject({
      type: 'payment.confirmed',
      invoiceId: paidInvoice.id,
      externalOrderReference: 'order-1001',
      requestedAmountUsdt0: '1',
      paymentStatus: 'paid',
      settlementTransactionHash: paidInvoice.paymentTxHash,
    });

    const payload = JSON.stringify(event);
    const signature = signWebhookPayload('secret', payload);
    expect(verifyWebhookSignature('secret', payload, signature)).toBe(true);
    expect(verifyWebhookSignature('wrong-secret', payload, signature)).toBe(false);
    expect(buildPaymentConfirmedEvent({ ...paidInvoice, status: 'pending', paymentTxHash: undefined })).toBeUndefined();
    expect(buildPaymentConfirmedEvent({ ...paidInvoice, quoteId: undefined })).toBeUndefined();
  });

  it('retries delivery and sends an idempotent signed event', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('retry', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const event = await deliverPaymentConfirmedWebhook(credential, paidInvoice, fetchImpl);
    expect(event?.id).toContain(`payment.confirmed:${paidInvoice.id}`);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstRequest = fetchImpl.mock.calls[0][1] as RequestInit;
    const secondRequest = fetchImpl.mock.calls[1][1] as RequestInit;
    expect(firstRequest.headers).toMatchObject({ 'x-portpay-event': 'payment.confirmed' });
    expect(firstRequest.redirect).toBe('error');
    expect(secondRequest.headers).toMatchObject({ 'idempotency-key': event?.id });
    expect(secondRequest.body).toBe(firstRequest.body);

    await deliverPaymentConfirmedWebhook(credential, paidInvoice, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent delivery and rejects private webhook destinations', async () => {
    const concurrentInvoice = {
      ...paidInvoice,
      id: '00000000-0000-4000-8000-000000000002',
      paymentTxHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    };
    let release: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    const first = deliverPaymentConfirmedWebhook(credential, concurrentInvoice, fetchImpl);
    const second = deliverPaymentConfirmedWebhook(credential, concurrentInvoice, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    release?.(new Response('ok', { status: 200 }));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    await expect(deliverPaymentConfirmedWebhook(
      { ...credential, webhookUrl: 'http://127.0.0.1/internal' },
      { ...concurrentInvoice, id: '00000000-0000-4000-8000-000000000003' },
      vi.fn(),
    )).rejects.toThrow('must use HTTPS');
  });
});
