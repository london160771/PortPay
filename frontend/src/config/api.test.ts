import { describe, expect, it, vi } from 'vitest';
import { invoiceStatusLabel, paymentStatusLabel, paymentSuccessLabel, readInvoiceRoute, showBuyerSelectionDetails } from './invoice';
import { recoverMainnetSubmission, reconcileMainnetPayment, recordMainnetSubmission, recheckMainnetReadiness, resolveBackendUrl } from './api';

describe('invoice link routing', () => {
  it('resolves a payment URL invoice ID and handles a missing ID', () => {
    expect(readInvoiceRoute('/pay/123')).toEqual({ type: 'pay', invoiceId: '123', paymentNetwork: 'mainnet' });
    expect(readInvoiceRoute('/invoice/123')).toEqual({ type: 'pay', invoiceId: '123', paymentNetwork: 'mainnet' });
    expect(readInvoiceRoute('/pay/123', '?network=mainnet')).toEqual({ type: 'pay', invoiceId: '123', paymentNetwork: 'mainnet' });
    expect(readInvoiceRoute('/pay/123', '?network=unknown')).toEqual({ type: 'pay', invoiceId: '123', paymentNetwork: 'mainnet' });
    expect(readInvoiceRoute('/pay/')).toEqual({ type: 'pay', invoiceId: '', paymentNetwork: 'mainnet' });
    expect(readInvoiceRoute('/pay/123', '?network=testnet')).toEqual({ type: 'pay', invoiceId: '123', paymentNetwork: 'mainnet' });
    expect(readInvoiceRoute('/pay/123', '?network=testnet', { allowInternalTestnet: true }))
      .toEqual({ type: 'pay', invoiceId: '123', paymentNetwork: 'testnet' });
    expect(readInvoiceRoute('/docs/testnet')).toMatchObject({ type: 'docs', slug: 'index' });
    expect(readInvoiceRoute('/docs/testnet', '', { allowInternalTestnet: true }))
      .toEqual({ type: 'docs', slug: 'testnet' });
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

describe('Mainnet wallet handoff API boundary', () => {
  it('sends persisted preparation identity and buyer authorization to the readiness recheck', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'READY', ready: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await recheckMainnetReadiness('invoice/one', 'prep-1', '0xbuyer', '0xsignature');
      expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/invoices/invoice%2Fone/mainnet/readiness-recheck');
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ preparationId: 'prep-1', buyerAddress: '0xbuyer', buyerSignature: '0xsignature' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('binds the observed transaction hash to the server handoff, then reconciles by preparation and hash', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'submitted' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'CONFIRMING' }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await recordMainnetSubmission('invoice-1', 'prep-1', 'handoff-1', '0xabc');
      await reconcileMainnetPayment('invoice-1', 'prep-1', '0xabc');
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ preparationId: 'prep-1', handoffId: 'handoff-1', txHash: '0xabc' });
      expect(fetchMock.mock.calls[0]?.[0]).toContain('/mainnet/submitted');
      expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ preparationId: 'prep-1', txHash: '0xabc' });
      expect(fetchMock.mock.calls[1]?.[0]).toContain('/mainnet/reconcile');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('recovers a submission by invoice/preparation/buyer without accepting a client transaction hash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ submission: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await recoverMainnetSubmission('invoice-1', 'prep-1', '0xbuyer');
      expect(fetchMock.mock.calls[0]?.[0]).toContain('/mainnet/submission-recovery');
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ preparationId: 'prep-1', buyerAddress: '0xbuyer' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
