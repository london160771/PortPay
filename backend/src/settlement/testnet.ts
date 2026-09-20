import {
  createPublicClient,
  defineChain,
  formatUnits,
  getAddress,
  hashTypedData,
  http,
  isAddress,
  keccak256,
  parseEventLogs,
  parseUnits,
  stringToBytes,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { portPayAddressConfig, xLayerTestnet } from '../config/xlayer.js';
import type { Invoice, PaymentEvidence } from '../invoices/types.js';
import {
  validateMerchantAddress,
  validateTransactionHash,
} from '../invoices/validation.js';
import type {
  ReconcilePaymentInput,
  SettlementAdapter,
  SettlementQuoteData,
  SettlementQuoteResponse,
} from './types.js';
import {
  SettlementNotConfiguredError,
  SettlementQuoteError,
  SettlementVerificationError,
} from './types.js';

export const settlementQuoteTypes = {
  SettlementQuote: [
    { name: 'invoiceId', type: 'bytes32' },
    { name: 'buyer', type: 'address' },
    { name: 'merchant', type: 'address' },
    { name: 'asset', type: 'address' },
    { name: 'assetAmount', type: 'uint256' },
    { name: 'stablecoin', type: 'address' },
    { name: 'stablecoinAmount', type: 'uint256' },
    { name: 'chainId', type: 'uint256' },
    { name: 'settlementContract', type: 'address' },
    { name: 'expiry', type: 'uint256' },
  ],
} as const;

export const tokenMetadataAbi = [
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

export const portPaySettlementAbi = [
  {
    type: 'event',
    name: 'SettlementExecuted',
    anonymous: false,
    inputs: [
      { indexed: true, name: 'invoiceId', type: 'bytes32' },
      { indexed: true, name: 'buyer', type: 'address' },
      { indexed: true, name: 'merchant', type: 'address' },
      { indexed: false, name: 'asset', type: 'address' },
      { indexed: false, name: 'assetAmount', type: 'uint256' },
      { indexed: false, name: 'stablecoin', type: 'address' },
      { indexed: false, name: 'stablecoinAmount', type: 'uint256' },
      { indexed: false, name: 'expiry', type: 'uint256' },
      { indexed: false, name: 'quoteId', type: 'bytes32' },
    ],
  },
] as const;

type SettlementEventArgs = {
  invoiceId: Hex;
  buyer: Address;
  merchant: Address;
  asset: Address;
  assetAmount: bigint;
  stablecoin: Address;
  stablecoinAmount: bigint;
  expiry: bigint;
  quoteId: Hex;
};

type PublicClientLike = {
  getChainId(): Promise<number>;
  readContract(args: {
    address: Address;
    abi: typeof tokenMetadataAbi;
    functionName: 'decimals';
  }): Promise<unknown>;
  getTransactionReceipt(args: { hash: Hex }): Promise<{
    status: 'success' | 'reverted';
    to: Address | null;
    from: Address;
    blockNumber: bigint;
    blockHash: Hex | null;
    logs: readonly { address: Address; [key: string]: unknown }[];
  }>;
  getBlockNumber(): Promise<bigint>;
  getBlock(args: { blockNumber: bigint }): Promise<{ hash: Hex | null }>;
};

type TestnetAdapterOptions = {
  quoteSignerPrivateKey?: Hex;
  publicClient?: PublicClientLike;
  quoteTtlSeconds?: number;
  confirmationDepth?: number;
  referencePriceUsd?: string;
  demoAaplDecimals?: number;
  stablecoinDecimals?: number;
  addressConfig?: {
    testnetUsdt0: string;
    demoAapl: string;
    settlement: string;
  };
};

const DEFAULT_REFERENCE_PRICE_USD = '250.00';
const DEFAULT_QUOTE_TTL_SECONDS = 300;
const DEFAULT_CONFIRMATION_DEPTH = 2;

const liveXLayerChain = defineChain({
  id: xLayerTestnet.chainId,
  name: xLayerTestnet.name,
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: [xLayerTestnet.rpcUrl] } },
  blockExplorers: { default: { name: 'OKX Explorer', url: xLayerTestnet.explorerUrl } },
});

function createDefaultPublicClient(): PublicClientLike {
  return createPublicClient({
    chain: liveXLayerChain,
    transport: http(xLayerTestnet.rpcUrl),
  }) as unknown as PublicClientLike;
}

export function hashInvoiceId(invoiceId: string): Hex {
  return keccak256(stringToBytes(invoiceId));
}

export function calculateAssetAmount(
  stablecoinAmount: bigint,
  referencePriceUsd: string,
  stablecoinDecimals: number,
  assetDecimals: number,
): bigint {
  if (stablecoinAmount <= 0n || assetDecimals < 0 || stablecoinDecimals < 0) {
    throw new SettlementQuoteError('Settlement amounts and token decimals must be positive.');
  }

  let priceBase: bigint;
  try {
    priceBase = parseUnits(referencePriceUsd, stablecoinDecimals);
  } catch {
    throw new SettlementQuoteError('The DemoAAPL reference price is invalid.');
  }
  if (priceBase <= 0n) throw new SettlementQuoteError('The DemoAAPL reference price must be positive.');

  const numerator = stablecoinAmount * 10n ** BigInt(assetDecimals);
  if (numerator % priceBase !== 0n) {
    throw new SettlementQuoteError(
      'This invoice amount cannot be represented exactly at the configured DemoAAPL reference price.',
    );
  }

  const assetAmount = numerator / priceBase;
  if (assetAmount <= 0n) throw new SettlementQuoteError('The invoice amount produces no spendable DemoAAPL units.');
  return assetAmount;
}

function normalizeAddress(value: string, label: string): Address {
  if (!isAddress(value)) throw new SettlementNotConfiguredError(`${label} is not configured as an EVM address.`);
  return getAddress(value);
}

function normalizeBuyer(value: string): Address {
  try {
    return getAddress(validateMerchantAddress(value));
  } catch {
    throw new SettlementQuoteError('Buyer wallet address must be a valid EVM address.');
  }
}

function getQuoteSigner(privateKey: Hex | undefined) {
  if (!privateKey) {
    throw new SettlementNotConfiguredError(
      'QUOTE_SIGNER_PRIVATE_KEY is required before PortPay can issue settlement quotes.',
    );
  }
  try {
    return privateKeyToAccount(privateKey);
  } catch {
    throw new SettlementNotConfiguredError('QUOTE_SIGNER_PRIVATE_KEY is invalid.');
  }
}

function envValue(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

function envPositiveInteger(name: string, fallback: number): number {
  const configured = envValue(name);
  if (!configured) return fallback;
  return Number(configured);
}

export class TestnetSettlementAdapter implements SettlementAdapter {
  readonly name = 'TestnetSettlementAdapter' as const;

  private readonly quoteSignerPrivateKey?: Hex;
  private readonly publicClient: PublicClientLike;
  private readonly quoteTtlSeconds: number;
  private readonly confirmationDepth: number;
  private readonly referencePriceUsd: string;
  private readonly configuredDemoAaplDecimals?: number;
  private readonly configuredStablecoinDecimals?: number;
  private readonly addresses: TestnetAdapterOptions['addressConfig'];

  constructor(options: TestnetAdapterOptions = {}) {
    this.quoteSignerPrivateKey =
      options.quoteSignerPrivateKey || (envValue('QUOTE_SIGNER_PRIVATE_KEY') as Hex | undefined);
    this.publicClient = options.publicClient || createDefaultPublicClient();
    this.quoteTtlSeconds = options.quoteTtlSeconds ?? envPositiveInteger('QUOTE_TTL_SECONDS', DEFAULT_QUOTE_TTL_SECONDS);
    if (!Number.isInteger(this.quoteTtlSeconds) || this.quoteTtlSeconds < 1 || this.quoteTtlSeconds > 300) {
      throw new SettlementNotConfiguredError('QUOTE_TTL_SECONDS must be between 1 and 300.');
    }
    this.confirmationDepth =
      options.confirmationDepth ?? envPositiveInteger('SETTLEMENT_CONFIRMATION_DEPTH', DEFAULT_CONFIRMATION_DEPTH);
    if (!Number.isInteger(this.confirmationDepth) || this.confirmationDepth < 1 || this.confirmationDepth > 64) {
      throw new SettlementNotConfiguredError('SETTLEMENT_CONFIRMATION_DEPTH must be between 1 and 64.');
    }
    this.referencePriceUsd = options.referencePriceUsd || envValue('DEMO_AAPL_REFERENCE_PRICE_USD', DEFAULT_REFERENCE_PRICE_USD);
    this.configuredDemoAaplDecimals = options.demoAaplDecimals;
    this.configuredStablecoinDecimals = options.stablecoinDecimals;
    this.addresses = options.addressConfig || {
      testnetUsdt0: portPayAddressConfig.testnetUsdt0,
      demoAapl: portPayAddressConfig.demoAapl,
      settlement: portPayAddressConfig.settlement,
    };
  }

  async createQuote(invoice: Invoice, buyerAddress: string): Promise<SettlementQuoteResponse> {
    if (invoice.status !== 'pending') {
      throw new SettlementQuoteError('This invoice is already paid and cannot be quoted again.');
    }

    const buyer = normalizeBuyer(buyerAddress);
    const merchant = normalizeAddress(invoice.merchantAddress, 'Merchant wallet');
    const asset = normalizeAddress(this.addresses?.demoAapl || '', 'DEMO_AAPL_ADDRESS');
    const stablecoin = normalizeAddress(this.addresses?.testnetUsdt0 || '', 'TESTNET_USDT0_ADDRESS');
    const settlementContract = normalizeAddress(
      this.addresses?.settlement || '',
      'PORTPAY_SETTLEMENT_ADDRESS',
    );
    const signer = getQuoteSigner(this.quoteSignerPrivateKey);
    await this.assertTestnetChain();
    const [assetDecimals, stablecoinDecimals] = await this.readTokenDecimals(asset, stablecoin);
    const stablecoinAmount = parseUnits(invoice.amountUsdt0, stablecoinDecimals);
    const assetAmount = calculateAssetAmount(
      stablecoinAmount,
      this.referencePriceUsd,
      stablecoinDecimals,
      assetDecimals,
    );
    const expiry = BigInt(Math.floor(Date.now() / 1000) + this.quoteTtlSeconds);
    const quote: SettlementQuoteData = {
      invoiceId: hashInvoiceId(invoice.id),
      buyer,
      merchant,
      asset,
      assetAmount: assetAmount.toString(),
      stablecoin,
      stablecoinAmount: stablecoinAmount.toString(),
      chainId: xLayerTestnet.chainId,
      settlementContract,
      expiry: expiry.toString(),
    };
    const typedMessage = {
      invoiceId: quote.invoiceId,
      buyer: quote.buyer,
      merchant: quote.merchant,
      asset: quote.asset,
      assetAmount,
      stablecoin: quote.stablecoin,
      stablecoinAmount,
      chainId: BigInt(quote.chainId),
      settlementContract: quote.settlementContract,
      expiry,
    };
    const domain = {
      name: 'PortPaySettlement',
      version: '1',
      chainId: xLayerTestnet.chainId,
      verifyingContract: settlementContract,
    } as const;
    const quoteId = hashTypedData({
      domain,
      types: settlementQuoteTypes,
      primaryType: 'SettlementQuote',
      message: typedMessage,
    });
    const signature = await signer.signTypedData({
      domain,
      types: settlementQuoteTypes,
      primaryType: 'SettlementQuote',
      message: typedMessage,
    });

    return {
      invoiceId: invoice.id,
      invoiceIdHash: quote.invoiceId,
      quote,
      quoteId,
      signature,
      assetDecimals,
      stablecoinDecimals,
      assetAmount: formatUnits(assetAmount, assetDecimals),
      stablecoinAmount: formatUnits(stablecoinAmount, stablecoinDecimals),
      referencePriceUsd: this.referencePriceUsd,
      expiresAt: new Date(Number(expiry) * 1000).toISOString(),
    };
  }

  async reconcilePayment(invoice: Invoice, input: ReconcilePaymentInput): Promise<PaymentEvidence> {
    const txHash = validateTransactionHash(input.txHash);
    const buyer = normalizeBuyer(input.buyerAddress);
    const merchant = normalizeAddress(invoice.merchantAddress, 'Merchant wallet');
    const asset = normalizeAddress(this.addresses?.demoAapl || '', 'DEMO_AAPL_ADDRESS');
    const stablecoin = normalizeAddress(this.addresses?.testnetUsdt0 || '', 'TESTNET_USDT0_ADDRESS');
    const settlementContract = normalizeAddress(
      this.addresses?.settlement || '',
      'PORTPAY_SETTLEMENT_ADDRESS',
    );
    await this.assertTestnetChain();
    const [, stablecoinDecimals] = await this.readTokenDecimals(asset, stablecoin);
    const expectedStablecoinAmount = parseUnits(invoice.amountUsdt0, stablecoinDecimals);

    let receipt;
    try {
      receipt = await this.publicClient.getTransactionReceipt({ hash: txHash });
    } catch {
      throw new SettlementVerificationError('The settlement transaction could not be read from X Layer Testnet.');
    }
    if (receipt.status !== 'success') {
      throw new SettlementVerificationError('The settlement transaction failed on X Layer Testnet.');
    }
    if (!receipt.to || receipt.to.toLowerCase() !== settlementContract.toLowerCase()) {
      throw new SettlementVerificationError('The transaction was not sent to the configured PortPaySettlement contract.');
    }
    if (!receipt.from || receipt.from.toLowerCase() !== buyer.toLowerCase()) {
      throw new SettlementVerificationError('The transaction sender does not match the settlement buyer.');
    }

    let canonicalBlock: { hash: Hex | null };
    let latestBlockNumber: bigint;
    try {
      [canonicalBlock, latestBlockNumber] = await Promise.all([
        this.publicClient.getBlock({ blockNumber: receipt.blockNumber }),
        this.publicClient.getBlockNumber(),
      ]);
    } catch {
      throw new SettlementVerificationError('The settlement receipt could not be checked for canonicality and confirmations.');
    }
    if (!receipt.blockHash || !canonicalBlock.hash || canonicalBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
      throw new SettlementVerificationError('The settlement receipt is not from the canonical X Layer Testnet block.');
    }
    const confirmations =
      latestBlockNumber >= receipt.blockNumber ? latestBlockNumber - receipt.blockNumber + 1n : 0n;
    if (confirmations < BigInt(this.confirmationDepth)) {
      throw new SettlementVerificationError(
        `The settlement transaction requires ${this.confirmationDepth} confirmations before the invoice can be paid.`,
      );
    }

    try {
      const recheckedReceipt = await this.publicClient.getTransactionReceipt({ hash: txHash });
      if (
        recheckedReceipt.status !== 'success' ||
        recheckedReceipt.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase() ||
        recheckedReceipt.blockNumber !== receipt.blockNumber
      ) {
        throw new Error('receipt changed');
      }
      receipt = recheckedReceipt;
    } catch {
      throw new SettlementVerificationError('The settlement receipt changed or could not be re-read after confirmation.');
    }

    let events: readonly { args: SettlementEventArgs }[];
    try {
      events = parseEventLogs({
        abi: portPaySettlementAbi,
        logs: receipt.logs.filter((log) => log.address.toLowerCase() === settlementContract.toLowerCase()) as never,
        eventName: 'SettlementExecuted',
        strict: true,
      }) as unknown as readonly { args: SettlementEventArgs }[];
    } catch {
      throw new SettlementVerificationError('The transaction does not contain a valid PortPay settlement event.');
    }
    if (events.length !== 1) {
      throw new SettlementVerificationError('The transaction must contain exactly one PortPay settlement event.');
    }

    const event = events[0].args;
    if (event.invoiceId.toLowerCase() !== hashInvoiceId(invoice.id).toLowerCase()) {
      throw new SettlementVerificationError('The settlement event is bound to a different invoice.');
    }
    if (event.buyer.toLowerCase() !== buyer.toLowerCase()) {
      throw new SettlementVerificationError('The settlement event buyer does not match the connected wallet.');
    }
    if (event.merchant.toLowerCase() !== merchant.toLowerCase()) {
      throw new SettlementVerificationError('The settlement event merchant does not match the invoice.');
    }
    if (event.asset.toLowerCase() !== asset.toLowerCase() || event.stablecoin.toLowerCase() !== stablecoin.toLowerCase()) {
      throw new SettlementVerificationError('The settlement event contains an unsupported token.');
    }
    if (event.assetAmount <= 0n || event.stablecoinAmount !== expectedStablecoinAmount) {
      throw new SettlementVerificationError('The settlement event amounts do not match the invoice.');
    }

    return {
      paymentTxHash: txHash,
      paidAt: new Date().toISOString(),
      buyerAddress: buyer.toLowerCase(),
      spentAsset: asset.toLowerCase(),
      spentAmount: event.assetAmount.toString(),
      stablecoinReceived: formatUnits(event.stablecoinAmount, stablecoinDecimals),
      quoteId: event.quoteId,
      settlementContract: settlementContract.toLowerCase(),
      settlementBlockNumber: receipt.blockNumber.toString(),
    };
  }

  private async assertTestnetChain(): Promise<void> {
    let chainId: number;
    try {
      chainId = await this.publicClient.getChainId();
    } catch {
      throw new SettlementVerificationError('Unable to verify the X Layer Testnet RPC chain ID.');
    }
    if (chainId !== xLayerTestnet.chainId) {
      throw new SettlementVerificationError('The configured RPC is not X Layer Testnet.');
    }
  }

  private async readTokenDecimals(asset: Address, stablecoin: Address): Promise<[number, number]> {
    const assetDecimals = this.configuredDemoAaplDecimals ?? await this.readDecimals(asset);
    const stablecoinDecimals = this.configuredStablecoinDecimals ?? await this.readDecimals(stablecoin);
    if (!Number.isInteger(assetDecimals) || !Number.isInteger(stablecoinDecimals)) {
      throw new SettlementVerificationError('Token decimals could not be read from the configured contracts.');
    }
    return [assetDecimals, stablecoinDecimals];
  }

  private async readDecimals(address: Address): Promise<number> {
    try {
      const decimals = await this.publicClient.readContract({
        address,
        abi: tokenMetadataAbi,
        functionName: 'decimals',
      });
      if (typeof decimals !== 'number') throw new Error('invalid decimals');
      return decimals;
    } catch {
      throw new SettlementVerificationError(`Unable to read decimals from ${address}.`);
    }
  }
}

export function createTestnetSettlementAdapter(): SettlementAdapter {
  return new TestnetSettlementAdapter();
}
