import { describe, expect, it } from 'vitest';
import { invoiceStatusLabel, paymentStatusLabel, paymentSuccessLabel, readInvoiceRoute, showBuyerSelectionDetails } from './invoice';
import { resolveBackendUrl } from './api';

describe('invoice link routing', () => {
  it('resolves a payment URL invoice ID and handles a missing ID', () => {
    expect(readInvoiceRoute('/pay/123')).toEqual({ type: 'pay', invoiceId: '123', paymentNetwork: 'testnet' });
    expect(readInvoiceRoute('/invoice/123')).toEqual({ type: 'pay', invoiceId: '123', paymentNetwork: 'testnet' });
    expect(readInvoiceRoute('/pay/123', '?network=mainnet')).toEqual({ type: 'pay', invoiceId: '123', paymentNetwork: 'mainnet' });
    expect(readInvoiceRoute('/pay/123', '?network=unknown')).toEqual({ type: 'pay', invoiceId: '123', paymentNetwork: 'testnet' });
    expect(readInvoiceRoute('/pay/')).toEqual({ type: 'pay', invoiceId: '', paymentNetwork: 'testnet' });
    expect(readInvoiceRoute('/merchant/invoices/123')).toEqual({ type: 'merchantInvoice', invoiceId: '123' });
    expect(readInvoiceRoute('/docs/merchant-integration')).toEqual({ type: 'docs', slug: 'merchant-integration' });
    expect(readInvoiceRoute('/merchant')).toEqual({ type: 'dashboard' });
    expect(readInvoiceRoute('/')).toEqual({ type: 'dashboard' });
  });

  it('labels both persisted invoice states', () => {
    expect(invoiceStatusLabel('pending')).toBe('Waiting for payment');
    expect(invoiceStatusLabel('paid')).toBe('Payment received');
    expect(paymentSuccessLabel('buyer')).toBe('Payment sent');
    expect(paymentSuccessLabel('merchant')).toBe('Payment received');
    expect(paymentStatusLabel('buyer', 'paid')).toBe('Payment confirmed');
    expect(paymentStatusLabel('buyer', 'paid')).not.toBe('Payment received');
    expect(paymentStatusLabel('merchant', 'paid')).toBe('Payment received');
    expect(showBuyerSelectionDetails('buyer')).toBe(true);
    expect(showBuyerSelectionDetails('merchant')).toBe(false);
  });

  it('requires an explicit backend URL for a production build', () => {
    expect(resolveBackendUrl(undefined, false)).toBe('http://localhost:3001');
    expect(resolveBackendUrl('https://api.example.test/', true)).toBe('https://api.example.test');
    expect(() => resolveBackendUrl(undefined, true)).toThrow('VITE_BACKEND_URL is required');
  });
});
