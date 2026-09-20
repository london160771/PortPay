import type { Invoice, InvoiceRepository } from './types.js';
import type { ReconcilePaymentInput, SettlementAdapter } from '../settlement/types.js';
import { InvoiceNotPayableError } from '../settlement/types.js';

export async function reconcileInvoicePayment(
  repository: InvoiceRepository,
  adapter: SettlementAdapter,
  invoice: Invoice,
  input: ReconcilePaymentInput,
): Promise<Invoice> {
  if (invoice.status === 'paid') {
    if (invoice.paymentTxHash?.toLowerCase() === input.txHash.toLowerCase()) return invoice;
    throw new InvoiceNotPayableError();
  }

  const evidence = await adapter.reconcilePayment(invoice, input);
  const updated = await repository.markPaid(invoice.id, evidence);
  if (updated) return updated;

  const current = await repository.findById(invoice.id);
  if (current?.status === 'paid' && current.paymentTxHash?.toLowerCase() === evidence.paymentTxHash.toLowerCase()) {
    return current;
  }
  if (current?.status === 'paid') throw new InvoiceNotPayableError();
  throw new Error('Invoice status could not be reconciled after settlement confirmation.');
}
