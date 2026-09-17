import { describe, expect, it } from 'vitest';
import { app } from './app.js';

describe('backend foundation', () => {
  it('creates an Express application with only the foundation health route', () => {
    expect(app).toBeDefined();
    const expressApp = app as unknown as {
      _router?: { stack?: Array<{ route?: { path?: string } }> };
      router?: { stack?: Array<{ route?: { path?: string } }> };
    };
    const routes = expressApp.router?.stack ?? expressApp._router?.stack ?? [];
    const paths = routes.flatMap((layer) => (layer.route?.path ? [layer.route.path] : []));
    expect(paths).toContain('/health');
    expect(paths).not.toContain('/invoices');
  });
});
