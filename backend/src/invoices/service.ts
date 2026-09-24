import { randomUUID } from 'node:crypto';
import type { Invoice, InvoiceRepository, PaymentNetwork } from './types.js';
import { validateCreateInvoiceInput } from './validation.js';

export function buildPaymentUrl(publicAppUrl: string, invoiceId: string): string {
  return `${publicAppUrl.replace(/\/$/, '')}/pay/${encodeURIComponent(invoiceId)}`;
}

export async function createInvoice(
  repository: InvoiceRepository,
  publicAppUrl: string,
  input: unknown,
  paymentNetwork: PaymentNetwork = 'x-layer-mainnet',
): Promise<Invoice> {
  const validated = validateCreateInvoiceInput(input);
  const now = new Date().toISOString();
  const id = randomUUID();

  return repository.create({
    id,
    title: validated.title,
    amountUsdt0: validated.amountUsdt0,
    merchantAddress: validated.merchantAddress,
    ...(validated.externalOrderReference ? { externalOrderReference: validated.externalOrderReference } : {}),
    paymentUrl: buildPaymentUrl(publicAppUrl, id),
    status: 'pending',
    paymentNetwork,
    createdAt: now,
    updatedAt: now,
  });
}
