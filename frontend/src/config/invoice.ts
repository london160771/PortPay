import type { InvoiceStatus } from './api';

export type InvoiceRoute =
  | { type: 'dashboard' }
  | { type: 'merchantInvoice'; invoiceId: string }
  | { type: 'pay'; invoiceId: string }
  | { type: 'docs'; slug: 'index' | 'getting-started' | 'how-it-works' | 'merchant-integration' | 'testnet' };

export function readInvoiceRoute(pathname: string): InvoiceRoute {
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
    try {
      return { type: 'pay', invoiceId: payMatch[1] ? decodeURIComponent(payMatch[1]) : '' };
    } catch {
      return { type: 'pay', invoiceId: '' };
    }
  }

  const docsMatch = pathname.match(/^\/docs(?:\/([^/]+))?\/?$/);
  if (docsMatch) {
    const slug = docsMatch[1] || 'index';
    if (slug === 'getting-started' || slug === 'how-it-works' || slug === 'merchant-integration' || slug === 'testnet') {
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

export function showBuyerSelectionDetails(view: 'buyer' | 'merchant'): boolean {
  return view === 'buyer';
}
