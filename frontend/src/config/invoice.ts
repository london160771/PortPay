import type { InvoiceStatus } from './api';

export type InvoiceRoute =
  | { type: 'dashboard' }
  | { type: 'merchantInvoice'; invoiceId: string }
  | { type: 'pay'; invoiceId: string; paymentNetwork: 'testnet' | 'mainnet' }
  | { type: 'docs'; slug: 'index' | 'getting-started' | 'how-it-works' | 'merchant-integration' | 'testnet' };

export function readInvoiceRoute(
  pathname: string,
  search = '',
  options: { allowInternalTestnet?: boolean } = {},
): InvoiceRoute {
  if (pathname === '/' || pathname === '/merchant' || pathname === '/merchant/') return { type: 'dashboard' };

  const merchantMatch = pathname.match(/^\/merchant\/invoices(?:\/([^/]+))?\/?$/);
  if (merchantMatch) {
    try {
      return { type: 'merchantInvoice', invoiceId: merchantMatch[1] ? decodeURIComponent(merchantMatch[1]) : '' };
    } catch {
      return { type: 'merchantInvoice', invoiceId: '' };
    }
  }

  const payMatch = pathname.match(/^\/(?:pay|invoice)(?:\/([^/]+))?\/?$/);
  if (payMatch) {
    const paymentNetwork = options.allowInternalTestnet && new URLSearchParams(search).get('network') === 'testnet'
      ? 'testnet'
      : 'mainnet';
    try {
      return {
        type: 'pay',
        invoiceId: payMatch[1] ? decodeURIComponent(payMatch[1]) : '',
        paymentNetwork,
      };
    } catch {
      return { type: 'pay', invoiceId: '', paymentNetwork };
    }
  }

  const docsMatch = pathname.match(/^\/docs(?:\/([^/]+))?\/?$/);
  if (docsMatch) {
    const slug = docsMatch[1] || 'index';
    if (slug === 'getting-started' || slug === 'how-it-works' || slug === 'merchant-integration'
      || (slug === 'testnet' && options.allowInternalTestnet)) {
      return { type: 'docs', slug };
    }
    return { type: 'docs', slug: 'index' };
  }

  return { type: 'dashboard' };
}

export function invoiceStatusLabel(status: InvoiceStatus): string {
  return status === 'paid' ? 'Payment received' : 'Waiting for payment';
}

export function paymentSuccessLabel(role: 'buyer' | 'merchant'): string {
  return role === 'buyer' ? 'Payment sent' : 'Payment received';
}

export function paymentStatusLabel(role: 'buyer' | 'merchant', status: InvoiceStatus): string {
  if (status === 'pending') return 'Waiting for payment';
  return role === 'buyer' ? 'Payment confirmed' : 'Payment received';
}

export function showBuyerSelectionDetails(view: 'buyer' | 'merchant'): boolean {
  return view === 'buyer';
}
