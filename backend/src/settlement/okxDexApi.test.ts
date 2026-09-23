import { describe, expect, it } from 'vitest';
import { OkxDexApiClient } from './okxDexApi.js';

describe('OkxDexApiClient', () => {
  it('authenticates server-side without exposing credential values in request output', async () => {
    let requestUrl = '';
    let requestHeaders: Headers | undefined;
    let redirect: RequestRedirect | undefined;
    const client = new OkxDexApiClient({
      apiKey: 'api-key-only-in-test',
      passphrase: 'passphrase-only-in-test',
      secretKey: 'secret-key-only-in-test',
      fetchFn: async (input, init) => {
        requestUrl = String(input);
        requestHeaders = new Headers(init?.headers);
        redirect = init?.redirect;
        return new Response(JSON.stringify({ code: '0', msg: '', data: [{ chainIndex: '196', chainName: 'X Layer', dexTokenApproveAddress: '0x1111111111111111111111111111111111111111', futureField: { ignored: true } }] }), { status: 200 });
      },
      now: () => new Date('2026-09-21T00:00:00.000Z'),
    });

    await expect(client.getSupportedChains()).resolves.toEqual(['196']);
    expect(requestUrl).toContain('/api/v6/dex/aggregator/supported/chain');
    expect(requestUrl).toMatch(/^https:\/\/web3\.okx\.com\//);
    expect(redirect).toBe('error');
    expect(requestHeaders?.get('OK-ACCESS-KEY')).toBe('api-key-only-in-test');
    expect(requestHeaders?.get('OK-ACCESS-SIGN')).toBeTruthy();
    expect(requestHeaders?.get('OK-ACCESS-PASSPHRASE')).toBe('passphrase-only-in-test');
    expect(requestHeaders?.get('OK-ACCESS-TIMESTAMP')).toBe('2026-09-21T00:00:00.000Z');
  });

  it('fails closed when server credentials are absent', async () => {
    const client = new OkxDexApiClient({ fetchFn: async () => new Response('{}') });
    await expect(client.getSupportedChains()).rejects.toThrow('OKX_DEX_API_KEY is required');
  });

  it('rejects malformed authenticated API response data before the adapter can use it', async () => {
    const client = new OkxDexApiClient({
      apiKey: 'key',
      passphrase: 'passphrase',
      secretKey: 'secret',
      fetchFn: async () => new Response(JSON.stringify({
        code: '0',
        msg: '',
        data: [{ chainIndex: 196 }],
      }), { status: 200 }),
    });
    await expect(client.getSupportedChains()).rejects.toThrow('invalid chain payload');
  });

  it('rejects a success response with a malformed envelope', async () => {
    const client = new OkxDexApiClient({
      apiKey: 'key',
      passphrase: 'passphrase',
      secretKey: 'secret',
      fetchFn: async () => new Response(JSON.stringify({ code: 0, data: [] }), { status: 200 }),
    });
    await expect(client.getSupportedChains()).rejects.toThrow('invalid response envelope');
  });
});
