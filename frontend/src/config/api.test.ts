import { describe, expect, it } from 'vitest';
import { invoiceStatusLabel, readInvoiceRoute } from './invoice';
import { resolveBackendUrl } from './api';

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

  it('requires an explicit backend URL for a production build', () => {
    expect(resolveBackendUrl(undefined, false)).toBe('http://localhost:3001');
    expect(resolveBackendUrl('https://api.example.test/', true)).toBe('https://api.example.test');
    expect(() => resolveBackendUrl(undefined, true)).toThrow('VITE_BACKEND_URL is required');
  });
});
