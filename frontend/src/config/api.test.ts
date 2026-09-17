import { describe, expect, it } from 'vitest';
import { invoiceStatusLabel, readInvoiceRoute } from './invoice';

describe('invoice link routing', () => {
  it('resolves a payment URL invoice ID and handles a missing ID', () => {
    expect(readInvoiceRoute('/invoice/123')).toEqual({ type: 'invoice', invoiceId: '123' });
    expect(readInvoiceRoute('/invoice/')).toEqual({ type: 'invoice', invoiceId: '' });
    expect(readInvoiceRoute('/')).toEqual({ type: 'dashboard' });
  });

  it('labels both persisted invoice states', () => {
    expect(invoiceStatusLabel('pending')).toBe('Waiting for payment');
    expect(invoiceStatusLabel('paid')).toBe('Payment received');
  });
});
