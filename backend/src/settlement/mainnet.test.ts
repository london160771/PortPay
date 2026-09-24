import { Attribution } from 'ox/erc8021';
import { decodeFunctionData, encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { mainnetAddressConfig } from '../config/xlayerMainnet.js';
import type { Invoice } from '../invoices/types.js';
import type {
  OkxApprovalData,
  OkxDexApiClient,
  OkxQuoteData,
  OkxSwapData,
} from './okxDexApi.js';
import { MainnetPreparationError, OKXDEXMainnetAdapter } from './mainnet.js';

const buyer = '0xbabdfef588cf57efcc7c8857960e3ccdd9167589' as Address;
const merchant = '0x815c2fb8178f0bf80ada8c5b97ff44ece90e6e25' as Address;
const otherMerchant = '0x1111111111111111111111111111111111111111' as Address;
const invoice: Invoice = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Mainnet preparation invoice',
  amountUsdt0: '1',
  merchantAddress: merchant,
  paymentUrl: 'https://pay.example.test/pay/00000000-0000-4000-8000-000000000001',
  status: 'pending',
  paymentNetwork: 'x-layer-mainnet',
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
};

const approveAbi = [{
  type: 'function',
  name: 'approve',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const;
const swapAbi = parseAbi([
  'function dagSwapTo(uint256 orderId, address receiver, (uint256 fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, uint256 deadLine) baseRequest, (address[] mixAdapters, address[] assetTo, uint256[] rawData, bytes[] extraData, uint256 fromToken)[] paths) payable returns (uint256)',
]);
const inputAmount = '2965213342702937';
const spender = '0x8b773d83bc66be128c60e07e17c8901f7a64f000' as Address;
const router = '0x7c5bee2a8091c3ef39072f64f18fac913060aeaf' as Address;
const routePath = `${mainnetAddressConfig.wAapl}--0x779ded0c9e1022225f8e0630b35a9b54be713736`;

function token(address: string, symbol: string, decimal: string): OkxQuoteData['fromToken'] {
  return {
    decimal,
    isHoneyPot: false,
    taxRate: '0',
    tokenContractAddress: address,
    tokenSymbol: symbol,
    tokenUnitPrice: '1',
  };
}

function quoteData(overrides: Partial<OkxQuoteData> = {}): OkxQuoteData {
  const fromToken = token(mainnetAddressConfig.wAapl, 'wAAPLx', '18');
  const toToken = token(mainnetAddressConfig.usdt0, 'USDT', '6');
  return {
    chainIndex: '196',
    dexRouterList: [{ fromToken, toToken, dexProtocol: { dexName: 'Uniswap V3', percent: '100' } }],
    estimateGasFee: '338400',
    fromToken,
    fromTokenAmount: inputAmount,
    priceImpactPercent: '-0.12',
    quoteId: 'quote-1',
    router: routePath,
    swapMode: 'exactIn',
    toToken,
    toTokenAmount: '1001000',
    tradeFee: '0.0006',
    ...overrides,
  };
}

function approvalData(amount = inputAmount, approvalSpender = spender): OkxApprovalData {
  return {
    data: encodeFunctionData({ abi: approveAbi, functionName: 'approve', args: [approvalSpender, BigInt(amount)] }),
    dexContractAddress: approvalSpender,
    gasLimit: '70000',
    gasPrice: '27000001',
  };
}

function encodedSwapData(receiver: Address = merchant, overrides: Partial<{
  fromToken: bigint;
  fromTokenAmount: bigint;
  minReturnAmount: bigint;
  toToken: Address;
}> = {}): Hex {
  return encodeFunctionData({
    abi: swapAbi,
    functionName: 'dagSwapTo',
    args: [1n, receiver, {
      fromToken: overrides.fromToken ?? BigInt(mainnetAddressConfig.wAapl),
      toToken: overrides.toToken ?? mainnetAddressConfig.usdt0 as Address,
      fromTokenAmount: overrides.fromTokenAmount ?? BigInt(inputAmount),
      minReturnAmount: overrides.minReturnAmount ?? 1_000_000n,
      deadLine: 1_790_000_000n,
    }, [{
      mixAdapters: [merchant],
      assetTo: [mainnetAddressConfig.usdt0 as Address],
      rawData: [1n],
      extraData: ['0x'],
      fromToken: BigInt(mainnetAddressConfig.wAapl),
    }]],
  });
}

function swapData(data: Hex = encodedSwapData()): OkxSwapData {
  const rawQuote = quoteData();
  return {
    routerResult: rawQuote,
    tx: {
      data,
      from: buyer,
      gas: '338400',
      gasPrice: '27000001',
      minReceiveAmount: '1000000',
      slippagePercent: '0.5',
      to: router,
      value: '0',
    },
  };
}

class FakeOkxClient {
  quote = quoteData();
  approval = approvalData();
  swap = swapData();

  async getQuote() { return this.quote; }
  async getApprovalTransaction() { return this.approval; }
  async getSwapTransaction() { return this.swap; }
}

function createAdapter(fake = new FakeOkxClient(), nowValue = '2026-09-21T00:00:00.000Z') {
  return {
    adapter: new OKXDEXMainnetAdapter({
      apiClient: fake as unknown as OkxDexApiClient,
      builderCode: 'mainnetcode12345',
      now: () => new Date(nowValue),
    }),
    fake,
  };
}

async function createQuote(adapter: OKXDEXMainnetAdapter) {
  return adapter.getQuote({
    assetAmount: inputAmount,
    assetKey: 'wAapl',
    buyerAddress: buyer,
    invoice,
  });
}

describe('OKXDEXMainnetAdapter preparation boundary', () => {
  it('returns only the configured chain-196 supported assets and binds a quote to the invoice', async () => {
    const { adapter } = createAdapter();
    expect(adapter.getSupportedAssets().map((asset) => asset.symbol)).toEqual(['wNVDAx', 'wAAPLx']);
    const quote = await createQuote(adapter);
    expect(quote.chainId).toBe(196);
    expect(quote.asset.toLowerCase()).toBe(mainnetAddressConfig.wAapl.toLowerCase());
    expect(quote.stablecoin.toLowerCase()).toBe(mainnetAddressConfig.usdt0.toLowerCase());
    expect(quote.merchant.toLowerCase()).toBe(merchant.toLowerCase());
    expect(quote.invoiceStablecoinAmount).toBe('1000000');
    expect(quote.routerPath).toBe(routePath);
  });

  it('uses the fixed proof 1.5% slippage while keeping the encoded minimum above the invoice floor', async () => {
    const fake = new FakeOkxClient();
    const expectedOutput = '1084102';
    const minimumReceive = '1067840';
    fake.quote = quoteData({ toTokenAmount: expectedOutput });
    const unmodifiedSwap = swapData(encodedSwapData(merchant, { minReturnAmount: BigInt(minimumReceive) }));
    fake.swap = {
      ...unmodifiedSwap,
      routerResult: quoteData({ toTokenAmount: expectedOutput }),
      tx: { ...unmodifiedSwap.tx, minReceiveAmount: minimumReceive, slippagePercent: '1.5' },
    };
    const { adapter } = createAdapter(fake);
    const quote = await adapter.getQuote({
      assetAmount: inputAmount,
      assetKey: 'wAapl',
      buyerAddress: buyer,
      invoice,
      slippagePercent: '1.5',
    });

    expect(quote.minReceiveAmount).toBe(minimumReceive);
    expect(BigInt(quote.minReceiveAmount)).toBeGreaterThanOrEqual(BigInt(quote.invoiceStablecoinAmount));
    const prepared = await adapter.prepareSwapTransaction(quote);
    const decoded = decodeFunctionData({ abi: swapAbi, data: prepared.data });
    expect(prepared.minReceiveAmount).toBe(minimumReceive);
    expect(decoded.args[2].minReturnAmount).toBe(BigInt(minimumReceive));
    expect(prepared.execution?.slippagePercent).toBe('1.5');
  });

  it('accepts the 1.5% proof ceiling and rejects any higher mainnet slippage', async () => {
    const { adapter } = createAdapter();
    await expect(adapter.getQuote({ assetAmount: inputAmount, assetKey: 'wAapl', buyerAddress: buyer, invoice, slippagePercent: '1.5' }))
      .resolves.toMatchObject({ slippagePercent: '1.5' });
    for (const slippagePercent of ['1.5001', '1.51', '2']) {
      await expect(adapter.getQuote({ assetAmount: inputAmount, assetKey: 'wAapl', buyerAddress: buyer, invoice, slippagePercent }))
        .rejects.toThrow('Slippage must be between 0 and 1.5 percent.');
    }
  });

  it('prepares exact approval calldata and deterministic ERC-8021 suffix data', async () => {
    const { adapter } = createAdapter();
    const quote = await createQuote(adapter);
    const prepared = await adapter.prepareApprovalTransaction(quote);
    const decoded = decodeFunctionData({ abi: approveAbi, data: prepared.data });
    expect(decoded.functionName).toBe('approve');
    expect((decoded.args?.[0] as string).toLowerCase()).toBe(spender.toLowerCase());
    expect(decoded.args?.[1]).toBe(BigInt(inputAmount));
    expect(prepared.to.toLowerCase()).toBe(mainnetAddressConfig.wAapl.toLowerCase());
    expect(prepared.value).toBe(0n);
    expect(Attribution.fromData(prepared.attributedData!)?.codes).toEqual(['mainnetcode12345']);
    expect(prepared.attributedData!.startsWith(prepared.data)).toBe(true);
    const attributedDecoded = decodeFunctionData({ abi: approveAbi, data: prepared.attributedData! });
    expect(attributedDecoded.args?.[1]).toBe(BigInt(inputAmount));
  });

  it('accepts a direct route leg with exactly one 100% protocol', async () => {
    const { adapter } = createAdapter();
    const quote = await createQuote(adapter);
    const prepared = await adapter.prepareSwapTransaction(quote);
    expect(prepared.from.toLowerCase()).toBe(buyer.toLowerCase());
    expect(prepared.to.toLowerCase()).toBe(router.toLowerCase());
    expect(prepared.value).toBe(0n);
    expect(prepared.minReceiveAmount).toBe('1000000');
    const decoded = decodeFunctionData({ abi: swapAbi, data: prepared.data });
    expect((decoded.args[1] as string).toLowerCase()).toBe(merchant.toLowerCase());
    expect(Attribution.fromData(prepared.attributedData!)?.codes).toEqual(['mainnetcode12345']);
    const attributedDecoded = decodeFunctionData({ abi: swapAbi, data: prepared.attributedData! });
    expect((attributedDecoded.args[1] as string).toLowerCase()).toBe(merchant.toLowerCase());
    await expect(adapter.validatePreparedTransaction(quote, prepared)).resolves.toBeUndefined();
    expect(prepared.execution?.authenticatedResponseHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(prepared.execution?.spender.toLowerCase()).toBe(spender.toLowerCase());
    expect(prepared.execution?.attributedApprovalCalldataHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(prepared.execution?.authenticatedResponse.tx.data).toBe(prepared.data);
    expect(prepared.execution?.route[0]?.protocols).toEqual([{ dexName: 'Uniswap V3', percent: '100' }]);
  });

  it('rejects caller-constructed swap preparation objects without backend-held authenticated provenance', async () => {
    const { adapter } = createAdapter();
    const quote = await createQuote(adapter);
    const prepared = await adapter.prepareSwapTransaction(quote);
    await expect(adapter.validatePreparedTransaction(quote, { ...prepared })).rejects.toThrow('not produced by a fresh authenticated OKX V6 /swap response');
  });

  it('rejects stale quotes, wrong merchant calldata, wrong spender, and wrong router', async () => {
    const staleClock = { value: '2026-09-21T00:00:00.000Z' };
    const staleAdapter = new OKXDEXMainnetAdapter({
      apiClient: new FakeOkxClient() as unknown as OkxDexApiClient,
      builderCode: 'mainnetcode12345',
      now: () => new Date(staleClock.value),
    });
    const staleQuote = await createQuote(staleAdapter);
    staleClock.value = '2026-09-21T00:01:01.000Z';
    await expect(staleAdapter.prepareSwapTransaction(staleQuote)).rejects.toThrow('expired');

    const wrongMerchant = new FakeOkxClient();
    wrongMerchant.swap = swapData(encodedSwapData(otherMerchant));
    const wrongMerchantAdapter = createAdapter(wrongMerchant).adapter;
    const wrongMerchantQuote = await createQuote(wrongMerchantAdapter);
    await expect(wrongMerchantAdapter.prepareSwapTransaction(wrongMerchantQuote)).rejects.toThrow('recipient does not match');

    const wrongSpender = new FakeOkxClient();
    wrongSpender.approval = {
      ...approvalData(inputAmount, otherMerchant),
      dexContractAddress: spender,
    };
    const wrongSpenderAdapter = createAdapter(wrongSpender).adapter;
    const wrongSpenderQuote = await createQuote(wrongSpenderAdapter);
    await expect(wrongSpenderAdapter.getApprovalRequirement(wrongSpenderQuote)).rejects.toThrow('unexpected spender');

    const normal = createAdapter();
    const normalQuote = await createQuote(normal.adapter);
    const prepared = await normal.adapter.prepareSwapTransaction(normalQuote);
    await expect(normal.adapter.validatePreparedTransaction(normalQuote, {
      ...prepared,
      to: otherMerchant,
    })).rejects.toThrow('not produced by a fresh authenticated');
  });

  it('rejects wrong-chain or testnet-token quote data and has no broadcast method', async () => {
    const wrongChain = new FakeOkxClient();
    wrongChain.quote = quoteData({ chainIndex: '1952' });
    await expect(createQuote(createAdapter(wrongChain).adapter)).rejects.toThrow('wrong chain');

    const wrongToken = new FakeOkxClient();
    wrongToken.quote = quoteData({ fromToken: token('0x756546fce7d7ca3bb4be127904b002baf13b432e', 'DemoAAPL', '18') });
    await expect(createQuote(createAdapter(wrongToken).adapter)).rejects.toThrow('unexpected token');

    const { adapter } = createAdapter();
    expect('sendTransaction' in adapter).toBe(false);
    expect(adapter).toBeInstanceOf(OKXDEXMainnetAdapter);
    expect(MainnetPreparationError).toBeDefined();
  });

  it('rejects unlimited approval calldata', async () => {
    const unlimited = new FakeOkxClient();
    unlimited.approval = approvalData((2n ** 256n - 1n).toString());
    const adapter = createAdapter(unlimited).adapter;
    const quote = await createQuote(adapter);
    await expect(adapter.getApprovalRequirement(quote)).rejects.toThrow('Unlimited approvals');
  });

  it('does not accept the merchant address when it appears only in unrelated calldata', async () => {
    const poisoned = new FakeOkxClient();
    poisoned.swap = swapData(encodeFunctionData({
      abi: swapAbi,
      functionName: 'dagSwapTo',
      args: [BigInt(merchant), otherMerchant, {
        fromToken: BigInt(mainnetAddressConfig.wAapl),
        toToken: mainnetAddressConfig.usdt0 as Address,
        fromTokenAmount: BigInt(inputAmount),
        minReturnAmount: 1_000_000n,
        deadLine: 1_790_000_000n,
      }, [{ mixAdapters: [merchant], assetTo: [mainnetAddressConfig.usdt0 as Address], rawData: [1n], extraData: ['0x'], fromToken: BigInt(mainnetAddressConfig.wAapl) }]],
    }));
    const adapter = createAdapter(poisoned).adapter;
    await expect(adapter.prepareSwapTransaction(await createQuote(adapter))).rejects.toThrow('recipient');
  });

  it('rejects swap calldata that changes tokens, exact input, minimum output, or slippage', async () => {
    for (const [data, message] of [
      [encodedSwapData(merchant, { toToken: otherMerchant }), 'tokens, amount, or minimum'],
      [encodedSwapData(merchant, { fromTokenAmount: 1n }), 'tokens, amount, or minimum'],
      [encodedSwapData(merchant, { minReturnAmount: 999_999n }), 'tokens, amount, or minimum'],
    ] as const) {
      const fake = new FakeOkxClient();
      fake.swap = swapData(data);
      const adapter = createAdapter(fake).adapter;
      await expect(adapter.prepareSwapTransaction(await createQuote(adapter))).rejects.toThrow(message);
    }
    const wrongSlippage = new FakeOkxClient();
    wrongSlippage.swap = { ...swapData(), tx: { ...swapData().tx, slippagePercent: '1' } };
    const adapter = createAdapter(wrongSlippage).adapter;
    await expect(adapter.prepareSwapTransaction(await createQuote(adapter))).rejects.toThrow('slippage');

  });

  it('accepts connected multi-hop legs with exactly one 100% protocol per leg when quote IDs differ', async () => {
    const intermediate = '0x2222222222222222222222222222222222222222' as Address;
    const fake = new FakeOkxClient();
    fake.swap = {
      ...swapData(),
      routerResult: quoteData({
        quoteId: 'swap-response-id-is-not-a-binding-field',
        router: `${mainnetAddressConfig.wAapl}--${intermediate}--${mainnetAddressConfig.usdt0}`,
        dexRouterList: [
          { fromToken: token(mainnetAddressConfig.wAapl, 'wAAPLx', '18'), toToken: token(intermediate, 'MID', '18'), fromTokenIndex: '0', toTokenIndex: '1', dexProtocol: { dexName: 'Pool A', percent: '100' } },
          { fromToken: token(intermediate, 'MID', '18'), toToken: token(mainnetAddressConfig.usdt0, 'USD₮0', '6'), fromTokenIndex: '1', toTokenIndex: '2', dexProtocol: { dexName: 'Pool B', percent: '100' } },
        ],
        toTokenAmount: '1002000',
      }),
    };
    const { adapter } = createAdapter(fake);
    const quote = await createQuote(adapter);
    const prepared = await adapter.prepareSwapTransaction(quote);
    expect(prepared.execution?.expectedOutputAmount).toBe('1002000');
    expect(prepared.execution?.routeFingerprint).toMatch(/^0x[0-9a-f]{64}$/);
    expect(prepared.execution?.routePath).not.toBe(quote.routerPath);
    expect(prepared.execution?.route).toHaveLength(2);
    expect(prepared.execution?.route.map((leg) => leg.protocols)).toEqual([
      [{ dexName: 'Pool A', percent: '100' }],
      [{ dexName: 'Pool B', percent: '100' }],
    ]);
    await expect(adapter.validatePreparedTransaction(quote, prepared)).resolves.toBeUndefined();
  });

  it.each([
    ['two-protocol 50/50 split', [
      { dexName: 'Pool A', percent: '50' },
      { dexName: 'Pool B', percent: '50' },
    ], 'exactly one protocol'],
    ['two-protocol 70/30 split', [
      { dexName: 'Pool A', percent: '70' },
      { dexName: 'Pool B', percent: '30' },
    ], 'exactly one protocol'],
    ['one protocol at 99%', { dexName: 'Pool A', percent: '99' }, 'exactly 100%'],
    ['empty protocol list', [], 'exactly one protocol'],
  ] as const)('rejects %s', async (_caseName, dexProtocol, expectedMessage) => {
    const fake = new FakeOkxClient();
    fake.swap = {
      ...swapData(),
      routerResult: quoteData({
        dexRouterList: [{
          fromToken: token(mainnetAddressConfig.wAapl, 'wAAPLx', '18'),
          toToken: token(mainnetAddressConfig.usdt0, 'USD₮0', '6'),
          dexProtocol,
        }],
      }),
    };
    const { adapter } = createAdapter(fake);
    await expect(adapter.prepareSwapTransaction(await createQuote(adapter))).rejects.toThrow(expectedMessage);
  });

  it.each([
    ['disconnected intermediate leg', (asset: Address, stablecoin: Address, middle: Address) => ({
      router: `${asset}--${middle}--${stablecoin}`,
      dexRouterList: [
        { fromToken: token(asset, 'wAAPLx', '18'), toToken: token(middle, 'MID', '18'), dexProtocol: { dexName: 'Pool A', percent: '100' } },
        { fromToken: token(otherMerchant, 'OTHER', '18'), toToken: token(stablecoin, 'USD₮0', '6'), dexProtocol: { dexName: 'Pool B', percent: '100' } },
      ],
    }), 'disconnected or reordered'],
    ['wrong starting token', (asset: Address, stablecoin: Address) => ({
      router: `${asset}--${stablecoin}`,
      dexRouterList: [{ fromToken: token(otherMerchant, 'OTHER', '18'), toToken: token(stablecoin, 'USD₮0', '6'), dexProtocol: { dexName: 'Pool', percent: '100' } }],
    }), 'start at the selected asset'],
    ['wrong final token', (asset: Address, stablecoin: Address) => ({
      router: `${asset}--${stablecoin}`,
      dexRouterList: [{ fromToken: token(asset, 'wAAPLx', '18'), toToken: token(otherMerchant, 'OTHER', '6'), dexProtocol: { dexName: 'Pool', percent: '100' } }],
    }), 'end at official USD₮0'],
    ['reordered legs', (asset: Address, stablecoin: Address, middle: Address) => ({
      router: `${asset}--${middle}--${stablecoin}`,
      dexRouterList: [
        { fromToken: token(middle, 'MID', '18'), toToken: token(stablecoin, 'USD₮0', '6'), fromTokenIndex: '1', toTokenIndex: '2', dexProtocol: { dexName: 'Pool B', percent: '100' } },
        { fromToken: token(asset, 'wAAPLx', '18'), toToken: token(middle, 'MID', '18'), fromTokenIndex: '0', toTokenIndex: '1', dexProtocol: { dexName: 'Pool A', percent: '100' } },
      ],
    }), 'start at the selected asset'],
    ['duplicate unrelated route leg', (asset: Address, stablecoin: Address) => ({
      router: `${asset}--${stablecoin}`,
      dexRouterList: [
        { fromToken: token(asset, 'wAAPLx', '18'), toToken: token(stablecoin, 'USD₮0', '6'), dexProtocol: { dexName: 'Pool A', percent: '100' } },
        { fromToken: token(asset, 'wAAPLx', '18'), toToken: token(stablecoin, 'USD₮0', '6'), dexProtocol: { dexName: 'Pool A', percent: '100' } },
      ],
    }), 'disconnected or reordered'],
    ['malformed route indices', (asset: Address, stablecoin: Address) => ({
      router: `${asset}--${stablecoin}`,
      dexRouterList: [{ fromToken: token(asset, 'wAAPLx', '18'), toToken: token(stablecoin, 'USD₮0', '6'), fromTokenIndex: 'bad', toTokenIndex: '1', dexProtocol: { dexName: 'Pool', percent: '100' } }],
    }), 'malformed token-index'],
  ])('rejects %s', async (_name, makeRoute, message) => {
    const fake = new FakeOkxClient();
    const middle = '0x2222222222222222222222222222222222222222' as Address;
    fake.swap = { ...swapData(), routerResult: quoteData(makeRoute(mainnetAddressConfig.wAapl as Address, mainnetAddressConfig.usdt0 as Address, middle)) };
    const { adapter } = createAdapter(fake);
    await expect(adapter.prepareSwapTransaction(await createQuote(adapter))).rejects.toThrow(message);
  });

  it('rejects final swap preparations that miss invoice value or contain malformed/mismatched route intent', async () => {
    const cases: Array<{ mutate: (fake: FakeOkxClient) => void; message: string }> = [
      { mutate: (fake) => { fake.swap = { ...swapData(), routerResult: quoteData({ toTokenAmount: '999999' }), tx: { ...swapData().tx, minReceiveAmount: '999999' } }; }, message: 'minimum receive' },
      { mutate: (fake) => { fake.swap = { ...swapData(), routerResult: quoteData({ router: `0x1111111111111111111111111111111111111111--${mainnetAddressConfig.usdt0}` }) }; }, message: 'malformed' },
      { mutate: (fake) => { fake.swap = { ...swapData(), routerResult: quoteData({ fromTokenAmount: '1' }) }; }, message: 'amounts are inconsistent' },
      { mutate: (fake) => { fake.swap = { ...swapData(), routerResult: quoteData({ toToken: token(otherMerchant, 'Other', '6') }) }; }, message: 'unexpected token' },
    ];
    for (const testCase of cases) {
      const fake = new FakeOkxClient();
      testCase.mutate(fake);
      const { adapter } = createAdapter(fake);
      await expect(adapter.prepareSwapTransaction(await createQuote(adapter))).rejects.toThrow(testCase.message);
    }
  });

  it('treats exact-input as a maximum debit and permits receipt-verified refunds', async () => {
    const accepted = createAdapter();
    const acceptedQuote = await createQuote(accepted.adapter);
    const fullSpend = await accepted.adapter.prepareSwapTransaction(acceptedQuote);
    expect(fullSpend.execution?.inputConsumptionMode).toBe('exact-in-max-debit-net-observed');

    const partialApi = new FakeOkxClient();
    partialApi.swap = {
      ...swapData(),
      tx: { ...swapData().tx, refundAmount: '1' } as OkxSwapData['tx'],
    };
    const partialAdapter = createAdapter(partialApi);
    const refundPreparation = await partialAdapter.adapter.prepareSwapTransaction(await createQuote(partialAdapter.adapter));
    expect(refundPreparation.execution?.inputConsumptionMode).toBe('exact-in-max-debit-net-observed');

    const ambiguousApi = new FakeOkxClient();
    ambiguousApi.swap = {
      ...swapData(),
      routerResult: quoteData({ swapMode: undefined }),
    };
    const ambiguousAdapter = createAdapter(ambiguousApi);
    await expect(ambiguousAdapter.adapter.prepareSwapTransaction(await createQuote(ambiguousAdapter.adapter)))
      .rejects.toThrow(/exact-input mode/);
  });

  it('binds final attributed calldata and freshness into reconciliation execution evidence', async () => {
    const { adapter } = createAdapter();
    const quote = await createQuote(adapter);
    const prepared = await adapter.prepareSwapTransaction(quote);
    expect(prepared.execution?.attributedSwapCalldataHash).toBeTruthy();
    expect(prepared.execution?.previewQuoteHash).toBeTruthy();
    expect(prepared.execution?.preparedAt).toBe('2026-09-21T00:00:00.000Z');
    expect(Date.parse(prepared.execution!.expiresAt)).toBeLessThanOrEqual(Date.parse(quote.expiresAt));
    await expect(adapter.validatePreparedTransaction(quote, {
      ...prepared,
      attributedData: `${prepared.attributedData!.slice(0, -2)}00` as Hex,
    })).rejects.toThrow('suffix is not appended');
  });

  it('rejects the verified testnet Builder Code even if no environment variable is set', () => {
    expect(() => new OKXDEXMainnetAdapter({
      apiClient: new FakeOkxClient() as unknown as OkxDexApiClient,
      builderCode: ' kob1lkgsg6infkg3 ',
    })).toThrow('separate from the verified testnet Builder Code');
  });

  it('fails validation if configured attribution is stripped from a prepared transaction', async () => {
    const { adapter } = createAdapter();
    const quote = await createQuote(adapter);
    const prepared = await adapter.prepareApprovalTransaction(quote);
    await expect(adapter.validatePreparedTransaction(quote, {
      ...prepared,
      attributedData: undefined,
      builderCode: undefined,
      dataSuffix: undefined,
    })).rejects.toThrow('Builder Code fields');
  });
});
