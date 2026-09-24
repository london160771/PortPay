import { createHmac } from 'node:crypto';
import { mainnetOkxConfig, xLayerMainnet } from '../config/xlayerMainnet.js';

type FetchLike = typeof fetch;

export type OkxTokenSnapshot = { decimal: string; isHoneyPot: boolean; taxRate: string; tokenContractAddress: string; tokenSymbol: string; tokenUnitPrice: string };
export type OkxDexProtocol = { dexName: string; percent: string };
export type OkxDexRoute = { dexProtocol?: OkxDexProtocol | readonly OkxDexProtocol[]; fromToken: OkxTokenSnapshot; toToken: OkxTokenSnapshot; fromTokenIndex?: string; toTokenIndex?: string };
export type OkxQuoteData = { chainIndex: string; dexRouterList: readonly OkxDexRoute[]; estimateGasFee: string; fromToken: OkxTokenSnapshot; fromTokenAmount: string; mode?: string; priceImpactPercent?: string; quoteId?: string; router?: string; swapMode?: string; toToken: OkxTokenSnapshot; toTokenAmount: string; tradeFee: string };
export type OkxApprovalData = { data: `0x${string}`; dexContractAddress: string; gasLimit: string; gasPrice: string };
export type OkxSwapTransaction = { data: `0x${string}`; from: string; gas: string; gasPrice: string; maxPriorityFeePerGas?: string; minReceiveAmount: string; slippagePercent: string; to: string; value: string };
export type OkxSwapData = { routerResult: OkxQuoteData; tx: OkxSwapTransaction };
export type OkxQuoteRequest = { amount: string; fromTokenAddress: string; toTokenAddress: string };
export type OkxApprovalRequest = { approveAmount: string; tokenContractAddress: string };
export type OkxSwapRequest = OkxQuoteRequest & { slippagePercent: string; swapReceiverAddress: string; userWalletAddress: string };

export type OkxTransportFailure = {
  name: string;
  code?: string | number;
  causeName?: string;
  causeCode?: string | number;
};

export class OkxDexApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly apiCode?: string,
    readonly transportFailure?: OkxTransportFailure,
  ) { super(message); this.name = 'OkxDexApiError'; }
}

export type OkxDexApiClientOptions = { apiKey?: string; fetchFn?: FetchLike; now?: () => Date; passphrase?: string; secretKey?: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isDigits = (value: unknown): value is string => isString(value) && /^\d+$/.test(value);
const isHex = (value: unknown): value is `0x${string}` => isString(value) && /^0x(?:[0-9a-fA-F]{2})+$/.test(value);

function transportFailure(error: unknown): OkxTransportFailure {
  const outer = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  const cause = typeof outer.cause === 'object' && outer.cause !== null ? outer.cause as Record<string, unknown> : {};
  const safeName = (value: unknown): string => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(value) ? value : 'UnknownError';
  const safeCode = (value: unknown): string | number | undefined => {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
    if (typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value)) return value;
    return undefined;
  };
  const summary: OkxTransportFailure = { name: safeName(outer.name) };
  const code = safeCode(outer.code);
  const causeName = safeName(cause.name);
  const causeCode = safeCode(cause.code);
  if (code !== undefined) summary.code = code;
  if (causeName !== 'UnknownError') summary.causeName = causeName;
  if (causeCode !== undefined) summary.causeCode = causeCode;
  return summary;
}

function normalizeSupportedChainIndex(value: unknown): string | undefined {
  if (isDigits(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined;
}

function requiredSecret(name: string, value: string | undefined): string {
  if (!value?.trim()) throw new OkxDexApiError(`${name} is required for the server-side OKX DEX client.`);
  return value.trim();
}

function apiPath(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return query ? `${path}?${query}` : path;
}

function parseToken(value: unknown, label: string): OkxTokenSnapshot {
  if (!isRecord(value) || !isDigits(value.decimal) || typeof value.isHoneyPot !== 'boolean' || !isString(value.taxRate) || !isString(value.tokenContractAddress) || !isString(value.tokenSymbol) || !isString(value.tokenUnitPrice)) {
    throw new OkxDexApiError(`The OKX DEX API returned an invalid ${label}.`);
  }
  return value as OkxTokenSnapshot;
}

function parseRoute(value: unknown): OkxDexRoute {
  if (!isRecord(value)) throw new OkxDexApiError('The OKX DEX API returned an invalid route.');
  return { ...value, fromToken: parseToken(value.fromToken, 'route input token'), toToken: parseToken(value.toToken, 'route output token') } as OkxDexRoute;
}

function parseQuote(value: unknown): OkxQuoteData {
  if (!isRecord(value) || !isString(value.chainIndex) || !Array.isArray(value.dexRouterList) || !isDigits(value.estimateGasFee) || !isDigits(value.fromTokenAmount) || !isDigits(value.toTokenAmount) || !isString(value.tradeFee)) {
    throw new OkxDexApiError('The OKX DEX API returned an invalid quote payload.');
  }
  return { ...value, dexRouterList: value.dexRouterList.map(parseRoute), fromToken: parseToken(value.fromToken, 'input token'), toToken: parseToken(value.toToken, 'output token') } as unknown as OkxQuoteData;
}

function parseApproval(value: unknown): OkxApprovalData {
  if (!isRecord(value) || !isHex(value.data) || !isString(value.dexContractAddress) || !isDigits(value.gasLimit) || !isDigits(value.gasPrice)) {
    throw new OkxDexApiError('The OKX DEX API returned an invalid approval payload.');
  }
  return value as OkxApprovalData;
}

function parseSwap(value: unknown): OkxSwapData {
  if (!isRecord(value) || !isRecord(value.tx)) throw new OkxDexApiError('The OKX DEX API returned an invalid swap payload.');
  const tx = value.tx;
  if (!isHex(tx.data) || !isString(tx.from) || !isDigits(tx.gas) || !isDigits(tx.gasPrice) || !isDigits(tx.minReceiveAmount) || !isString(tx.slippagePercent) || !isString(tx.to) || !isDigits(tx.value)) {
    throw new OkxDexApiError('The OKX DEX API returned an invalid swap transaction.');
  }
  return { routerResult: parseQuote(value.routerResult), tx: tx as OkxSwapTransaction };
}

export class OkxDexApiClient {
  private readonly apiKey?: string;
  private readonly fetchFn: FetchLike;
  private readonly now: () => Date;
  private readonly passphrase?: string;
  private readonly secretKey?: string;

  constructor(options: OkxDexApiClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OKX_DEX_API_KEY;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
    this.passphrase = options.passphrase ?? process.env.OKX_DEX_PASSPHRASE;
    this.secretKey = options.secretKey ?? process.env.OKX_DEX_SECRET_KEY;
  }

  async getSupportedChains(): Promise<string[]> {
    const response = await this.get('/api/v6/dex/aggregator/supported/chain');
    return response.map((value) => {
      const chainIndex = isRecord(value) ? normalizeSupportedChainIndex(value.chainIndex) : undefined;
      if (chainIndex === undefined) throw new OkxDexApiError('The OKX DEX API returned an invalid chain payload.');
      return chainIndex;
    });
  }

  async getQuote(request: OkxQuoteRequest): Promise<OkxQuoteData> {
    return parseQuote((await this.get('/api/v6/dex/aggregator/quote', { chainIndex: String(xLayerMainnet.chainId), ...request }))[0]);
  }

  async getApprovalTransaction(request: OkxApprovalRequest): Promise<OkxApprovalData> {
    return parseApproval((await this.get('/api/v6/dex/aggregator/approve-transaction', { chainIndex: String(xLayerMainnet.chainId), ...request }))[0]);
  }

  async getSwapTransaction(request: OkxSwapRequest): Promise<OkxSwapData> {
    return parseSwap((await this.get('/api/v6/dex/aggregator/swap', { chainIndex: String(xLayerMainnet.chainId), swapMode: 'exactIn', ...request }))[0]);
  }

  private async get(path: string, params: Record<string, string> = {}): Promise<unknown[]> {
    const apiKey = requiredSecret('OKX_DEX_API_KEY', this.apiKey);
    const secretKey = requiredSecret('OKX_DEX_SECRET_KEY', this.secretKey);
    const passphrase = requiredSecret('OKX_DEX_PASSPHRASE', this.passphrase);
    const requestPath = apiPath(path, params);
    const timestamp = this.now().toISOString();
    const signature = createHmac('sha256', secretKey).update(`${timestamp}GET${requestPath}`).digest('base64');
    let response: Response;
    try {
      response = await this.fetchFn(`${mainnetOkxConfig.apiBaseUrl}${requestPath}`, {
        headers: { 'OK-ACCESS-KEY': apiKey, 'OK-ACCESS-PASSPHRASE': passphrase, 'OK-ACCESS-SIGN': signature, 'OK-ACCESS-TIMESTAMP': timestamp },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new OkxDexApiError(
        'The OKX DEX API request failed before receiving a response.',
        undefined,
        undefined,
        transportFailure(error),
      );
    }
    let body: unknown;
    try { body = await response.json(); } catch { throw new OkxDexApiError('The OKX DEX API returned a non-JSON response.', response.status); }
    if (!isRecord(body) || !isString(body.code) || !isString(body.msg) || !Array.isArray(body.data)) throw new OkxDexApiError('The OKX DEX API returned an invalid response envelope.', response.status);
    if (!response.ok || body.code !== '0') throw new OkxDexApiError(body.msg || 'The OKX DEX API rejected the request.', response.status, body.code);
    if (body.data.length === 0) throw new OkxDexApiError('The OKX DEX API returned no preparation data.', response.status, body.code);
    return body.data;
  }
}
