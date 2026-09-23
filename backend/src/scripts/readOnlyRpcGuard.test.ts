import { describe, expect, it, vi } from 'vitest';
import { assertReadOnlyHttpMethod, assertReadOnlyRpcPayload, createReadOnlyRpcFetch } from './readOnlyRpcGuard.js';

describe('local mainnet read-only RPC guard', () => {
  it('allows the read and simulation methods used by the mainnet preflight', () => {
    const methods = ['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBalance', 'eth_call', 'eth_estimateGas', 'eth_gasPrice'];
    expect(() => assertReadOnlyRpcPayload(JSON.stringify(methods.map((method, id) => ({ jsonrpc: '2.0', id, method, params: [] }))))).not.toThrow();
  });

  it.each(['eth_sendTransaction', 'eth_sendRawTransaction', 'wallet_sendCalls', 'personal_sign', 'unknown_method'])(
    'rejects %s before making a network request', async (method) => {
      const fetchFn = vi.fn(async () => new Response('{}'));
      const guardedFetch = createReadOnlyRpcFetch(fetchFn as unknown as typeof fetch);
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] });

      await expect(guardedFetch('https://rpc.example.invalid', { method: 'POST', body })).rejects.toThrow('Read-only RPC guard rejected method');
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it('rejects an entire batch if any request is state-changing', () => {
    const body = JSON.stringify([
      { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [] },
      { jsonrpc: '2.0', id: 2, method: 'eth_sendRawTransaction', params: [] },
    ]);
    expect(() => assertReadOnlyRpcPayload(body)).toThrow('Read-only RPC guard rejected method eth_sendRawTransaction.');
  });

  it('rejects malformed request payloads', () => {
    expect(() => assertReadOnlyRpcPayload('{not-json')).toThrow('Read-only RPC guard rejected malformed JSON.');
    expect(() => assertReadOnlyRpcPayload(JSON.stringify({ jsonrpc: '2.0', id: 1, params: [] }))).toThrow('Read-only RPC guard rejected method undefined.');
  });

  it('allows OKX GET requests and rejects non-GET methods', () => {
    expect(() => assertReadOnlyHttpMethod('GET')).not.toThrow();
    expect(() => assertReadOnlyHttpMethod(undefined)).not.toThrow();
    expect(() => assertReadOnlyHttpMethod('POST')).toThrow('Local preflight allows only read-only HTTP GET requests.');
  });
});
