import {
  decodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  parseUnits,
  stringToHex,
  type Address,
  type Hex,
} from 'viem';
import type { Invoice } from '../invoices/types.js';
import {
  mainnetAddressConfig,
  mainnetSupportedAssets,
  VERIFIED_MAINNET_USDT0_ADDRESS,
  VERIFIED_MAINNET_WAAPL_ADDRESS,
  VERIFIED_MAINNET_WNVDA_ADDRESS,
  VERIFIED_TESTNET_BUILDER_CODE,
  type MainnetAssetKey,
  xLayerMainnet,
} from '../config/xlayerMainnet.js';
import { appendBuilderCodeSuffix, toMainnetBuilderCodeDataSuffix } from './builderCodes.js';
import {
  OkxDexApiClient,
  type OkxApprovalData,
  type OkxDexProtocol,
  type OkxDexRoute,
  type OkxQuoteData,
  type OkxSwapData,
} from './okxDexApi.js';

const erc20ApproveAbi = [{
  type: 'function',
  name: 'approve',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

// Only OKX router functions with an explicit receiver and BaseRequest are accepted.
const recipientSwapAbi = parseAbi([
  'function dagSwapTo(uint256 orderId, address receiver, (uint256 fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, uint256 deadLine) baseRequest, (address[] mixAdapters, address[] assetTo, uint256[] rawData, bytes[] extraData, uint256 fromToken)[] paths) payable returns (uint256)',
  'function uniswapV3SwapToWithBaseRequest(uint256 orderId, address receiver, (uint256 fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, uint256 deadLine) baseRequest, uint256[] pools) payable returns (uint256)',
  'function unxswapToWithBaseRequest(uint256 orderId, address receiver, (uint256 fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, uint256 deadLine) baseRequest, bytes32[] pools) payable returns (uint256)',
]);

type BaseRequest = {
  deadLine: bigint;
  fromToken: bigint;
  fromTokenAmount: bigint;
  minReturnAmount: bigint;
  toToken: Address;
};

const DEFAULT_QUOTE_TTL_SECONDS = 120;
export const MAINNET_MAX_SLIPPAGE_PERCENT = '1.5';
const MAINNET_MAX_SLIPPAGE_BASIS_POINTS = 15_000n;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const KNOWN_TESTNET_ADDRESSES = new Set([
  '0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c',
  '0x756546fce7d7ca3bb4be127904b002baf13b432e',
  '0xa0c469d4419446c21a1d992c0a1c3cdc09bbcc4e',
  '0xeaab8d9507dcb3323c6045544d0bae546bfed90b',
  '0x33907e98d7392d95212b05ab03f091e02d7815bf',
]);

export type MainnetAdapterOptions = {
  apiClient?: OkxDexApiClient;
  builderCode?: string;
  now?: () => Date;
  quoteTtlSeconds?: number;
};

export type MainnetQuoteRequest = {
  assetAmount: string;
  assetKey: MainnetAssetKey;
  buyerAddress: string;
  invoice: Invoice;
  slippagePercent?: string;
};

export type MainnetQuote = {
  asset: Address;
  assetAmount: string;
  assetKey: MainnetAssetKey;
  buyer: Address;
  chainId: 196;
  createdAt: string;
  expiresAt: string;
  invoiceId: string;
  invoiceStablecoinAmount: string;
  merchant: Address;
  minReceiveAmount: string;
  quotedStablecoinAmount: string;
  quoteId?: string;
  routerPath?: string;
  slippagePercent: string;
  stablecoin: Address;
};

export type MainnetApprovalRequirement = {
  amount: string;
  data: Hex;
  gasLimit: string;
  gasPrice: string;
  spender: Address;
  token: Address;
};

export type PreparedMainnetTransaction = {
  amount?: string;
  attributedData?: Hex;
  builderCode?: string;
  data: Hex;
  dataSuffix?: Hex;
  from: Address;
  gas?: bigint;
  gasPrice?: bigint;
  kind: 'approval' | 'swap';
  minReceiveAmount?: string;
  router?: Address;
  execution?: MainnetSwapExecutionEvidence;
  to: Address;
  value: bigint;
  chainId: 196;
};

export type MainnetRouteLegEvidence = {
  fromToken: Address;
  toToken: Address;
  fromTokenIndex?: string;
  toTokenIndex?: string;
  protocols: readonly { dexName: string; percent: string }[];
};

/** Immutable semantic binding to the final OKX /swap response, not its diagnostic quoteId. */
export type MainnetSwapExecutionEvidence = {
  invoiceId: string;
  chainId: 196;
  buyer: Address;
  merchant: Address;
  inputToken: Address;
  outputToken: Address;
  exactInputAmount: string;
  inputConsumptionMode: 'exact-in-max-debit-net-observed';
  expectedOutputAmount: string;
  minimumReceiveAmount: string;
  router: Address;
  spender: Address;
  attributedApprovalCalldataHash: Hex;
  routePath: string;
  route: readonly MainnetRouteLegEvidence[];
  routeFingerprint: Hex;
  authenticatedResponse: OkxSwapData;
  authenticatedResponseHash: Hex;
  slippagePercent: string;
  builderCode?: string;
  previewQuoteHash: Hex;
  attributedSwapCalldataHash: Hex;
  preparedAt: string;
  expiresAt: string;
  preparationHash: Hex;
};

export class MainnetPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MainnetPreparationError';
  }
}

// A caller cannot manufacture execution authority from a serialized preparation object.
// Only objects created from this adapter's authenticated server-side /swap request enter this set.
const authenticatedMainnetSwapPreparations = new WeakSet<object>();

export function isAuthenticatedMainnetSwapPreparation(prepared: PreparedMainnetTransaction): boolean {
  return authenticatedMainnetSwapPreparations.has(prepared);
}

function normalizeAddress(value: string, label: string): Address {
  if (!isAddress(value)) throw new MainnetPreparationError(`${label} is not a valid mainnet address.`);
  return getAddress(value);
}

function positiveInteger(value: string, label: string): string {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new MainnetPreparationError(`${label} must be a positive base-unit integer.`);
  }
  return value;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function hashJson(value: unknown): Hex {
  return keccak256(stringToHex(JSON.stringify(value)));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new MainnetPreparationError('Authenticated OKX response contains a non-JSON value.');
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function hashCanonicalJson(value: unknown): Hex {
  return keccak256(stringToHex(canonicalJson(value)));
}

function authenticatedResponseHash(value: OkxSwapData): Hex { return hashCanonicalJson(value); }

function routeFingerprint(path: string, legs: readonly MainnetRouteLegEvidence[]): Hex {
  return hashJson({ path, legs: legs.map((leg) => ({
    fromToken: leg.fromToken,
    toToken: leg.toToken,
    ...(leg.fromTokenIndex === undefined ? {} : { fromTokenIndex: leg.fromTokenIndex }),
    ...(leg.toTokenIndex === undefined ? {} : { toTokenIndex: leg.toTokenIndex }),
    protocols: leg.protocols,
  })) });
}

function canonicalRouteEvidence(raw: OkxQuoteData, asset: Address, stablecoin: Address): { path: string; legs: MainnetRouteLegEvidence[]; fingerprint: Hex } {
  if (!raw.router || typeof raw.router !== 'string') throw new MainnetPreparationError('OKX route path is missing.');
  const path = raw.router.split('--');
  if (path.length < 2 || path.some((part) => !isAddress(part))
    || !sameAddress(path[0], asset) || !sameAddress(path[path.length - 1], stablecoin)) {
    throw new MainnetPreparationError('OKX route path is malformed or does not connect the configured tokens.');
  }
  if (!Array.isArray(raw.dexRouterList) || raw.dexRouterList.length === 0) throw new MainnetPreparationError('OKX route legs are missing.');
  const legs = raw.dexRouterList.map((leg, index): MainnetRouteLegEvidence => {
    const rawLeg = leg as OkxDexRoute & { routerPercent?: unknown; subRouterList?: unknown };
    if (rawLeg.routerPercent !== undefined || rawLeg.subRouterList !== undefined) {
      throw new MainnetPreparationError(`OKX route leg ${index + 1} contains unsupported branch/subroute metadata.`);
    }
    const fromToken = normalizeAddress(leg.fromToken.tokenContractAddress, `Route leg ${index + 1} input token`);
    const toToken = normalizeAddress(leg.toToken.tokenContractAddress, `Route leg ${index + 1} output token`);
    const hasFromIndex = leg.fromTokenIndex !== undefined;
    const hasToIndex = leg.toTokenIndex !== undefined;
    if (hasFromIndex !== hasToIndex) throw new MainnetPreparationError(`OKX route leg ${index + 1} has incomplete token-index metadata.`);
    if (hasFromIndex && (typeof leg.fromTokenIndex !== 'string' || typeof leg.toTokenIndex !== 'string'
      || !/^\d+$/.test(leg.fromTokenIndex) || !/^\d+$/.test(leg.toTokenIndex))) {
      throw new MainnetPreparationError(`OKX route leg ${index + 1} has malformed token-index metadata.`);
    }
    if (sameAddress(fromToken, toToken)) throw new MainnetPreparationError(`OKX route leg ${index + 1} does not advance the token path.`);
    const rawProtocols: readonly OkxDexProtocol[] = !leg.dexProtocol
      ? []
      : Array.isArray(leg.dexProtocol)
        ? leg.dexProtocol as readonly OkxDexProtocol[]
        : [leg.dexProtocol as OkxDexProtocol];
    if (rawProtocols.length !== 1) {
      throw new MainnetPreparationError(`OKX route leg ${index + 1} must contain exactly one protocol; split or empty protocol lists are unsupported.`);
    }
    const protocol = rawProtocols[0];
    if (!protocol || typeof protocol !== 'object' || typeof protocol.dexName !== 'string' || !protocol.dexName.trim()
      || typeof protocol.percent !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(protocol.percent)) {
      throw new MainnetPreparationError(`OKX route leg ${index + 1} has malformed protocol data.`);
    }
    const [whole, fraction = ''] = protocol.percent.split('.');
    const percentageScale = fraction.length;
    const percentageBase = 10n ** BigInt(percentageScale);
    const percentage = BigInt(whole!) * percentageBase + BigInt(fraction || '0');
    if (percentage !== 100n * percentageBase) {
      throw new MainnetPreparationError(`OKX route leg ${index + 1} protocol percentage must be exactly 100%.`);
    }
    return {
      fromToken,
      toToken,
      ...(hasFromIndex ? { fromTokenIndex: leg.fromTokenIndex!, toTokenIndex: leg.toTokenIndex! } : {}),
      protocols: [{ dexName: protocol.dexName.trim(), percent: protocol.percent }],
    };
  });
  if (!sameAddress(legs[0]!.fromToken, asset) || !sameAddress(legs[legs.length - 1]!.toToken, stablecoin)) {
    throw new MainnetPreparationError('OKX route legs do not start at the selected asset and end at official USD₮0.');
  }
  if (new Set(path.map((part) => part.toLowerCase())).size !== path.length) {
    throw new MainnetPreparationError('OKX route contains a duplicate token or cycle.');
  }
  for (let index = 1; index < legs.length; index += 1) {
    const previous = legs[index - 1]!;
    const current = legs[index]!;
    if (!sameAddress(previous.toToken, current.fromToken)) {
      throw new MainnetPreparationError(`OKX route legs are disconnected or reordered between legs ${index} and ${index + 1}.`);
    }
    if (previous.toTokenIndex !== undefined || current.fromTokenIndex !== undefined) {
      if (previous.toTokenIndex === undefined || current.fromTokenIndex === undefined || previous.toTokenIndex !== current.fromTokenIndex) {
        throw new MainnetPreparationError(`OKX route token indices are disconnected between legs ${index} and ${index + 1}.`);
      }
    }
  }
  const routeTokens = [legs[0]!.fromToken, ...legs.map((leg) => leg.toToken)];
  if (path.length !== routeTokens.length || path.some((token, index) => !sameAddress(token, routeTokens[index]!))) {
    throw new MainnetPreparationError('OKX route path contradicts or omits the connected route-leg sequence.');
  }
  if (legs.some((leg, index) => leg.fromTokenIndex !== undefined
    && (BigInt(leg.toTokenIndex!) !== BigInt(leg.fromTokenIndex!) + 1n
      || (index === 0 ? leg.fromTokenIndex !== '0' : leg.fromTokenIndex !== legs[index - 1]!.toTokenIndex)))) {
    throw new MainnetPreparationError('OKX route token indices do not describe one contiguous ordered path.');
  }
  const normalizedPath = path.map((part) => getAddress(part).toLowerCase()).join('--');
  const fingerprint = routeFingerprint(normalizedPath, legs);
  return { path: normalizedPath, legs, fingerprint };
}

function previewQuoteHash(quote: MainnetQuote): Hex {
  return hashJson({
    invoiceId: quote.invoiceId,
    chainId: quote.chainId,
    buyer: quote.buyer.toLowerCase(),
    merchant: quote.merchant.toLowerCase(),
    inputToken: quote.asset.toLowerCase(),
    outputToken: quote.stablecoin.toLowerCase(),
    exactInputAmount: quote.assetAmount,
    invoiceAmount: quote.invoiceStablecoinAmount,
    previewOutputAmount: quote.quotedStablecoinAmount,
    previewMinimumReceiveAmount: quote.minReceiveAmount,
    previewRoutePath: quote.routerPath?.toLowerCase() ?? null,
    slippagePercent: quote.slippagePercent,
    createdAt: quote.createdAt,
    expiresAt: quote.expiresAt,
  });
}

function swapPreparationHash(evidence: Omit<MainnetSwapExecutionEvidence, 'preparationHash'>): Hex {
  return hashCanonicalJson(evidence);
}

export function validateMainnetSwapExecutionEvidence(quote: MainnetQuote, prepared: PreparedMainnetTransaction): void {
  const evidence = prepared.execution;
  if (!evidence || !prepared.attributedData || !evidence.authenticatedResponse) throw new MainnetPreparationError('Authenticated final swap execution evidence is missing.');
  const { preparationHash, ...fields } = evidence;
  const preparedAt = Date.parse(evidence.preparedAt);
  const expiresAt = Date.parse(evidence.expiresAt);
  const quoteCreatedAt = Date.parse(quote.createdAt);
  const quoteExpiresAt = Date.parse(quote.expiresAt);
  const response = evidence.authenticatedResponse;
  const responseTx = response.tx;
  const route = canonicalRouteEvidence(response.routerResult, quote.asset, quote.stablecoin);
  let decoded: ReturnType<typeof decodeFunctionData<typeof recipientSwapAbi>>;
  try { decoded = decodeFunctionData({ abi: recipientSwapAbi, data: responseTx.data }); }
  catch { throw new MainnetPreparationError('Authenticated OKX response calldata is not an allowed direct-recipient router call.'); }
  const receiver = decoded.args[1] as Address;
  const baseRequest = decoded.args[2] as BaseRequest;
  const slippageFloor = minimumAfterSlippage(response.routerResult.toTokenAmount, quote.slippagePercent);
  const invoiceAmount = BigInt(quote.invoiceStablecoinAmount);
  const expectedMinimum = slippageFloor > invoiceAmount ? slippageFloor : invoiceAmount;
  const deadlineMs = Number(baseRequest.deadLine * 1000n);
  const responseExpiresAt = Math.min(preparedAt + (quoteExpiresAt - quoteCreatedAt), deadlineMs);
  const suffix = toMainnetBuilderCodeDataSuffix(evidence.builderCode);
  const attributedResponseData = suffix ? appendBuilderCodeSuffix(responseTx.data, suffix) : undefined;
  if (preparationHash !== swapPreparationHash(fields)
    || evidence.authenticatedResponseHash !== authenticatedResponseHash(response)
    || evidence.previewQuoteHash !== previewQuoteHash(quote)
    || evidence.invoiceId !== quote.invoiceId || evidence.chainId !== 196
    || !sameAddress(evidence.buyer, quote.buyer) || !sameAddress(evidence.merchant, quote.merchant)
    || !sameAddress(evidence.inputToken, quote.asset) || !sameAddress(evidence.outputToken, quote.stablecoin)
    || evidence.exactInputAmount !== quote.assetAmount || evidence.inputConsumptionMode !== 'exact-in-max-debit-net-observed'
    || evidence.slippagePercent !== quote.slippagePercent
    || evidence.builderCode !== prepared.builderCode
    || !sameAddress(evidence.router, prepared.to) || evidence.minimumReceiveAmount !== prepared.minReceiveAmount
    || !isAddress(evidence.spender) || !/^0x[0-9a-fA-F]{64}$/.test(evidence.attributedApprovalCalldataHash)
    || !sameAddress(responseTx.from, quote.buyer) || !sameAddress(responseTx.to, evidence.router)
    || responseTx.data !== prepared.data || responseTx.value !== '0'
    || responseTx.minReceiveAmount !== evidence.minimumReceiveAmount
    || responseTx.slippagePercent !== quote.slippagePercent
    || !sameAddress(receiver, quote.merchant)
    || !sameAddress(packedAddress(baseRequest.fromToken), quote.asset)
    || !sameAddress(baseRequest.toToken, quote.stablecoin)
    || baseRequest.fromTokenAmount !== BigInt(quote.assetAmount)
    || baseRequest.minReturnAmount !== BigInt(evidence.minimumReceiveAmount)
    || !Number.isSafeInteger(deadlineMs) || deadlineMs <= preparedAt
    || !Number.isFinite(responseExpiresAt) || Date.parse(evidence.expiresAt) !== responseExpiresAt
    || response.routerResult.chainIndex !== '196' || response.routerResult.fromTokenAmount !== quote.assetAmount
    || response.routerResult.toTokenAmount !== evidence.expectedOutputAmount
    || response.routerResult.swapMode !== 'exactIn'
    || !sameAddress(response.routerResult.fromToken.tokenContractAddress, quote.asset)
    || !sameAddress(response.routerResult.toToken.tokenContractAddress, quote.stablecoin)
    || response.routerResult.fromToken.decimal !== '18' || response.routerResult.toToken.decimal !== '6'
    || route.path !== evidence.routePath
    || hashCanonicalJson(route.legs) !== hashCanonicalJson(evidence.route)
    || evidence.routeFingerprint !== route.fingerprint
    || !attributedResponseData || prepared.attributedData !== attributedResponseData
    || evidence.attributedSwapCalldataHash !== keccak256(prepared.attributedData)
    || evidence.routeFingerprint !== routeFingerprint(evidence.routePath, evidence.route)
    || !/^\d+$/.test(evidence.expectedOutputAmount) || BigInt(evidence.expectedOutputAmount) <= 0n
    || BigInt(evidence.minimumReceiveAmount) < BigInt(quote.invoiceStablecoinAmount)
    || BigInt(evidence.minimumReceiveAmount) > BigInt(evidence.expectedOutputAmount)
    || BigInt(evidence.minimumReceiveAmount) < expectedMinimum
    || !Number.isFinite(preparedAt) || !Number.isFinite(expiresAt) || !Number.isFinite(quoteCreatedAt)
    || !Number.isFinite(quoteExpiresAt) || preparedAt > quoteExpiresAt || preparedAt >= expiresAt) {
    throw new MainnetPreparationError('Final swap execution evidence does not match the invoice-bound quote intent.');
  }
}

function parseGas(value: string, label: string): bigint {
  try {
    return BigInt(positiveInteger(value, label));
  } catch {
    throw new MainnetPreparationError(`${label} is invalid.`);
  }
}

function parseSlippageBasisPoints(value: string): bigint {
  if (!/^\d+(?:\.\d{1,4})?$/.test(value)) throw new MainnetPreparationError(`Slippage must be between 0 and ${MAINNET_MAX_SLIPPAGE_PERCENT} percent.`);
  const [whole, fraction = ''] = value.split('.');
  const tenThousandthsPercent = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0'));
  if (tenThousandthsPercent > MAINNET_MAX_SLIPPAGE_BASIS_POINTS) throw new MainnetPreparationError(`Slippage must be between 0 and ${MAINNET_MAX_SLIPPAGE_PERCENT} percent.`);
  return tenThousandthsPercent;
}

export function minimumAfterSlippage(amount: string, slippagePercent: string): bigint {
  const slippage = parseSlippageBasisPoints(slippagePercent);
  return BigInt(amount) * (1_000_000n - slippage) / 1_000_000n;
}

export function grossAmountForMinimum(minimumAmount: string, slippagePercent: string): bigint {
  const slippage = parseSlippageBasisPoints(slippagePercent);
  const protectedShare = 1_000_000n - slippage;
  const numerator = BigInt(positiveInteger(minimumAmount, 'Minimum output')) * 1_000_000n;
  return (numerator + protectedShare - 1n) / protectedShare;
}

function packedAddress(value: bigint): Address {
  return getAddress(`0x${(value & ((1n << 160n) - 1n)).toString(16).padStart(40, '0')}`);
}

export class OKXDEXMainnetAdapter {
  readonly name = 'OKXDEXMainnetAdapter' as const;
  private readonly apiClient: OkxDexApiClient;
  private readonly builderCode?: string;
  private readonly now: () => Date;
  private readonly quoteTtlSeconds: number;

  constructor(options: MainnetAdapterOptions = {}) {
    this.apiClient = options.apiClient ?? new OkxDexApiClient();
    this.builderCode = (options.builderCode ?? mainnetAddressConfig.builderCode)?.trim() || undefined;
    this.now = options.now ?? (() => new Date());
    this.quoteTtlSeconds = options.quoteTtlSeconds ?? Number(process.env.MAINNET_QUOTE_TTL_SECONDS || DEFAULT_QUOTE_TTL_SECONDS);
    if (!Number.isInteger(this.quoteTtlSeconds) || this.quoteTtlSeconds < 1 || this.quoteTtlSeconds > 120) {
      throw new MainnetPreparationError('MAINNET_QUOTE_TTL_SECONDS must be between 1 and 120.');
    }
    for (const [label, address, verified] of [
      ['MAINNET_WNVDA_ADDRESS', mainnetAddressConfig.wNvda, VERIFIED_MAINNET_WNVDA_ADDRESS],
      ['MAINNET_WAAPL_ADDRESS', mainnetAddressConfig.wAapl, VERIFIED_MAINNET_WAAPL_ADDRESS],
      ['MAINNET_USDT0_ADDRESS', mainnetAddressConfig.usdt0, VERIFIED_MAINNET_USDT0_ADDRESS],
    ] as const) {
      const normalized = normalizeAddress(address, label);
      if (!sameAddress(normalized, verified)) {
        throw new MainnetPreparationError(`${label} must match the independently verified X Layer Mainnet address.`);
      }
      if (KNOWN_TESTNET_ADDRESSES.has(normalized.toLowerCase())) {
        throw new MainnetPreparationError(`${label} cannot use a known X Layer Testnet address.`);
      }
    }
    if (new Set([
      mainnetAddressConfig.wNvda.toLowerCase(),
      mainnetAddressConfig.wAapl.toLowerCase(),
      mainnetAddressConfig.usdt0.toLowerCase(),
    ]).size !== 3) {
      throw new MainnetPreparationError('Mainnet asset and settlement token addresses must be distinct.');
    }
    const configuredTestnetCode = process.env.PORTPAY_BUILDER_CODE?.trim();
    if (this.builderCode && (this.builderCode === VERIFIED_TESTNET_BUILDER_CODE || this.builderCode === configuredTestnetCode)) {
      throw new MainnetPreparationError('PORTPAY_MAINNET_BUILDER_CODE must be separate from the verified testnet Builder Code.');
    }
    if (this.builderCode && !toMainnetBuilderCodeDataSuffix(this.builderCode)) {
      throw new MainnetPreparationError('PORTPAY_MAINNET_BUILDER_CODE is malformed.');
    }
  }

  getSupportedAssets() {
    return mainnetSupportedAssets.map((asset) => ({ ...asset }));
  }

  getBuilderCode(): string | undefined {
    return this.builderCode;
  }

  async getSizingQuote(request: MainnetQuoteRequest): Promise<{ expectedOutputAmount: string; protectedOutputAmount: string }> {
    if (request.invoice.status !== 'pending') throw new MainnetPreparationError('Only pending invoices can be sized.');
    const asset = this.assetAddress(request.assetKey);
    positiveInteger(request.assetAmount, 'Asset amount');
    const slippagePercent = request.slippagePercent ?? MAINNET_MAX_SLIPPAGE_PERCENT;
    parseSlippageBasisPoints(slippagePercent);
    const raw = await this.apiClient.getQuote({
      amount: request.assetAmount,
      fromTokenAddress: asset,
      toTokenAddress: mainnetAddressConfig.usdt0,
    });
    const stablecoin = normalizeAddress(mainnetAddressConfig.usdt0, 'Mainnet USD₮0');
    this.validateQuoteResponse(raw, asset, stablecoin, request.assetAmount);
    return {
      expectedOutputAmount: raw.toTokenAmount,
      protectedOutputAmount: minimumAfterSlippage(raw.toTokenAmount, slippagePercent).toString(),
    };
  }

  async getQuote(request: MainnetQuoteRequest): Promise<MainnetQuote> {
    const invoice = request.invoice;
    if (invoice.status !== 'pending') throw new MainnetPreparationError('Only pending invoices can be quoted.');
    const asset = this.assetAddress(request.assetKey);
    const buyer = normalizeAddress(request.buyerAddress, 'Buyer');
    const merchant = normalizeAddress(invoice.merchantAddress, 'Merchant');
    const assetAmount = positiveInteger(request.assetAmount, 'Asset amount');
    const slippagePercent = request.slippagePercent ?? '0.5';
    parseSlippageBasisPoints(slippagePercent);
    const raw = await this.apiClient.getQuote({
      amount: assetAmount,
      fromTokenAddress: asset,
      toTokenAddress: mainnetAddressConfig.usdt0,
    });
    const stablecoin = normalizeAddress(mainnetAddressConfig.usdt0, 'Mainnet USD₮0');
    this.validateQuoteResponse(raw, asset, stablecoin, assetAmount);
    const invoiceAmount = parseUnits(invoice.amountUsdt0, 6);
    if (BigInt(raw.toTokenAmount) < invoiceAmount) {
      throw new MainnetPreparationError('The prepared route cannot cover the exact invoice amount.');
    }
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.quoteTtlSeconds * 1000);
    const slippageFloor = minimumAfterSlippage(raw.toTokenAmount, slippagePercent);
    const minReceiveAmount = slippageFloor > invoiceAmount ? slippageFloor : invoiceAmount;
    return {
      asset,
      assetAmount,
      assetKey: request.assetKey,
      buyer,
      chainId: xLayerMainnet.chainId,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      invoiceId: invoice.id,
      invoiceStablecoinAmount: invoiceAmount.toString(),
      merchant,
      minReceiveAmount: minReceiveAmount.toString(),
      quotedStablecoinAmount: raw.toTokenAmount,
      ...(raw.quoteId ? { quoteId: raw.quoteId } : {}),
      ...(raw.router ? { routerPath: raw.router } : {}),
      slippagePercent,
      stablecoin,
    };
  }

  async getApprovalRequirement(quote: MainnetQuote): Promise<MainnetApprovalRequirement> {
    this.assertFreshQuote(quote);
    const raw = await this.apiClient.getApprovalTransaction({
      approveAmount: quote.assetAmount,
      tokenContractAddress: quote.asset,
    });
    return this.validateApprovalResponse(raw, quote);
  }

  async prepareApprovalTransaction(quote: MainnetQuote): Promise<PreparedMainnetTransaction> {
    const requirement = await this.getApprovalRequirement(quote);
    return this.withBuilderCode({
      amount: requirement.amount,
      data: requirement.data,
      from: quote.buyer,
      gas: parseGas(requirement.gasLimit, 'Approval gas limit'),
      gasPrice: parseGas(requirement.gasPrice, 'Approval gas price'),
      kind: 'approval',
      to: requirement.token,
      value: 0n,
    });
  }

  async prepareSwapTransaction(quote: MainnetQuote, approval?: PreparedMainnetTransaction): Promise<PreparedMainnetTransaction> {
    this.assertFreshQuote(quote);
    const authenticatedApproval = await this.prepareApprovalTransaction(quote);
    if (approval && (approval.kind !== 'approval' || approval.data !== authenticatedApproval.data
      || approval.attributedData !== authenticatedApproval.attributedData
      || approval.builderCode !== authenticatedApproval.builderCode || approval.dataSuffix !== authenticatedApproval.dataSuffix
      || approval.from.toLowerCase() !== authenticatedApproval.from.toLowerCase()
      || approval.to.toLowerCase() !== authenticatedApproval.to.toLowerCase()
      || approval.chainId !== authenticatedApproval.chainId || approval.value !== 0n)) {
      throw new MainnetPreparationError('Supplied approval does not match the fresh authenticated OKX approval preparation.');
    }
    let decodedApproval: ReturnType<typeof decodeFunctionData<typeof erc20ApproveAbi>>;
    try { decodedApproval = decodeFunctionData({ abi: erc20ApproveAbi, data: authenticatedApproval.data }); }
    catch { throw new MainnetPreparationError('Fresh authenticated OKX approval calldata could not be decoded.'); }
    if (decodedApproval.functionName !== 'approve' || typeof decodedApproval.args?.[0] !== 'string') {
      throw new MainnetPreparationError('Fresh authenticated OKX approval calldata has an invalid spender.');
    }
    const raw = await this.apiClient.getSwapTransaction({
      amount: quote.assetAmount,
      fromTokenAddress: quote.asset,
      slippagePercent: quote.slippagePercent,
      swapReceiverAddress: quote.merchant,
      toTokenAddress: quote.stablecoin,
      userWalletAddress: quote.buyer,
    });
    const transaction = this.validateSwapResponse(raw, quote);
    const prepared = this.withBuilderCode({
      data: transaction.data,
      from: quote.buyer,
      gas: parseGas(transaction.gas, 'Swap gas limit'),
      gasPrice: parseGas(transaction.gasPrice, 'Swap gas price'),
      kind: 'swap',
      minReceiveAmount: transaction.minReceiveAmount,
      router: normalizeAddress(transaction.to, 'OKX swap router'),
      to: normalizeAddress(transaction.to, 'OKX swap router'),
      value: BigInt(transaction.value),
    });
    const preparedAt = this.now();
    const deadlineMs = Number(transaction.deadline * 1000n);
    const expiresAtMs = Math.min(preparedAt.getTime() + this.quoteTtlSeconds * 1000, deadlineMs);
    if (!Number.isSafeInteger(deadlineMs) || expiresAtMs <= preparedAt.getTime()) {
      throw new MainnetPreparationError('OKX swap preparation is expired or has an invalid deadline.');
    }
    const responseSnapshot = structuredClone(raw);
    const unsignedEvidence: Omit<MainnetSwapExecutionEvidence, 'preparationHash'> = {
      invoiceId: quote.invoiceId,
      chainId: 196,
      buyer: quote.buyer,
      merchant: quote.merchant,
      inputToken: quote.asset,
      outputToken: quote.stablecoin,
      exactInputAmount: quote.assetAmount,
      inputConsumptionMode: 'exact-in-max-debit-net-observed',
      expectedOutputAmount: raw.routerResult.toTokenAmount,
      minimumReceiveAmount: transaction.minReceiveAmount,
      router: prepared.to,
      spender: normalizeAddress(decodedApproval.args[0], 'OKX approval spender'),
      attributedApprovalCalldataHash: keccak256(authenticatedApproval.attributedData ?? authenticatedApproval.data),
      routePath: transaction.route.path,
      route: transaction.route.legs,
      routeFingerprint: transaction.route.fingerprint,
      authenticatedResponse: responseSnapshot,
      authenticatedResponseHash: authenticatedResponseHash(responseSnapshot),
      slippagePercent: quote.slippagePercent,
      ...(this.builderCode ? { builderCode: this.builderCode } : {}),
      previewQuoteHash: previewQuoteHash(quote),
      attributedSwapCalldataHash: keccak256(prepared.attributedData ?? prepared.data),
      preparedAt: preparedAt.toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
    prepared.execution = { ...unsignedEvidence, preparationHash: swapPreparationHash(unsignedEvidence) };
    validateMainnetSwapExecutionEvidence(quote, prepared);
    authenticatedMainnetSwapPreparations.add(prepared);
    return prepared;
  }

  async validatePreparedTransaction(
    quote: MainnetQuote,
    prepared: PreparedMainnetTransaction,
  ): Promise<void> {
    this.assertFreshQuote(quote);
    if (prepared.chainId !== xLayerMainnet.chainId) throw new MainnetPreparationError('Prepared transaction has the wrong chain.');
    if (!sameAddress(prepared.from, quote.buyer)) throw new MainnetPreparationError('Prepared transaction buyer does not match the quote.');
    if (prepared.value !== 0n) throw new MainnetPreparationError('Mainnet ERC-20 preparation must not send native OKB value.');
    const expectedSuffix = toMainnetBuilderCodeDataSuffix(this.builderCode);
    if (prepared.dataSuffix !== expectedSuffix || prepared.builderCode !== this.builderCode) {
      throw new MainnetPreparationError('Prepared transaction Builder Code fields do not match mainnet configuration.');
    }
    const expectedAttributedData = expectedSuffix ? appendBuilderCodeSuffix(prepared.data, expectedSuffix) : undefined;
    if (prepared.attributedData !== expectedAttributedData) {
      throw new MainnetPreparationError('Builder Code suffix is not appended deterministically.');
    }
    if (prepared.kind === 'approval') {
      const requirement = await this.getApprovalRequirement(quote);
      if (!sameAddress(prepared.to, requirement.token)) throw new MainnetPreparationError('Approval targets an unexpected token.');
      if (prepared.data !== requirement.data) throw new MainnetPreparationError('Approval calldata is stale or mismatched.');
      return;
    }
    if (!isAuthenticatedMainnetSwapPreparation(prepared)) {
      throw new MainnetPreparationError('Swap preparation was not produced by a fresh authenticated OKX V6 /swap response in this backend process.');
    }
    validateMainnetSwapExecutionEvidence(quote, prepared);
    if (!prepared.minReceiveAmount || !sameAddress(prepared.to, prepared.execution!.router)
      || Date.parse(prepared.execution!.expiresAt) <= this.now().getTime()) {
      throw new MainnetPreparationError('Swap router, minimum receive, or preparation freshness is invalid.');
    }
  }

  private validateQuoteResponse(raw: OkxQuoteData, asset: Address, stablecoin: Address, assetAmount: string): void {
    if (raw.chainIndex !== String(xLayerMainnet.chainId)) throw new MainnetPreparationError('OKX quote returned the wrong chain.');
    if (!sameAddress(raw.fromToken.tokenContractAddress, asset) || !sameAddress(raw.toToken.tokenContractAddress, stablecoin)) {
      throw new MainnetPreparationError('OKX quote returned unexpected token addresses.');
    }
    if (raw.fromTokenAmount !== assetAmount || !/^\d+$/.test(raw.toTokenAmount) || BigInt(raw.toTokenAmount) <= 0n) {
      throw new MainnetPreparationError('OKX quote amounts are inconsistent with the request.');
    }
    if (raw.swapMode !== 'exactIn') throw new MainnetPreparationError('OKX quote must use exact-input mode.');
    if (raw.fromToken.decimal !== '18' || raw.toToken.decimal !== '6') throw new MainnetPreparationError('OKX quote returned unexpected token decimals.');
    canonicalRouteEvidence(raw, asset, stablecoin);
  }

  private validateApprovalResponse(raw: OkxApprovalData, quote: MainnetQuote): MainnetApprovalRequirement {
    const spender = normalizeAddress(raw.dexContractAddress, 'OKX approval spender');
    if (sameAddress(spender, ZERO_ADDRESS) || sameAddress(spender, quote.asset) || sameAddress(spender, quote.stablecoin)
      || sameAddress(spender, quote.buyer) || sameAddress(spender, quote.merchant)) {
      throw new MainnetPreparationError('OKX approval spender conflicts with a bound payment participant or token.');
    }
    let decoded: { functionName: string; args?: readonly unknown[] };
    try {
      decoded = decodeFunctionData({ abi: erc20ApproveAbi, data: raw.data });
    } catch {
      throw new MainnetPreparationError('OKX approval calldata is not a standard ERC-20 approval.');
    }
    if (decoded.functionName !== 'approve' || decoded.args?.length !== 2) {
      throw new MainnetPreparationError('OKX approval calldata is unexpected.');
    }
    const [decodedSpender, decodedAmount] = decoded.args;
    if (decodedAmount === 2n ** 256n - 1n) throw new MainnetPreparationError('Unlimited approvals are not allowed.');
    if (typeof decodedSpender !== 'string' || !sameAddress(decodedSpender, spender) || decodedAmount !== BigInt(quote.assetAmount)) {
      throw new MainnetPreparationError('OKX approval is not exact or targets an unexpected spender.');
    }
    return {
      amount: quote.assetAmount,
      data: raw.data,
      gasLimit: raw.gasLimit,
      gasPrice: raw.gasPrice,
      spender,
      token: quote.asset,
    };
  }

  private validateSwapResponse(raw: OkxSwapData, quote: MainnetQuote) {
    const transaction = raw.tx;
    const router = normalizeAddress(transaction.to, 'OKX swap router');
    if (raw.routerResult.chainIndex !== String(xLayerMainnet.chainId)) throw new MainnetPreparationError('OKX swap returned the wrong chain.');
    if (!sameAddress(transaction.from, quote.buyer)) throw new MainnetPreparationError('OKX swap sender does not match the buyer.');
    if (sameAddress(router, ZERO_ADDRESS) || sameAddress(router, quote.asset) || sameAddress(router, quote.stablecoin)
      || sameAddress(router, quote.buyer) || sameAddress(router, quote.merchant)) {
      throw new MainnetPreparationError('OKX swap router conflicts with a bound payment participant or token.');
    }
    // The official V6 Classic Swap schemas do not document quoteId as a cross-endpoint
    // immutable identifier. Treat /swap's fresh routerResult as the executable quote.
    this.validateQuoteResponse(raw.routerResult, quote.asset, quote.stablecoin, quote.assetAmount);
    if (transaction.slippagePercent !== quote.slippagePercent) throw new MainnetPreparationError('OKX swap slippage does not match the quote.');
    if (transaction.value !== '0') throw new MainnetPreparationError('OKX swap unexpectedly sends native OKB.');
    const invoiceAmount = BigInt(quote.invoiceStablecoinAmount);
    const swapSlippageFloor = minimumAfterSlippage(raw.routerResult.toTokenAmount, quote.slippagePercent);
    const requiredSwapMinimum = swapSlippageFloor > invoiceAmount ? swapSlippageFloor : invoiceAmount;
    if (!/^\d+$/.test(transaction.minReceiveAmount)
      || BigInt(transaction.minReceiveAmount) < requiredSwapMinimum
      || BigInt(transaction.minReceiveAmount) > BigInt(raw.routerResult.toTokenAmount)
      || BigInt(raw.routerResult.toTokenAmount) < invoiceAmount) {
      throw new MainnetPreparationError('OKX swap minimum receive amount is invalid.');
    }
    const route = canonicalRouteEvidence(raw.routerResult, quote.asset, quote.stablecoin);
    let receiver: Address;
    let baseRequest: BaseRequest;
    try {
      const decoded = decodeFunctionData({ abi: recipientSwapAbi, data: transaction.data });
      receiver = decoded.args[1] as Address;
      baseRequest = decoded.args[2] as BaseRequest;
    } catch {
      throw new MainnetPreparationError('OKX swap calldata is not an allowed direct-recipient router call.');
    }
    if (!sameAddress(receiver, quote.merchant)) throw new MainnetPreparationError('OKX swap calldata recipient does not match the invoice merchant.');
    if (!sameAddress(packedAddress(baseRequest.fromToken), quote.asset)
      || !sameAddress(baseRequest.toToken, quote.stablecoin)
      || baseRequest.fromTokenAmount !== BigInt(quote.assetAmount)
      || baseRequest.minReturnAmount !== BigInt(transaction.minReceiveAmount)) {
      throw new MainnetPreparationError('OKX swap calldata tokens, amount, or minimum receive do not match the quote.');
    }
    if (baseRequest.deadLine <= BigInt(Math.floor(this.now().getTime() / 1000))) throw new MainnetPreparationError('OKX swap calldata deadline has expired.');
    return { ...transaction, deadline: baseRequest.deadLine, route };
  }

  private assertFreshQuote(quote: MainnetQuote): void {
    if (quote.chainId !== xLayerMainnet.chainId) throw new MainnetPreparationError('Quote has the wrong chain.');
    normalizeAddress(quote.buyer, 'Quote buyer');
    normalizeAddress(quote.merchant, 'Quote merchant');
    normalizeAddress(quote.asset, 'Quote asset');
    normalizeAddress(quote.stablecoin, 'Quote stablecoin');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(quote.invoiceId)) throw new MainnetPreparationError('Quote invoice ID is invalid.');
    const createdAt = Date.parse(quote.createdAt);
    const expiresAt = Date.parse(quote.expiresAt);
    const now = this.now().getTime();
    if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || createdAt > now || expiresAt - createdAt !== this.quoteTtlSeconds * 1000) throw new MainnetPreparationError('Quote timestamps are invalid.');
    if (expiresAt <= now) throw new MainnetPreparationError('Quote has expired.');
    if (!sameAddress(quote.stablecoin, mainnetAddressConfig.usdt0)) throw new MainnetPreparationError('Quote uses an unexpected mainnet stablecoin.');
    if (!sameAddress(quote.asset, this.assetAddress(quote.assetKey))) throw new MainnetPreparationError('Quote uses an unexpected mainnet asset.');
    positiveInteger(quote.assetAmount, 'Quote asset amount');
    positiveInteger(quote.invoiceStablecoinAmount, 'Quote invoice amount');
    positiveInteger(quote.quotedStablecoinAmount, 'Quote output amount');
    positiveInteger(quote.minReceiveAmount, 'Quote minimum receive amount');
    parseSlippageBasisPoints(quote.slippagePercent);
    const slippageFloor = minimumAfterSlippage(quote.quotedStablecoinAmount, quote.slippagePercent);
    const expectedMinimum = slippageFloor > BigInt(quote.invoiceStablecoinAmount) ? slippageFloor : BigInt(quote.invoiceStablecoinAmount);
    if (!quote.routerPath || BigInt(quote.minReceiveAmount) !== expectedMinimum) {
      throw new MainnetPreparationError('Quote minimum receive or router binding is invalid.');
    }
  }

  private assetAddress(assetKey: MainnetAssetKey): Address {
    return normalizeAddress(assetKey === 'wNvda' ? mainnetAddressConfig.wNvda : mainnetAddressConfig.wAapl, 'Mainnet asset');
  }

  private withBuilderCode(transaction: Omit<PreparedMainnetTransaction, 'attributedData' | 'builderCode' | 'dataSuffix' | 'chainId'>): PreparedMainnetTransaction {
    const dataSuffix = toMainnetBuilderCodeDataSuffix(this.builderCode);
    return {
      ...transaction,
      chainId: xLayerMainnet.chainId,
      ...(dataSuffix ? {
        attributedData: appendBuilderCodeSuffix(transaction.data, dataSuffix),
        builderCode: this.builderCode,
        dataSuffix,
      } : {}),
    };
  }
}
