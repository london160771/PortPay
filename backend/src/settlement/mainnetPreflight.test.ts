import { Attribution } from 'ox/erc8021';
import { encodeAbiParameters, encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { mainnetAddressConfig } from '../config/xlayerMainnet.js';
import type { Invoice } from '../invoices/types.js';
import type { OkxDexApiClient, OkxQuoteData, OkxApprovalData, OkxSwapData } from './okxDexApi.js';
import { OKXDEXMainnetAdapter } from './mainnet.js';
import { InMemoryMainnetReconciliationRepository } from './mainnetReconciliationRepository.js';
import { runMainnetPreflight, type MainnetReadOnlyClient } from './mainnetPreflight.js';

const buyer = '0xbabdfef588cf57efcc7c8857960e3ccdd9167589' as Address;
const merchant = '0x815c2fb8178f0bf80ada8c5b97ff44ece90e6e25' as Address;
const router = '0x7c5bee2a8091c3ef39072f64f18fac913060aeaf' as Address;
const spender = '0x8b773d83bc66be128c60e07e17c8901f7a64f000' as Address;
const amount = '2965213342702937';
const invoice: Invoice = {
  id: '00000000-0000-4000-8000-000000000001', title: 'Preflight invoice', amountUsdt0: '1', merchantAddress: merchant,
  paymentUrl: 'https://pay.example.test/pay/00000000-0000-4000-8000-000000000001', status: 'pending',
  createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
};
const swapAbi = parseAbi(['function dagSwapTo(uint256 orderId, address receiver, (uint256 fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, uint256 deadLine) baseRequest, (address[] mixAdapters, address[] assetTo, uint256[] rawData, bytes[] extraData, uint256 fromToken)[] paths) payable returns (uint256)']);
const approveAbi = [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }] as const;

function token(address: string, symbol: string, decimal: string): OkxQuoteData['fromToken'] {
  return { decimal, isHoneyPot: false, taxRate: '0', tokenContractAddress: address, tokenSymbol: symbol, tokenUnitPrice: '1' };
}
function quoteData(): OkxQuoteData {
  const fromToken = token(mainnetAddressConfig.wAapl, 'wAAPLx', '18');
  const toToken = token(mainnetAddressConfig.usdt0, 'USD₮0', '6');
  return { chainIndex: '196', dexRouterList: [{ fromToken, toToken, dexProtocol: { dexName: 'Uniswap V3', percent: '100' } }], estimateGasFee: '338400', fromToken, fromTokenAmount: amount, priceImpactPercent: '-0.12', quoteId: 'quote-1', router: `${mainnetAddressConfig.wAapl}--0x4ae46a509f6b1d9056937ba4500cb143933d2dc8--${mainnetAddressConfig.usdt0}`, swapMode: 'exactIn', toToken, toTokenAmount: '1001000', tradeFee: '0.0006' };
}
function approval(): OkxApprovalData {
  return { data: encodeFunctionData({ abi: approveAbi, functionName: 'approve', args: [spender, BigInt(amount)] }), dexContractAddress: spender, gasLimit: '70000', gasPrice: '27000001' };
}
function swap(): OkxSwapData {
  const quote = quoteData();
  const data = encodeFunctionData({ abi: swapAbi, functionName: 'dagSwapTo', args: [1n, merchant, { fromToken: BigInt(mainnetAddressConfig.wAapl), toToken: mainnetAddressConfig.usdt0 as Address, fromTokenAmount: BigInt(amount), minReturnAmount: 1_000_000n, deadLine: 1_790_000_000n }, [{ mixAdapters: [merchant], assetTo: [mainnetAddressConfig.usdt0 as Address], rawData: [1n], extraData: ['0x'], fromToken: BigInt(mainnetAddressConfig.wAapl) }]] });
  return { routerResult: quote, tx: { data, from: buyer, gas: '338400', gasPrice: '27000001', minReceiveAmount: '1000000', slippagePercent: '0.5', to: router, value: '0' } };
}
class FakeApi { async getQuote() { return quoteData(); } async getApprovalTransaction() { return approval(); } async getSwapTransaction() { return swap(); } }
function adapter() { return new OKXDEXMainnetAdapter({ apiClient: new FakeApi() as unknown as OkxDexApiClient, builderCode: 'mainnetcode12345', now: () => new Date('2026-09-21T00:00:00.000Z') }); }
type ClientOptions = { chainId?: number; assetBalance?: bigint; allowance?: bigint; okbBalance?: bigint; assetDecimals?: unknown; stableDecimals?: unknown; approvalResult?: Hex; approvalNoReturn?: boolean; approvalError?: boolean; swapError?: boolean; swapEstimateError?: boolean };
function readClient(options: ClientOptions = {}, estimates: Array<{ to: Address; data: Hex }> = []): MainnetReadOnlyClient {
  return {
    async getChainId() { return options.chainId ?? 196; },
    async getBlockNumber() { return 50n; },
    async getBlock({ blockNumber }) { return { number: blockNumber, hash: `0x${blockNumber.toString(16).padStart(64, '0')}` as Hex }; },
    async readContract(args) {
      if (args.functionName === 'balanceOf' && args.args?.[0]?.toString().toLowerCase() === buyer.toLowerCase()) return options.assetBalance ?? 10n ** 18n;
      if (args.functionName === 'balanceOf') return 0n;
      if (args.functionName === 'allowance') return options.allowance ?? BigInt(amount);
      if (args.functionName === 'decimals') return args.address.toLowerCase() === mainnetAddressConfig.usdt0.toLowerCase() ? options.stableDecimals ?? 6 : options.assetDecimals ?? 18;
      throw new Error(`unexpected read ${args.functionName}`);
    },
    async getBalance() { return options.okbBalance ?? 10n ** 18n; },
    async estimateGas(args) {
      estimates.push({ to: args.to, data: args.data });
      if (options.swapEstimateError && args.to.toLowerCase() !== mainnetAddressConfig.wAapl.toLowerCase()) throw new Error('swap gas estimate reverted: allowance too low');
      return args.to.toLowerCase() === mainnetAddressConfig.wAapl.toLowerCase() ? 100_000n : 300_000n;
    },
    async getGasPrice() { return 2n; },
    async call(args) {
      if (args.to.toLowerCase() === mainnetAddressConfig.wAapl.toLowerCase()) {
        if (options.approvalError) throw new Error('approval reverted');
        if (options.approvalNoReturn) return { data: undefined };
        return options.approvalResult ?? encodeAbiParameters([{ type: 'bool' }], [true]);
      }
      if (options.swapError) throw new Error('swap reverted');
      return '0x';
    },
  };
}
async function prepared() {
  const current = adapter();
  const quote = await current.getQuote({ assetAmount: amount, assetKey: 'wAapl', buyerAddress: buyer, invoice });
  return { current, quote, approval: await current.prepareApprovalTransaction(quote), swap: await current.prepareSwapTransaction(quote) };
}
function builderCodeClient() { return { async getChainId() { return 196; }, async readContract() { return buyer; } }; }

describe('mainnet preflight', () => {
  it('continues only with exact allowance, then estimates exact attributed calls and applies a 20% gas margin', async () => {
    const setup = await prepared();
    const estimated: Array<{ to: Address; data: Hex }> = [];
    const simulated: Array<{ to: Address; data: Hex }> = [];
    const client = readClient({}, estimated);
    const originalCall = client.call;
    client.call = async (args) => { simulated.push({ to: args.to, data: args.data }); return originalCall(args); };
    const result = await runMainnetPreflight({ adapter: setup.current, invoice, quote: setup.quote, approval: setup.approval, swap: setup.swap, publicClient: client, builderCodeClient: builderCodeClient(), expectedBuilderPayoutAddress: buyer, repository: new InMemoryMainnetReconciliationRepository() });
    expect(result.status).toBe('READY');
    expect(result.simulations).toEqual({ stage: 'swap', approval: 'not-run', swap: 'passed' });
    expect(estimated.map((entry) => entry.data)).toEqual([setup.approval.attributedData, setup.swap.attributedData]);
    expect(simulated.map((entry) => entry.data)).toEqual([setup.swap.attributedData]);
    expect(result.balances?.approvalGasEstimate).toBe('120000');
    expect(result.balances?.swapGasEstimate).toBe('360000');
    expect(result.balances?.requiredGasWei).toBe('960000');
    expect(result.balances?.snapshotBlockNumber).toBe('50');
    expect(Attribution.fromData(setup.swap.attributedData as Hex)?.codes).toEqual(['mainnetcode12345']);
  });

  it('simulates exact approval and returns approval-required without attempting a reverting swap gas estimate', async () => {
    const setup = await prepared();
    const callTargets: Address[] = [];
    const estimated: Array<{ to: Address; data: Hex }> = [];
    const client = readClient({ allowance: 1n, swapEstimateError: true }, estimated);
    const repository = new InMemoryMainnetReconciliationRepository();
    const originalCall = client.call;
    client.call = async (args) => { callTargets.push(args.to); return originalCall(args); };
    const result = await runMainnetPreflight({ adapter: setup.current, invoice, quote: setup.quote, approval: setup.approval, swap: setup.swap, publicClient: client, builderCodeClient: builderCodeClient(), expectedBuilderPayoutAddress: buyer, repository });
    expect(result.status).toBe('APPROVAL_REQUIRED');
    expect(result.simulations).toEqual({ stage: 'approval', approval: 'passed', swap: 'not-run' });
    expect(estimated).toEqual([]);
    expect(result.preparationId).toBeTruthy();
    expect(await repository.getPreparation(result.preparationId!)).toMatchObject({ invoiceId: invoice.id, chainId: 196, exactInputAmount: amount, builderCode: 'mainnetcode12345' });
    expect(callTargets).toEqual([setup.approval.to]);
  });

  it.each([
    ['below', 1n],
    ['above', BigInt(amount) + 1n],
    ['unlimited', (1n << 256n) - 1n],
  ])('blocks %s allowance and never estimates or simulates the swap', async (_label, allowance) => {
    const setup = await prepared();
    const estimates: Array<{ to: Address; data: Hex }> = [];
    const calls: Array<{ to: Address; data: Hex }> = [];
    const client = readClient({ allowance, swapEstimateError: true }, estimates);
    const originalCall = client.call;
    client.call = async (args) => { calls.push({ to: args.to, data: args.data }); return originalCall(args); };
    const result = await runMainnetPreflight({ adapter: setup.current, invoice, quote: setup.quote, approval: setup.approval, swap: setup.swap, publicClient: client, builderCodeClient: builderCodeClient(), expectedBuilderPayoutAddress: buyer, repository: new InMemoryMainnetReconciliationRepository() });
    expect(result.status).toBe('APPROVAL_REQUIRED');
    expect(result.simulations).toEqual({ stage: 'approval', approval: 'passed', swap: 'not-run' });
    expect(estimates).toEqual([]);
    expect(calls.map(({ to, data }) => [to.toLowerCase(), data])).toEqual([[setup.approval.to.toLowerCase(), setup.approval.attributedData]]);
  });

  it('rejects false approval returns and approval/swap simulation reverts', async () => {
    const setup = await prepared();
    const base = { adapter: setup.current, invoice, quote: setup.quote, approval: setup.approval, swap: setup.swap, builderCodeClient: builderCodeClient(), expectedBuilderPayoutAddress: buyer, repository: new InMemoryMainnetReconciliationRepository() };
    await expect(runMainnetPreflight({ ...base, publicClient: readClient({ allowance: 0n, approvalResult: `0x${'00'.repeat(32)}` as Hex }) })).resolves.toMatchObject({ status: 'INVALID_APPROVAL' });
    await expect(runMainnetPreflight({ ...base, publicClient: readClient({ allowance: 0n, approvalError: true }) })).resolves.toMatchObject({ status: 'SIMULATION_FAILED' });
    await expect(runMainnetPreflight({ ...base, publicClient: readClient({ swapError: true }) })).resolves.toMatchObject({ status: 'SIMULATION_FAILED' });
    await expect(runMainnetPreflight({ ...base, publicClient: readClient({ allowance: 0n, approvalResult: '0x' }) })).resolves.toMatchObject({ status: 'APPROVAL_REQUIRED' });
    await expect(runMainnetPreflight({ ...base, publicClient: readClient({ allowance: 0n, approvalNoReturn: true }) })).resolves.toMatchObject({ status: 'APPROVAL_REQUIRED' });
  });

  it('blocks READY until a separate mainnet Builder Code is registered', async () => {
    const setup = await prepared();
    const missing = await runMainnetPreflight({ invoice, quote: setup.quote, approval: setup.approval, swap: setup.swap, adapter: new OKXDEXMainnetAdapter({ apiClient: new FakeApi() as unknown as OkxDexApiClient, now: () => new Date('2026-09-21T00:00:00.000Z') }), publicClient: readClient(), builderCodeClient: builderCodeClient(), expectedBuilderPayoutAddress: buyer });
    expect(missing.status).toBe('BLOCKED');
    expect(missing.builderCode.status).toBe('MISSING');
  });

  it('fails closed for wrong chain, low asset/gas, insufficient allowance, and decimal mismatches', async () => {
    const setup = await prepared();
    const base = { adapter: setup.current, invoice, quote: setup.quote, approval: setup.approval, swap: setup.swap, builderCodeClient: builderCodeClient(), expectedBuilderPayoutAddress: buyer, repository: new InMemoryMainnetReconciliationRepository() };
    await expect(runMainnetPreflight({ ...base, publicClient: readClient({ chainId: 1952 }) })).resolves.toMatchObject({ status: 'WRONG_CHAIN' });
    await expect(runMainnetPreflight({ ...base, publicClient: readClient({ assetBalance: 1n }) })).resolves.toMatchObject({ status: 'INSUFFICIENT_BALANCE' });
    await expect(runMainnetPreflight({ ...base, publicClient: readClient({ allowance: 1n }) })).resolves.toMatchObject({ status: 'APPROVAL_REQUIRED' });
    await expect(runMainnetPreflight({ ...base, publicClient: readClient({ okbBalance: 900_000n }) })).resolves.toMatchObject({ status: 'INSUFFICIENT_GAS', balances: { requiredGasWei: '960000' } });
    await expect(runMainnetPreflight({ ...base, publicClient: readClient({ assetDecimals: 6 }) })).resolves.toMatchObject({ status: 'INVALID_DECIMALS' });
    await expect(runMainnetPreflight({ ...base, publicClient: readClient({ stableDecimals: 18 }) })).resolves.toMatchObject({ status: 'INVALID_DECIMALS' });
  });
});
