import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Invoice } from '../invoices/types.js';
import { validateWebhookUrl, type MerchantCredential } from '../config/runtime.js';

export type PaymentConfirmedWebhookEvent = {
  id: string;
  type: 'payment.confirmed';
  invoiceId: string;
  externalOrderReference?: string;
  requestedAmountUsdt0: string;
  paymentStatus: 'paid';
  settlementTransactionHash: string;
  buyerAddress: string;
  spentAsset: string;
  spentAmount: string;
  stablecoinReceived: string;
  quoteId: string;
  settlementContract: string;
  settlementBlockNumber: string;
  timestamp: string;
};

export type WebhookFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

const deliveredEventIds = new Set<string>();
const inFlightDeliveries = new Map<string, Promise<PaymentConfirmedWebhookEvent>>();

export function buildPaymentConfirmedEvent(invoice: Invoice): PaymentConfirmedWebhookEvent | undefined {
  if (
    invoice.status !== 'paid' || !invoice.paymentTxHash || !invoice.paidAt || !invoice.buyerAddress
    || !invoice.spentAsset || !invoice.spentAmount || !invoice.stablecoinReceived || !invoice.quoteId
    || !invoice.settlementContract || !invoice.settlementBlockNumber
  ) return undefined;

  return {
    id: `payment.confirmed:${invoice.id}:${invoice.paymentTxHash.toLowerCase()}`,
    type: 'payment.confirmed',
    invoiceId: invoice.id,
    ...(invoice.externalOrderReference ? { externalOrderReference: invoice.externalOrderReference } : {}),
    requestedAmountUsdt0: invoice.amountUsdt0,
    paymentStatus: 'paid',
    settlementTransactionHash: invoice.paymentTxHash,
    buyerAddress: invoice.buyerAddress,
    spentAsset: invoice.spentAsset,
    spentAmount: invoice.spentAmount,
    stablecoinReceived: invoice.stablecoinReceived,
    quoteId: invoice.quoteId,
    settlementContract: invoice.settlementContract,
    settlementBlockNumber: invoice.settlementBlockNumber,
    timestamp: invoice.paidAt,
  };
}

export function signWebhookPayload(secret: string, payload: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

export function verifyWebhookSignature(secret: string, payload: string, signature: string): boolean {
  const expected = signWebhookPayload(secret, payload);
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(signature);
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

export async function deliverPaymentConfirmedWebhook(
  credential: MerchantCredential,
  invoice: Invoice,
  fetchImpl: WebhookFetch = fetch,
): Promise<PaymentConfirmedWebhookEvent | undefined> {
  const event = buildPaymentConfirmedEvent(invoice);
  if (!event || !credential.webhookUrl || !credential.webhookSecret) return event;
  if (deliveredEventIds.has(event.id)) return event;
  const inFlight = inFlightDeliveries.get(event.id);
  if (inFlight) return inFlight;

  const delivery = (async () => {
    const webhookUrl = validateWebhookUrl(credential.webhookUrl!);
    const payload = JSON.stringify(event);
    const signature = signWebhookPayload(credential.webhookSecret!, payload);
    const delaysMs = [0, 250, 750];
    let lastError: Error | undefined;

    for (const delayMs of delaysMs) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        const response = await fetchImpl(webhookUrl, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(5_000),
          headers: {
            'content-type': 'application/json',
            'x-portpay-event': event.type,
            'x-portpay-event-id': event.id,
            'idempotency-key': event.id,
            'x-portpay-signature': signature,
          },
          body: payload,
        });
        if (response.ok) {
          deliveredEventIds.add(event.id);
          return event;
        }
        lastError = new Error(`Webhook endpoint returned HTTP ${response.status}.`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Webhook delivery failed.');
      }
    }

    throw lastError ?? new Error('Webhook delivery failed.');
  })();
  inFlightDeliveries.set(event.id, delivery);
  try {
    return await delivery;
  } finally {
    inFlightDeliveries.delete(event.id);
  }
}
