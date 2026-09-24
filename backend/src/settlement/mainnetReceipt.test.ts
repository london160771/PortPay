import { Attribution } from 'ox/erc8021';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { mainnetAddressConfig } from '../config/xlayerMainnet.js';
import type { Invoice } from '../invoices/types.js';
import type { OkxDexApiClient, OkxQuoteData, OkxApprovalData, OkxSwapData } from './okxDexApi.js';
import { OKXDEXMainnetAdapter } from './mainnet.js';
import { InMemoryMainnetReconciliationRepository, persistMainnetPreparation } from './mainnetReconciliationRepository.js';
import { verifyMainnetReceipt, type MainnetReceiptClient, type MainnetReceiptLog } from './mainnetReceipt.js';

const buyer = '0xbabdfef588cf57efcc7c8857960e3ccdd9167589' as Address;
const merchant = '0x815c2fb8178f0bf80ada8c5b97ff44ece90e6e25' as Address;
const router = '0x7c5bee2a8091c3ef39072f64f18fac913060aeaf' as Address;
const spender = '0x8b773d83bc66be128c60e07e17c8901f7a64f000' as Address;
const txHash = `0x${'a'.repeat(64)}` as Hex;
const blockHash = `0x${'b'.repeat(64)}` as Hex;
const previousBlockHash = `0x${'c'.repeat(64)}` as Hex;
const preparationBlockHash = `0x${'d'.repeat(64)}` as Hex;
const inputAmount = '2965213342702937';
const builderCode = 'mainnetcode12345';
const stablecoin = mainnetAddressConfig.usdt0 as Address;
const asset = mainnetAddressConfig.wAapl as Address;
const swapAbi = parseAbi(['function dagSwapTo(uint256 orderId, address receiver, (uint256 fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, uint256 deadLine) baseRequest, (address[] mixAdapters, address[] assetTo, uint256[] rawData, bytes[] extraData, uint256 fromToken)[] paths) payable returns (uint256)']);
const approveAbi = [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }] as const;
const transferAbi = [{ type: 'event', name: 'Transfer', anonymous: false, inputs: [{ indexed: true, name: 'from', type: 'address' }, { indexed: true, name: 'to', type: 'address' }, { indexed: false, name: 'value', type: 'uint256' }] }] as const;
const invoice: Invoice = {
  id: '00000000-0000-4000-8000-000000000001', title: 'Receipt invoice', amountUsdt0: '1', merchantAddress: merchant,
  paymentUrl: 'https://pay.example.test/pay/00000000-0000-4000-8000-000000000001', status: 'pending', paymentNetwork: 'x-layer-mainnet',
  createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
};
function token(address: string, symbol: string): OkxQuoteData['fromToken'] {
  return { decimal: address.toLowerCase() === stablecoin.toLowerCase() ? '6' : '18', isHoneyPot: false, taxRate: '0', tokenContractAddress: address, tokenSymbol: symbol, tokenUnitPrice: '1' };
}
function quoteData(): OkxQuoteData {
  const fromToken = token(asset, 'wAAPLx'); const toToken = token(stablecoin, 'USD₮0');
  return { chainIndex: '196', dexRouterList: [{ fromToken, toToken, dexProtocol: { dexName: 'Uniswap V3', percent: '100' } }], estimateGasFee: '338400', fromToken, fromTokenAmount: inputAmount, priceImpactPercent: '-0.12', quoteId: 'quote-1', router: `${asset}--${stablecoin}`, swapMode: 'exactIn', toToken, toTokenAmount: '1001000', tradeFee: '0.0006' };
}
function approval(): OkxApprovalData {
  return { data: encodeFunctionData({ abi: approveAbi, functionName: 'approve', args: [spender, BigInt(inputAmount)] }), dexContractAddress: spender, gasLimit: '70000', gasPrice: '27000001' };
}
function swap(): OkxSwapData {
  const data = encodeFunctionData({ abi: swapAbi, functionName: 'dagSwapTo', args: [1n, merchant, { fromToken: BigInt(asset), toToken: stablecoin, fromTokenAmount: BigInt(inputAmount), minReturnAmount: 1_000_000n, deadLine: 1_790_000_000n }, [{ mixAdapters: [merchant], assetTo: [stablecoin], rawData: [1n], extraData: ['0x'], fromToken: BigInt(asset) }]] });
  return { routerResult: quoteData(), tx: { data, from: buyer, gas: '338400', gasPrice: '27000001', minReceiveAmount: '1000000', slippagePercent: '0.5', to: router, value: '0' } };
}
class FakeApi { async getQuote() { return quoteData(); } async getApprovalTransaction() { return approval(); } async getSwapTransaction() { return swap(); } }
async function prepared() {
  const adapter = new OKXDEXMainnetAdapter({ apiClient: new FakeApi() as unknown as OkxDexApiClient, builderCode, now: () => new Date('2026-09-21T00:00:00.000Z') });
  const quote = await adapter.getQuote({ assetAmount: inputAmount, assetKey: 'wAapl', buyerAddress: buyer, invoice });
  return { quote, approval: await adapter.prepareApprovalTransaction(quote), swap: await adapter.prepareSwapTransaction(quote) };
}
function transferLog(tokenAddress: Address, from: Address, to: Address, value: bigint): MainnetReceiptLog {
  const topics = encodeEventTopics({ abi: transferAbi, eventName: 'Transfer', args: { from, to } }) as readonly Hex[];
  return { address: tokenAddress, data: encodeAbiParameters([{ type: 'uint256' }], [value]), topics };
}
type ClientOptions = {
  transactionInput?: Hex; transactionTo?: Address | null; receiptTo?: Address | null; canonicalHash?: Hex;
  buyerBefore?: unknown; buyerAfter?: unknown; merchantBefore?: unknown; merchantAfter?: unknown;
  wrongParent?: boolean; wrongBlockNumber?: boolean; receiptTimestamp?: bigint; reverted?: boolean;
};
function receiptClient(logs: readonly MainnetReceiptLog[], options: ClientOptions = {}): MainnetReceiptClient {
  const exactInput = options.transactionInput ?? expectedSwapInput;
  return {
    async getChainId() { return 196; },
    async readContract(args) {
      if (args.functionName !== 'balanceOf') throw new Error('unexpected read');
      const isBuyer = args.args?.[0]?.toString().toLowerCase() === buyer.toLowerCase();
      const before = args.blockNumber === 99n;
      if (isBuyer) return before ? options.buyerBefore ?? BigInt(inputAmount) + 1n : options.buyerAfter ?? 1n;
      return before ? options.merchantBefore ?? 0n : options.merchantAfter ?? 1_000_000n;
    },
    async getTransactionReceipt() { return { status: options.reverted ? 'reverted' : 'success', to: options.receiptTo === undefined ? router : options.receiptTo, from: buyer, blockNumber: 100n, blockHash, logs }; },
    async getTransaction() { return { from: buyer, to: options.transactionTo === undefined ? router : options.transactionTo, input: exactInput, value: 0n }; },
    async getBlockNumber() { return 105n; },
    async getBlock({ blockNumber }) {
      const number = options.wrongBlockNumber ? blockNumber + 1n : blockNumber;
      if (blockNumber === 90n) return { number, hash: preparationBlockHash, parentHash: previousBlockHash, timestamp: 1_790_000_000n };
      if (blockNumber === 99n) return { number, hash: previousBlockHash, parentHash: `0x${'e'.repeat(64)}` as Hex, timestamp: BigInt(Date.parse('2026-09-21T00:00:29Z') / 1000) };
      return { number, hash: options.canonicalHash ?? blockHash, parentHash: options.wrongParent ? `0x${'f'.repeat(64)}` as Hex : previousBlockHash, timestamp: options.receiptTimestamp ?? BigInt(Date.parse('2026-09-21T00:00:30Z') / 1000) };
    },
  };
}
let expectedSwapInput: Hex = '0x';
async function fixture(options: { recordSubmission?: boolean; submittedAt?: string } = {}) {
  const setup = await prepared();
  expectedSwapInput = setup.swap.attributedData!;
  let repositoryTime = new Date('2026-09-21T00:00:10.000Z');
  const repository = new InMemoryMainnetReconciliationRepository(() => repositoryTime);
  const evidence = await persistMainnetPreparation({ repository, quote: setup.quote, approval: setup.approval, swap: setup.swap, builderPayout: buyer, snapshotBlockNumber: 90n, snapshotBlockHash: preparationBlockHash });
  if (options.recordSubmission !== false) {
    const handoff = await repository.createHandoff({ preparationId: evidence.id, invoiceId: invoice.id, buyer, chainId: 196, preparationHash: evidence.preparationHash, calldataHash: evidence.attributedSwapCalldataHash });
    if (!handoff) throw new Error('test fixture handoff failed');
    if (options.submittedAt) repositoryTime = new Date(options.submittedAt);
    await repository.recordSubmission({ preparationId: evidence.id, handoffId: handoff.id, invoiceId: invoice.id, chainId: 196, transactionHash: txHash });
  }
  const logs = [transferLog(asset, buyer, router, BigInt(inputAmount)), transferLog(stablecoin, router, merchant, 1_000_000n)];
  const common = {
    repository, preparationId: evidence.id, invoice, txHash, configuredMainnetBuilderCode: builderCode,
    expectedBuilderPayoutAddress: buyer,
    verifyBuilderCode: async ({ code, expectedPayoutAddress }: { code: string; expectedPayoutAddress?: string }) => ({ status: 'VERIFIED' as const, code, payoutAddress: expectedPayoutAddress as Address, expectedPayoutAddress: expectedPayoutAddress as Address, registryAddress: '0xd6c426f9c077358735622ae5a83468dc0510823b' as Address, chainId: 196 }),
  };
  return { setup, repository, evidence, logs, common };
}

describe('mainnet receipt/reconciliation verification', () => {
  it('requires persisted exact calldata, deterministic balances, canonical blocks, and one atomic claim', async () => {
    const value = await fixture();
    const requestedBlocks: bigint[] = [];
    const client = receiptClient(value.logs);
    const originalRead = client.readContract;
    client.readContract = async (args) => { requestedBlocks.push(args.blockNumber!); return originalRead(args); };
    const result = await verifyMainnetReceipt({ ...value.common, publicClient: client });
    expect(result.status).toBe('paid');
    expect(result.confirmationDepth).toBe(6);
    expect(result.canonical).toBe(true);
    expect(result.stablecoinReceived).toBe('1000000');
    expect(result.builderCode).toBe(builderCode);
    expect(result.builderCodeCheck.code).toBe(builderCode);
    expect(Attribution.fromData(value.evidence.attributedApprovalCalldata)?.codes).toEqual([builderCode]);
    expect(Attribution.fromData(value.evidence.attributedSwapCalldata)?.codes).toEqual([builderCode]);
    expect(value.evidence.minimumReceive).toBe(value.setup.swap.execution?.minimumReceiveAmount);
    expect(value.evidence.expectedOutput).toBe(value.setup.swap.execution?.expectedOutputAmount);
    expect(value.evidence.routeFingerprint).toBe(value.setup.swap.execution?.routeFingerprint);
    expect(value.evidence.preparationHash).toBe(value.setup.swap.execution?.preparationHash);
    expect(result.balanceEvidence).toMatchObject({ beforeBlockNumber: '99', receiptBlockNumber: '100', buyerInputDelta: inputAmount, merchantOutputDelta: '1000000' });
    expect(requestedBlocks).toEqual([99n, 100n, 99n, 100n]);
    await expect(verifyMainnetReceipt({
      ...value.common,
      invoice: { ...invoice, status: 'paid', paymentNetwork: 'x-layer-mainnet', paymentTxHash: txHash },
      publicClient: receiptClient(value.logs),
    })).resolves.toMatchObject({ status: 'paid', claimDisposition: 'already_paid' });
  });

  it('rejects paid retries unless network, transaction, preparation, and verified evidence all match', async () => {
    const value = await fixture();
    const paidInvoice = { ...invoice, status: 'paid' as const, paymentNetwork: 'x-layer-mainnet' as const, paymentTxHash: txHash };
    await expect(verifyMainnetReceipt({ ...value.common, invoice: paidInvoice, preparationId: '00000000-0000-4000-8000-000000000099', publicClient: receiptClient(value.logs) }))
      .rejects.toMatchObject({ code: 'INVALID_PREPARATION' });
    await expect(verifyMainnetReceipt({ ...value.common, invoice: { ...paidInvoice, paymentTxHash: `0x${'9'.repeat(64)}` }, publicClient: receiptClient(value.logs) }))
      .rejects.toMatchObject({ code: 'DUPLICATE_SETTLEMENT' });
    await expect(verifyMainnetReceipt({ ...value.common, invoice: { ...paidInvoice, paymentNetwork: 'x-layer-testnet' }, publicClient: receiptClient(value.logs) }))
      .rejects.toMatchObject({ code: 'DUPLICATE_SETTLEMENT' });
  });

  it('accepts an exact transaction submitted before expiry and canonically included after expiry', async () => {
    const value = await fixture({ submittedAt: '2026-09-21T00:01:01.000Z' });
    const afterExpiry = BigInt(Date.parse(value.evidence.expiresAt) / 1000 + 1);
    const result = await verifyMainnetReceipt({ ...value.common, publicClient: receiptClient(value.logs, { receiptTimestamp: afterExpiry }) });
    expect(result.status).toBe('paid');
    expect(value.repository.settlementCount()).toBe(1);
  });

  it('accepts partial input consumption/refund when net debit is proven and merchant floor is met', async () => {
    const value = await fixture();
    const outflow = 2_000_000_000_000_000n;
    const refund = 500_000_000_000_000n;
    const netDebit = outflow - refund;
    const logs = [transferLog(asset, buyer, router, outflow), transferLog(asset, router, buyer, refund), transferLog(stablecoin, router, merchant, 1_000_000n)];
    const client = receiptClient(logs, { buyerBefore: BigInt(inputAmount) + 10n, buyerAfter: BigInt(inputAmount) + 10n - netDebit });
    const result = await verifyMainnetReceipt({ ...value.common, publicClient: client });
    expect(result.spentAmount).toBe(netDebit.toString());
    expect(result.balanceEvidence.buyerInputDelta).toBe(netDebit.toString());
    expect(result.stablecoinReceived).toBe('1000000');
  });

  it('rejects unexplained refunds and still enforces the merchant invoice floor', async () => {
    const value = await fixture();
    const outflow = 2_000_000_000_000_000n;
    const refund = 500_000_000_000_000n;
    const refundLogs = [transferLog(asset, buyer, router, outflow), transferLog(asset, router, buyer, refund), transferLog(stablecoin, router, merchant, 1_000_000n)];
    await expect(verifyMainnetReceipt({ ...value.common, publicClient: receiptClient(refundLogs) })).rejects.toMatchObject({ code: 'INVALID_INPUT_AMOUNT' });
    const unexpectedRefund = [transferLog(asset, buyer, router, outflow), transferLog(asset, merchant, buyer, refund), transferLog(stablecoin, router, merchant, 1_000_000n)];
    await expect(verifyMainnetReceipt({ ...value.common, publicClient: receiptClient(unexpectedRefund) })).rejects.toMatchObject({ code: 'INVALID_INPUT_AMOUNT' });
    const belowFloorLogs = [transferLog(asset, buyer, router, BigInt(inputAmount)), transferLog(stablecoin, router, merchant, 999_999n)];
    await expect(verifyMainnetReceipt({ ...value.common, publicClient: receiptClient(belowFloorLogs) })).rejects.toMatchObject({ code: 'INSUFFICIENT_OUTPUT' });
  });

  it('rejects an expired preparation that has no server-recorded submission', async () => {
    const value = await fixture({ recordSubmission: false });
    await expect(verifyMainnetReceipt({ ...value.common, publicClient: receiptClient(value.logs) }))
      .rejects.toMatchObject({ code: 'INVALID_SUBMISSION' });
    expect(value.repository.settlementCount()).toBe(0);
  });

  it('never claims or pays a reverted mainnet transaction', async () => {
    const value = await fixture();
    await expect(verifyMainnetReceipt({ ...value.common, publicClient: receiptClient(value.logs, { reverted: true }) }))
      .rejects.toMatchObject({ code: 'FAILED_TRANSACTION' });
    expect(value.repository.settlementCount()).toBe(0);
  });

  it('rejects byte-modified swap calldata, a different valid code, and the testnet Builder Code', async () => {
    const value = await fixture();
    const altered = `${value.evidence.attributedSwapCalldata.slice(0, -2)}00` as Hex;
    await expect(verifyMainnetReceipt({ ...value.common, publicClient: receiptClient(value.logs, { transactionInput: altered }) })).rejects.toMatchObject({ code: 'INVALID_EXECUTION' });
    await expect(verifyMainnetReceipt({ ...value.common, configuredMainnetBuilderCode: 'othercode1234567', publicClient: receiptClient(value.logs) })).rejects.toMatchObject({ code: 'INVALID_ATTRIBUTION' });
    await expect(verifyMainnetReceipt({ ...value.common, verifyBuilderCode: async () => ({ status: 'VERIFIED' as const, code: 'othercode1234567', payoutAddress: buyer, registryAddress: '0xd6c426f9c077358735622ae5a83468dc0510823b' as Address, chainId: 196 }), publicClient: receiptClient(value.logs) })).rejects.toMatchObject({ code: 'INVALID_ATTRIBUTION' });
    await expect(verifyMainnetReceipt({ ...value.common, configuredMainnetBuilderCode: 'kob1lkgsg6infkg3', publicClient: receiptClient(value.logs) })).rejects.toMatchObject({ code: 'INVALID_ATTRIBUTION' });
    const corruptedRepository = {
      getPreparation: async () => ({ ...value.evidence, swap: { ...value.evidence.swap, builderCode: 'othercode1234567' } }),
      savePreparation: value.repository.savePreparation.bind(value.repository),
      createHandoff: value.repository.createHandoff.bind(value.repository), getHandoff: value.repository.getHandoff.bind(value.repository),
      recordSubmission: value.repository.recordSubmission.bind(value.repository),
      getSubmission: value.repository.getSubmission.bind(value.repository),
      claimSettlement: value.repository.claimSettlement.bind(value.repository),
    };
    await expect(verifyMainnetReceipt({ ...value.common, repository: corruptedRepository, publicClient: receiptClient(value.logs) })).rejects.toMatchObject({ code: 'INVALID_PREPARATION' });
  });

  it('rejects persisted authenticated-response or approval-binding tampering', async () => {
    const value = await fixture();
    const execution = value.evidence.swap.execution!;
    const tamperedResponse = {
      ...value.evidence,
      swap: {
        ...value.evidence.swap,
        execution: {
          ...execution,
          authenticatedResponse: {
            ...execution.authenticatedResponse,
            tx: { ...execution.authenticatedResponse.tx, data: `${execution.authenticatedResponse.tx.data}00` as Hex },
          },
        },
      },
    };
    const tamperedRepository = {
      getPreparation: async () => tamperedResponse,
      savePreparation: value.repository.savePreparation.bind(value.repository),
      createHandoff: value.repository.createHandoff.bind(value.repository), getHandoff: value.repository.getHandoff.bind(value.repository),
      recordSubmission: value.repository.recordSubmission.bind(value.repository),
      getSubmission: value.repository.getSubmission.bind(value.repository),
      claimSettlement: value.repository.claimSettlement.bind(value.repository),
    };
    await expect(verifyMainnetReceipt({ ...value.common, repository: tamperedRepository, publicClient: receiptClient(value.logs) })).rejects.toMatchObject({ code: 'INVALID_PREPARATION' });

    const tamperedApprovalBinding = {
      ...value.evidence,
      swap: { ...value.evidence.swap, execution: { ...execution, spender: merchant } },
    };
    const approvalRepository = {
      getPreparation: async () => tamperedApprovalBinding,
      savePreparation: value.repository.savePreparation.bind(value.repository),
      createHandoff: value.repository.createHandoff.bind(value.repository), getHandoff: value.repository.getHandoff.bind(value.repository),
      recordSubmission: value.repository.recordSubmission.bind(value.repository),
      getSubmission: value.repository.getSubmission.bind(value.repository),
      claimSettlement: value.repository.claimSettlement.bind(value.repository),
    };
    await expect(verifyMainnetReceipt({ ...value.common, repository: approvalRepository, publicClient: receiptClient(value.logs) })).rejects.toMatchObject({ code: 'INVALID_PREPARATION' });
  });

  it('rejects malformed balance RPC values and mismatched before/after deltas', async () => {
    const value = await fixture();
    await expect(verifyMainnetReceipt({ ...value.common, publicClient: receiptClient(value.logs, { buyerBefore: '2965213342702938' }) })).rejects.toMatchObject({ code: 'INVALID_BALANCE_EVIDENCE' });
    await expect(verifyMainnetReceipt({ ...value.common, publicClient: receiptClient(value.logs, { merchantAfter: 2_000_000n }) })).rejects.toMatchObject({ code: 'INVALID_OUTPUT_BALANCE' });
    await expect(verifyMainnetReceipt({ ...value.common, publicClient: receiptClient(value.logs, { buyerAfter: -1n }) })).rejects.toMatchObject({ code: 'INVALID_BALANCE_EVIDENCE' });
  });

  it('rejects wrong router, insufficient output, and inconsistent canonical block ancestry', async () => {
    const value = await fixture();
    await expect(verifyMainnetReceipt({ ...value.common, publicClient: receiptClient(value.logs, { transactionTo: merchant }) })).rejects.toMatchObject({ code: 'INVALID_ROUTE' });
    await expect(verifyMainnetReceipt({ ...value.common, publicClient: receiptClient([transferLog(asset, buyer, router, BigInt(inputAmount)), transferLog(stablecoin, router, merchant, 999_999n)]) })).rejects.toMatchObject({ code: 'INSUFFICIENT_OUTPUT' });
    await expect(verifyMainnetReceipt({ ...value.common, publicClient: receiptClient(value.logs, { wrongParent: true }) })).rejects.toMatchObject({ code: 'NON_CANONICAL_BLOCK' });
    await expect(verifyMainnetReceipt({ ...value.common, publicClient: receiptClient(value.logs, { canonicalHash: `0x${'1'.repeat(64)}` as Hex }) })).rejects.toMatchObject({ code: 'NON_CANONICAL_BLOCK' });
    await expect(verifyMainnetReceipt({ ...value.common, publicClient: receiptClient(value.logs, { wrongBlockNumber: true }) })).rejects.toMatchObject({ code: 'NON_CANONICAL_BLOCK' });
  });
});
