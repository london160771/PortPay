import {
  decodeFunctionData,
  getAddress,
  isAddress,
  parseAbi,
  parseUnits,
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

const DEFAULT_QUOTE_TTL_SECONDS = 60;
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
  to: Address;
  value: bigint;
  chainId: 196;
};

export class MainnetPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MainnetPreparationError';
  }
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

function routeContains(routeList: readonly OkxDexRoute[], address: Address): boolean {
  return routeList.some((route) =>
    sameAddress(route.fromToken.tokenContractAddress, address)
    || sameAddress(route.toToken.tokenContractAddress, address));
}

function parseGas(value: string, label: string): bigint {
  try {
    return BigInt(positiveInteger(value, label));
  } catch {
    throw new MainnetPreparationError(`${label} is invalid.`);
  }
}

function parseSlippageBasisPoints(value: string): bigint {
  if (!/^\d+(?:\.\d{1,4})?$/.test(value)) throw new MainnetPreparationError('Slippage must be between 0 and 1 percent.');
  const [whole, fraction = ''] = value.split('.');
  const tenThousandthsPercent = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0'));
  if (tenThousandthsPercent > 10_000n) throw new MainnetPreparationError('Slippage must be between 0 and 1 percent.');
  return tenThousandthsPercent;
}

function minimumAfterSlippage(amount: string, slippagePercent: string): bigint {
  const slippage = parseSlippageBasisPoints(slippagePercent);
  return BigInt(amount) * (1_000_000n - slippage) / 1_000_000n;
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

  async prepareSwapTransaction(quote: MainnetQuote): Promise<PreparedMainnetTransaction> {
    this.assertFreshQuote(quote);
    const raw = await this.apiClient.getSwapTransaction({
      amount: quote.assetAmount,
      fromTokenAddress: quote.asset,
      slippagePercent: quote.slippagePercent,
      swapReceiverAddress: quote.merchant,
      toTokenAddress: quote.stablecoin,
      userWalletAddress: quote.buyer,
    });
    const transaction = this.validateSwapResponse(raw, quote);
    return this.withBuilderCode({
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
    const raw = await this.apiClient.getSwapTransaction({
      amount: quote.assetAmount,
      fromTokenAddress: quote.asset,
      slippagePercent: quote.slippagePercent,
      swapReceiverAddress: quote.merchant,
      toTokenAddress: quote.stablecoin,
      userWalletAddress: quote.buyer,
    });
    const transaction = this.validateSwapResponse(raw, quote);
    if (!sameAddress(prepared.to, transaction.to) || prepared.data !== transaction.data) {
      throw new MainnetPreparationError('Swap router or calldata is stale or mismatched.');
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
    if (!raw.router) throw new MainnetPreparationError('OKX quote did not bind a router path.');
    if (!routeContains(raw.dexRouterList, asset) || !routeContains(raw.dexRouterList, stablecoin)) {
      throw new MainnetPreparationError('OKX route does not bind the configured mainnet tokens.');
    }
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
    if (!sameAddress(raw.routerResult.fromToken.tokenContractAddress, quote.asset)
      || !sameAddress(raw.routerResult.toToken.tokenContractAddress, quote.stablecoin)) {
      throw new MainnetPreparationError('OKX swap tokens do not match the quote.');
    }
    if (raw.routerResult.swapMode !== 'exactIn' || raw.routerResult.fromTokenAmount !== quote.assetAmount) {
      throw new MainnetPreparationError('OKX swap is not exact-input or changed the input amount.');
    }
    if (!quote.routerPath || raw.routerResult.router !== quote.routerPath) {
      throw new MainnetPreparationError('OKX swap route does not match the quote.');
    }
    if (quote.quoteId && raw.routerResult.quoteId !== quote.quoteId) throw new MainnetPreparationError('OKX swap quote ID does not match the accepted quote.');
    if (transaction.slippagePercent !== quote.slippagePercent) throw new MainnetPreparationError('OKX swap slippage does not match the quote.');
    if (transaction.value !== '0') throw new MainnetPreparationError('OKX swap unexpectedly sends native OKB.');
    if (!/^\d+$/.test(transaction.minReceiveAmount)
      || BigInt(transaction.minReceiveAmount) < BigInt(quote.minReceiveAmount)
      || BigInt(transaction.minReceiveAmount) > BigInt(raw.routerResult.toTokenAmount)
      || BigInt(raw.routerResult.toTokenAmount) < BigInt(quote.invoiceStablecoinAmount)) {
      throw new MainnetPreparationError('OKX swap minimum receive amount is invalid.');
    }
    if (raw.routerResult.toTokenAmount !== quote.quotedStablecoinAmount) {
      throw new MainnetPreparationError('OKX swap output changed from the accepted quote.');
    }
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
    return transaction;
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
