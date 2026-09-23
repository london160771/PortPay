const allowedReadOnlyMethods = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBlockByNumber',
  'eth_getBalance',
  'eth_call',
  'eth_estimateGas',
  'eth_gasPrice',
]);

type JsonRpcRequest = { method?: unknown };

export function assertReadOnlyHttpMethod(method: string | undefined): void {
  if (method !== undefined && method.toUpperCase() !== 'GET') {
    throw new Error('Local preflight allows only read-only HTTP GET requests.');
  }
}

/** Rejects malformed, unknown, and state-changing JSON-RPC methods before transport. */
export function assertReadOnlyRpcPayload(body: unknown): void {
  if (typeof body !== 'string') throw new Error('Read-only RPC guard rejected a non-string request body.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('Read-only RPC guard rejected malformed JSON.');
  }

  const requests = Array.isArray(parsed) ? parsed : [parsed];
  if (requests.length === 0 || requests.some((request) => typeof request !== 'object' || request === null || Array.isArray(request))) {
    throw new Error('Read-only RPC guard rejected an invalid JSON-RPC request.');
  }

  for (const request of requests as JsonRpcRequest[]) {
    if (typeof request.method !== 'string' || !allowedReadOnlyMethods.has(request.method)) {
      throw new Error(`Read-only RPC guard rejected method ${String(request.method)}.`);
    }
  }
}

export function createReadOnlyRpcFetch(fetchFn: typeof fetch = globalThis.fetch): typeof fetch {
  return async (input, init) => {
    assertReadOnlyRpcPayload(init?.body);
    return fetchFn(input, init);
  };
}
