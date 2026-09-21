import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { InMemoryInvoiceRepository } from './invoices/repository.js';

describe('backend routes', () => {
  it('exposes receipt/history routes alongside the existing invoice and settlement routes', () => {
    const app = createApp(new InMemoryInvoiceRepository());
    const expressApp = app as unknown as {
      _router?: { stack?: Array<{ route?: { path?: string } }> };
      router?: { stack?: Array<{ route?: { path?: string } }> };
    };
    const routes = expressApp.router?.stack ?? expressApp._router?.stack ?? [];
    const paths = routes.flatMap((layer) => (layer.route?.path ? [layer.route.path] : []));
    expect(paths).toContain('/health');
    expect(paths).toContain('/api/invoices');
    expect(paths).toContain('/api/invoices/:invoiceId');
    expect(paths).toContain('/api/invoices/:invoiceId/quote');
    expect(paths).toContain('/api/invoices/:invoiceId/reconcile');
    expect(paths).toContain('/api/history/merchant');
    expect(paths).toContain('/api/history/buyer');
    expect(paths).toContain('/api/integration/invoices');
    expect(paths).toContain('/api/integration/invoices/:invoiceId/status');
  });
});
