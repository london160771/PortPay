import type { InvoiceStatus } from './api';

export type InvoiceRoute =
  | { type: 'dashboard' }
  | { type: 'invoice'; invoiceId: string };

export function readInvoiceRoute(pathname: string): InvoiceRoute {
  if (pathname === '/invoice' || pathname === '/invoice/') {
    return { type: 'invoice', invoiceId: '' };
  }

  const match = pathname.match(/^\/invoice\/([^/]+)\/?$/);
  if (!match) return { type: 'dashboard' };

  try {
    return { type: 'invoice', invoiceId: decodeURIComponent(match[1]) };
  } catch {
    return { type: 'invoice', invoiceId: '' };
  }
}

export function invoiceStatusLabel(status: InvoiceStatus): string {
  return status === 'paid' ? 'Payment received' : 'Waiting for payment';
}
