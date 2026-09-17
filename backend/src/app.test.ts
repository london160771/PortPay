import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { InMemoryInvoiceRepository } from './invoices/repository.js';

describe('backend Phase 2 routes', () => {
  it('exposes health and invoice routes without adding checkout routes', () => {
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
    expect(paths).not.toContain('/checkout');
  });
});
