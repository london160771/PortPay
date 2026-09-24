import { encodeAbiParameters, encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { mainnetAddressConfig } from '../config/xlayerMainnet.js';
import type { Invoice } from '../invoices/types.js';
import type { OkxApprovalData, OkxDexApiClient, OkxQuoteData, OkxSwapData } from './okxDexApi.js';
import { OKXDEXMainnetAdapter } from './mainnet.js';
import { InMemoryMainnetReconciliationRepository, persistMainnetPreparation, type MainnetReconciliationRepository } from './mainnetReconciliationRepository.js';
import { createMainnetPaymentService } from './mainnetPayment.js';
import type { MainnetBuilderCodeCheck } from './mainnetBuilderCodes.js';
import type { MainnetReadOnlyClient } from './mainnetPreflight.js';
import type { MainnetReceiptClient } from './mainnetReceipt.js';

const buyer = '0xbabdfef588cf57efcc7c8857960e3ccdd9167589' as Address;
const merchant = '0x815c2fb8178f0bf80ada8c5b97ff44ece90e6e25' as Address;
const router = '0x7c5bee2a8091c3ef39072f64f18fac913060aeaf' as Address;
const spender = '0x8b773d83bc66be128c60e07e17c8901f7a64f000' as Address;
const builderCode = 'mainnetcode12345';
const inputAmount = '4800000000000000';
const buyerSignature = `0x${'a'.repeat(130)}` as Hex;
const nowIso = '2026-09-23T00:00:00.000Z';
const nowMs = Date.parse(nowIso);
const snapshotHash = `0x${'d'.repeat(64)}` as Hex;
const deadline = BigInt(Math.floor((nowMs + 55_000) / 1000));
const invoice: Invoice = {
  id: '00000000-0000-4000-8000-000000000001', title: 'Mainnet recheck', amountUsdt0: '1',
  merchantAddress: merchant, paymentUrl: 'https://portpay.example/pay/00000000-0000-4000-8000-000000000001',
  status: 'pending', paymentNetwork: 'x-layer-mainnet', createdAt: nowIso, updatedAt: nowIso,
};
const swapAbi = parseAbi(['function dagSwapTo(uint256 orderId, address receiver, (uint256 fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, uint256 deadLine) baseRequest, (address[] mixAdapters, address[] assetTo, uint256[] rawData, bytes[] extraData, uint256 fromToken)[] paths) payable returns (uint256)']);
const approveAbi = [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }] as const;

function token(address: string, symbol: string, decimal: string): OkxQuoteData['fromToken'] {
  return { decimal, isHoneyPot: false, taxRate: '0', tokenContractAddress: address, tokenSymbol: symbol, tokenUnitPrice: '1' };
}
function quoteData(): OkxQuoteData {
  const input = token(mainnetAddressConfig.wNvda, 'wNVDAx', '18');
  const output = token(mainnetAddressConfig.usdt0, 'USD₮0', '6');
  return {
    chainIndex: '196', dexRouterList: [{ fromToken: input, toToken: output, dexProtocol: { dexName: 'Test route', percent: '100' } }],
    estimateGasFee: '300000', fromToken: input, fromTokenAmount: inputAmount, priceImpactPercent: '-0.1',
    router: `${mainnetAddressConfig.wNvda}--${mainnetAddressConfig.usdt0}`, swapMode: 'exactIn',
    toToken: output, toTokenAmount: '1010000', tradeFee: '0',
  };
}
function approvalResponse(): OkxApprovalData {
  return {
    data: encodeFunctionData({ abi: approveAbi, functionName: 'approve', args: [spender, BigInt(inputAmount)] }),
    dexContractAddress: spender, gasLimit: '70000', gasPrice: '1000000',
  };
}
function swapResponse(): OkxSwapData {
  const data = encodeFunctionData({
    abi: swapAbi, functionName: 'dagSwapTo',
    args: [1n, merchant, {
      fromToken: BigInt(mainnetAddressConfig.wNvda), toToken: mainnetAddressConfig.usdt0 as Address,
      fromTokenAmount: BigInt(inputAmount), minReturnAmount: 1_000_000n, deadLine: deadline,
    }, [{ mixAdapters: [merchant], assetTo: [mainnetAddressConfig.usdt0 as Address], rawData: [1n], extraData: ['0x'], fromToken: BigInt(mainnetAddressConfig.wNvda) }]],
  });
  return {
    routerResult: quoteData(),
    tx: { data, from: buyer, gas: '300000', gasPrice: '1000000', minReceiveAmount: '1000000', slippagePercent: '1.5', to: router, value: '0' },
  };
}
class FakeApi {
  swapCalls = 0;
  approvalCalls = 0;
  async getQuote() { return quoteData(); }
  async getApprovalTransaction() { this.approvalCalls += 1; return approvalResponse(); }
  async getSwapTransaction() { this.swapCalls += 1; return swapResponse(); }
}
const verifiedBuilder = async ({ code, expectedPayoutAddress }: { code: string; expectedPayoutAddress?: string }): Promise<MainnetBuilderCodeCheck> => ({
  status: 'VERIFIED', code, payoutAddress: expectedPayoutAddress as Address, expectedPayoutAddress: expectedPayoutAddress as Address,
  registryAddress: '0xd6c426f9c077358735622ae5a83468dc0510823b' as Address, chainId: 196,
});

type ClientOptions = { chainId?: number; allowance?: bigint; buyerBalance?: bigint; okbBalance?: bigint; estimateError?: boolean; callError?: boolean };
function makeClient(options: ClientOptions = {}, observations: { estimates: Hex[]; calls: Hex[]; swapCalldata?: Hex } = { estimates: [], calls: [] }): MainnetReadOnlyClient & MainnetReceiptClient {
  return {
    async getChainId() { return options.chainId ?? 196; },
    async getBlockNumber() { return 50n; },
    async getBlock({ blockNumber }) { return { number: blockNumber, hash: snapshotHash, parentHash: `0x${'c'.repeat(64)}` as Hex, timestamp: 1_790_000_000n }; },
    async readContract(args) {
      if (args.functionName === 'balanceOf' && args.args?.[0]?.toString().toLowerCase() === buyer.toLowerCase()) return options.buyerBalance ?? BigInt(inputAmount) + 10n;
      if (args.functionName === 'balanceOf') return 0n;
      if (args.functionName === 'allowance') return options.allowance ?? BigInt(inputAmount);
      if (args.functionName === 'decimals') return args.address.toLowerCase() === mainnetAddressConfig.usdt0.toLowerCase() ? 6 : 18;
      throw new Error(`Unexpected read ${args.functionName}`);
    },
    async getBalance() { return options.okbBalance ?? 10n ** 18n; },
    async estimateGas(args) {
      observations.estimates.push(args.data);
      if (options.estimateError && args.to.toLowerCase() === router.toLowerCase()) throw new Error('exact swap estimate failed');
      return args.to.toLowerCase() === mainnetAddressConfig.wNvda.toLowerCase() ? 70_000n : 300_000n;
    },
    async getGasPrice() { return 1n; },
    async call(args) {
      observations.calls.push(args.data);
      if (options.callError) throw new Error('exact swap call failed');
      return encodeAbiParameters([{ type: 'bool' }], [true]);
    },
    async getTransaction() { return { from: buyer, to: router, input: observations.swapCalldata ?? '0x' as Hex, value: 0n }; },
    async getTransactionReceipt() { throw new Error('not used by readiness/submission tests'); },
  } as MainnetReadOnlyClient & MainnetReceiptClient & { swapCalldata?: Hex };
}

async function setup(options: ClientOptions = {}) {
  const api = new FakeApi();
  const adapter = new OKXDEXMainnetAdapter({ apiClient: api as unknown as OkxDexApiClient, builderCode, now: () => new Date(nowIso) });
  const quote = await adapter.getQuote({ assetAmount: inputAmount, assetKey: 'wNvda', buyerAddress: buyer, invoice, slippagePercent: '1.5' });
  const approval = await adapter.prepareApprovalTransaction(quote);
  const swap = await adapter.prepareSwapTransaction(quote);
  let clock = new Date(nowIso);
  const repository = new InMemoryMainnetReconciliationRepository(() => clock);
  const evidence = await persistMainnetPreparation({
    repository, quote, approval, swap, builderPayout: buyer, snapshotBlockNumber: 49n, snapshotBlockHash: snapshotHash,
  });
  const observations: { estimates: Hex[]; calls: Hex[]; swapCalldata?: Hex } = { estimates: [], calls: [], swapCalldata: evidence.attributedSwapCalldata };
  const publicClient = makeClient(options, observations);
  const service = createMainnetPaymentService({
    createRepository: () => repository, publicClient, now: () => clock,
    verifyBuilderCode: verifiedBuilder, mainnetBuilderCode: builderCode, mainnetBuilderPayoutAddress: buyer,
    verifyBuyerHandoffSignature: async () => true,
  });
  return { adapter, api, quote, approval, swap, repository, evidence, publicClient, service, observations, setClock: (value: Date) => { clock = value; } };
}

describe('mainnet payment readiness and submitted transaction infrastructure', () => {
  it('returns READY only after persisted binding, exact allowance, balance, exact-call estimates, and exact calldata simulation pass', async () => {
    const value = await setup();
    const result = await value.service.recheck(invoice, value.evidence.id, buyer, buyerSignature);
    expect(result).toMatchObject({ status: 'READY', ready: true, preparationId: value.evidence.id, preparationHash: value.evidence.preparationHash });
    expect(result.walletTransaction).toEqual({
      from: value.evidence.buyer,
      to: value.evidence.router,
      data: value.evidence.attributedSwapCalldata,
      value: '0',
      chainId: 196,
    });
    expect(value.api.swapCalls).toBe(1);
    expect(value.observations.estimates).toEqual([value.evidence.attributedApprovalCalldata, value.evidence.attributedSwapCalldata]);
    expect(value.observations.calls).toEqual([value.evidence.attributedSwapCalldata]);
    expect(value.adapter).toBeDefined();
  });

  it('allows only one concurrent handoff and blocks every later wallet prompt for the invoice', async () => {
    const value = await setup();
    const secondPreparation = { ...value.evidence, id: '00000000-0000-4000-8000-000000000099' };
    await value.repository.savePreparation(secondPreparation);
    const [first, concurrent] = await Promise.all([
      value.service.recheck(invoice, value.evidence.id, buyer, buyerSignature),
      value.service.recheck(invoice, secondPreparation.id, buyer, buyerSignature),
    ]);
    expect([first.status, concurrent.status].filter((status) => status === 'READY')).toHaveLength(1);
    expect([first.status, concurrent.status].filter((status) => status !== 'READY')).toHaveLength(1);
    expect(await value.repository.getHandoffForInvoice(invoice.id)).toMatchObject({ id: invoice.id });
    const originalPreparation = first.status === 'READY' ? value.evidence.id : secondPreparation.id;
    const otherPreparation = first.status === 'READY' ? secondPreparation.id : value.evidence.id;
    await expect(value.service.recheck(invoice, otherPreparation, buyer, buyerSignature)).resolves.toMatchObject({ status: 'BLOCKED', ready: false });
    const retry = await value.service.recheck(invoice, originalPreparation, buyer, buyerSignature);
    expect(retry).toMatchObject({ status: 'HANDOFF_UNRESOLVED', ready: false, preparationId: originalPreparation, handoffId: invoice.id });
    expect(retry).not.toHaveProperty('walletTransaction');
    expect(value.api.swapCalls).toBe(1);
  });

  it('fails closed after a cancelled or lost wallet result, then recovers only the original recorded hash', async () => {
    const value = await setup();
    const approvalCallsBeforeRetry = value.api.approvalCalls;
    let handoffWrites = 0;
    const createHandoff = value.repository.createHandoff.bind(value.repository);
    value.repository.createHandoff = async (args) => { handoffWrites += 1; return createHandoff(args); };

    const initial = await value.service.recheck(invoice, value.evidence.id, buyer, buyerSignature);
    expect(initial.status).toBe('READY');
    // Rejection, browser loss, and an unknown broadcast all look identical without a recorded hash.
    await expect(value.repository.getSubmissionForPreparation(value.evidence.id)).resolves.toBeNull();

    const retry = await value.service.recheck(invoice, value.evidence.id, buyer, buyerSignature);
    expect(retry).toMatchObject({ status: 'HANDOFF_UNRESOLVED', ready: false, handoffId: initial.handoffId });
    expect(retry).not.toHaveProperty('walletTransaction');
    expect(await value.service.getAttemptStatus(invoice)).toBe('unresolved');
    expect(handoffWrites).toBe(1);
    expect(value.api.swapCalls).toBe(1);
    expect(value.api.approvalCalls).toBe(approvalCallsBeforeRetry);

    const hash = `0x${'a'.repeat(64)}` as Hex;
    await value.service.recordSubmission(invoice, value.evidence.id, initial.handoffId!, hash);
    const afterSubmission = await value.service.recheck(invoice, value.evidence.id, buyer, buyerSignature);
    expect(afterSubmission).toMatchObject({ status: 'SUBMITTED', ready: false, transactionHash: hash, handoffId: initial.handoffId });
    expect(afterSubmission).not.toHaveProperty('walletTransaction');
    expect(await value.service.getAttemptStatus(invoice)).toBe('submitted');
    expect(handoffWrites).toBe(1);
    expect(value.api.swapCalls).toBe(1);
    expect(value.api.approvalCalls).toBe(approvalCallsBeforeRetry);
  });

  it('does not reserve an invoice without a buyer signature for the exact persisted preparation', async () => {
    const value = await setup();
    const service = createMainnetPaymentService({
      createRepository: () => value.repository, publicClient: value.publicClient,
      now: () => new Date(nowIso), verifyBuilderCode: verifiedBuilder,
      mainnetBuilderCode: builderCode, mainnetBuilderPayoutAddress: buyer,
      verifyBuyerHandoffSignature: async ({ buyer: signedBuyer, message }) => {
        expect(signedBuyer).toBe(buyer);
        expect(message).toContain(`Invoice ID: ${invoice.id}`);
        expect(message).toContain(`Preparation hash: ${value.evidence.preparationHash}`);
        expect(message).toContain(`Calldata hash: ${value.evidence.attributedSwapCalldataHash}`);
        return false;
      },
    });
    await expect(service.recheck(invoice, value.evidence.id, buyer, buyerSignature)).resolves.toMatchObject({ status: 'BLOCKED', ready: false });
    await expect(value.repository.getHandoffForInvoice(invoice.id)).resolves.toBeNull();
  });

  it('rejects stale, wrong-buyer, and preparation-hash-mismatched rechecks', async () => {
    const stale = await setup();
    const staleService = createMainnetPaymentService({
      createRepository: () => stale.repository, publicClient: stale.publicClient,
      now: () => new Date(stale.evidence.expiresAt),
      verifyBuilderCode: verifiedBuilder, mainnetBuilderCode: builderCode, mainnetBuilderPayoutAddress: buyer,
      verifyBuyerHandoffSignature: async () => true,
    });
    await expect(staleService.recheck(invoice, stale.evidence.id, buyer, buyerSignature)).resolves.toMatchObject({ status: 'EXPIRED', ready: false });
    const valid = await setup();
    const wrongChain = await setup({ chainId: 1952 });
    await expect(wrongChain.service.recheck(invoice, wrongChain.evidence.id, buyer, buyerSignature)).resolves.toMatchObject({ status: 'WRONG_CHAIN', ready: false });
    await expect(valid.service.recheck(invoice, valid.evidence.id, merchant, buyerSignature)).resolves.toMatchObject({ status: 'BLOCKED', ready: false, reason: expect.stringContaining('buyer') });
    const changed = { ...valid.evidence, preparationHash: `0x${'9'.repeat(64)}` as Hex };
    const tampered: MainnetReconciliationRepository = {
      savePreparation: valid.repository.savePreparation.bind(valid.repository),
      getPreparation: async () => changed,
      createHandoff: valid.repository.createHandoff.bind(valid.repository), getHandoff: valid.repository.getHandoff.bind(valid.repository),
      getHandoffForInvoice: valid.repository.getHandoffForInvoice.bind(valid.repository),
      recordSubmission: valid.repository.recordSubmission.bind(valid.repository),
      getSubmission: valid.repository.getSubmission.bind(valid.repository),
      getSubmissionForPreparation: valid.repository.getSubmissionForPreparation.bind(valid.repository),
      claimSettlement: valid.repository.claimSettlement.bind(valid.repository),
    };
    const tamperedService = createMainnetPaymentService({ createRepository: () => tampered, publicClient: valid.publicClient, now: () => new Date(nowIso), verifyBuilderCode: verifiedBuilder, mainnetBuilderCode: builderCode, mainnetBuilderPayoutAddress: buyer, verifyBuyerHandoffSignature: async () => true });
    await expect(tamperedService.recheck(invoice, valid.evidence.id, buyer, buyerSignature)).resolves.toMatchObject({ status: 'BLOCKED', ready: false });
  });

  it('blocks allowance mismatch and reports a same-calldata estimateGas failure without calling another preparation', async () => {
    const allowance = await setup({ allowance: BigInt(inputAmount) - 1n });
    await expect(allowance.service.recheck(invoice, allowance.evidence.id, buyer, buyerSignature)).resolves.toMatchObject({ status: 'INSUFFICIENT_ALLOWANCE', ready: false });
    expect(allowance.observations.estimates).toHaveLength(0);
    const estimate = await setup({ estimateError: true });
    await expect(estimate.service.recheck(invoice, estimate.evidence.id, buyer, buyerSignature)).resolves.toMatchObject({ status: 'BLOCKED', ready: false, reason: expect.stringContaining('exact swap estimate failed') });
    expect(estimate.observations.estimates).toEqual([estimate.evidence.attributedApprovalCalldata, estimate.evidence.attributedSwapCalldata]);
    expect(estimate.observations.calls).toEqual([]);
  });

  it('blocks same-calldata eth_call failure and stale preparations from new submission', async () => {
    const value = await setup({ callError: true });
    await expect(value.service.recheck(invoice, value.evidence.id, buyer, buyerSignature)).resolves.toMatchObject({ status: 'BLOCKED', ready: false, reason: expect.stringContaining('exact swap call failed') });
    expect(value.observations.calls).toEqual([value.evidence.attributedSwapCalldata]);
    const expiredService = createMainnetPaymentService({
      createRepository: () => value.repository, publicClient: value.publicClient,
      now: () => new Date(value.evidence.expiresAt), verifyBuilderCode: verifiedBuilder,
      mainnetBuilderCode: builderCode, mainnetBuilderPayoutAddress: buyer,
      verifyBuyerHandoffSignature: async () => true,
    });
    await expect(expiredService.recordSubmission(invoice, value.evidence.id, '00000000-0000-4000-8000-000000000099', `0x${'a'.repeat(64)}` as Hex)).rejects.toThrow(/pre-expiry wallet handoff/);
  });

  it('does not return READY when the buyer balance or buffered OKB requirement fails', async () => {
    const lowAsset = await setup({ buyerBalance: BigInt(inputAmount) - 1n });
    await expect(lowAsset.service.recheck(invoice, lowAsset.evidence.id, buyer, buyerSignature)).resolves.toMatchObject({ status: 'INSUFFICIENT_BALANCE', ready: false });
    expect(lowAsset.observations.estimates).toHaveLength(0);
    const lowGas = await setup({ okbBalance: 1n });
    await expect(lowGas.service.recheck(invoice, lowGas.evidence.id, buyer, buyerSignature)).resolves.toMatchObject({ status: 'INSUFFICIENT_GAS', ready: false });
  });

  it('authorizes wallet handoff while fresh and records exact transaction observation even after expiry', async () => {
    const value = await setup();
    const observedClient = value.publicClient as MainnetReadOnlyClient & MainnetReceiptClient & { swapCalldata?: Hex };
    observedClient.swapCalldata = value.evidence.attributedSwapCalldata;
    const handoffStart = new Date(Date.parse(value.evidence.expiresAt) - 5_000);
    value.setClock(handoffStart);
    const ready = await value.service.recheck(invoice, value.evidence.id, buyer, buyerSignature);
    expect(ready).toMatchObject({ status: 'READY', ready: true });
    expect(Date.parse(value.evidence.expiresAt) - Date.parse(ready.handoffStartedAt!)).toBeLessThan(15_000);
    expect(ready.handoffId).toBeTruthy();
    value.setClock(new Date(value.evidence.expiresAt));
    const result = await value.service.recordSubmission(invoice, value.evidence.id, ready.handoffId!, `0x${'a'.repeat(64)}` as Hex);
    expect(result.status).toBe('submitted');
    await expect(value.repository.getSubmission(value.evidence.id, result.transactionHash)).resolves.toMatchObject({ submittedAt: value.evidence.expiresAt, handoffId: ready.handoffId });
  });

  it('recovers the same submitted transaction after a missed first observation without another handoff or payment path', async () => {
    const value = await setup();
    let handoffWrites = 0;
    const createHandoff = value.repository.createHandoff.bind(value.repository);
    value.repository.createHandoff = async (args) => { handoffWrites += 1; return createHandoff(args); };
    const ready = await value.service.recheck(invoice, value.evidence.id, buyer, buyerSignature);
    expect(ready.status).toBe('READY');
    const txHash = `0x${'a'.repeat(64)}` as Hex;
    const client = value.publicClient as MainnetReadOnlyClient & MainnetReceiptClient;
    let observationAttempts = 0;
    client.getTransaction = async () => {
      observationAttempts += 1;
      if (observationAttempts === 1) throw new Error('transaction not indexed yet');
      return { from: buyer, to: router, input: value.evidence.attributedSwapCalldata, value: 0n };
    };

    await expect(value.service.recordSubmission(invoice, value.evidence.id, ready.handoffId!, txHash)).rejects.toThrow(/not indexed yet/);
    await expect(value.repository.getSubmissionForPreparation(value.evidence.id)).resolves.toBeNull();

    const recovered = await value.service.recordSubmission(invoice, value.evidence.id, ready.handoffId!, txHash);
    expect(recovered).toMatchObject({ status: 'submitted', preparationId: value.evidence.id, handoffId: ready.handoffId, transactionHash: txHash });
    await expect(value.service.recoverSubmission(invoice, value.evidence.id, buyer)).resolves.toEqual(recovered);
    await expect(value.repository.getSubmission(value.evidence.id, txHash)).resolves.toMatchObject({ handoffId: ready.handoffId, transactionHash: txHash });
    await expect(value.service.recordSubmission(invoice, value.evidence.id, ready.handoffId!, `0x${'b'.repeat(64)}` as Hex)).rejects.toThrow(/different transaction/);
    await expect(value.service.reconcile(invoice, value.evidence.id, `0x${'b'.repeat(64)}` as Hex)).rejects.toMatchObject({ code: 'INVALID_SUBMISSION' });
    expect(await value.repository.getSubmissionForPreparation(value.evidence.id)).toMatchObject({ transactionHash: txHash, handoffId: ready.handoffId });
    expect(handoffWrites).toBe(1);
    expect(value.api.swapCalls).toBe(1);
    expect(observationAttempts).toBe(3);
  });
});
