import { encodeFunctionData, type Address, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { mainnetAddressConfig } from '../config/xlayerMainnet.js';
import type { Invoice } from '../invoices/types.js';
import { toMainnetBuilderCodeDataSuffix } from './builderCodes.js';
import type { MainnetQuote, OKXDEXMainnetAdapter, PreparedMainnetTransaction } from './mainnet.js';
import type { MainnetPreparationEvidence, MainnetReconciliationRepository } from './mainnetReconciliationRepository.js';
import { createMainnetApprovalPreparationService, MAINNET_APPROVAL_PROOF_INPUT } from './mainnetApprovalPreparation.js';
import type { MainnetPreflightRequest, MainnetPreflightResult } from './mainnetPreflight.js';

const buyer = '0xbabdfef588cf57efcc7c8857960e3ccdd9167589' as Address;
const merchant = '0x815c2fb8178f0bf80ada8c5b97ff44ece90e6e25' as Address;
const token = mainnetAddressConfig.wNvda as Address;
const spender = '0x8b773d83bc66be128c60e07e17c8901f7a64f000' as Address;
const builderCode = '5fc2j7wx6trof4eu';
const amount = MAINNET_APPROVAL_PROOF_INPUT;
const suffix = toMainnetBuilderCodeDataSuffix(builderCode)!;
const approveAbi = [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }] as const;
const approvalCalldata = encodeFunctionData({ abi: approveAbi, functionName: 'approve', args: [spender, BigInt(amount)] });
const invoice: Invoice = {
  id: '00000000-0000-4000-8000-000000000001', title: 'Mainnet proof', amountUsdt0: '1', merchantAddress: merchant,
  paymentUrl: 'http://localhost:5173/pay/00000000-0000-4000-8000-000000000001', status: 'pending',
  createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z',
};
const quote = {
  asset: token, assetAmount: amount, assetKey: 'wNvda', buyer, chainId: 196,
  createdAt: '2026-09-23T00:00:00.000Z', expiresAt: '2026-09-23T00:01:00.000Z', invoiceId: invoice.id,
  invoiceStablecoinAmount: '1000000', merchant, minReceiveAmount: '1000000', quotedStablecoinAmount: '1010000',
  slippagePercent: '0.5', stablecoin: mainnetAddressConfig.usdt0 as Address,
} satisfies MainnetQuote;
const approval = {
  amount, attributedData: `${approvalCalldata}${suffix.slice(2)}` as Hex, builderCode, data: approvalCalldata,
  dataSuffix: suffix, from: buyer, gas: 50000n, gasPrice: 1000000n, kind: 'approval', to: token, value: 0n, chainId: 196,
} satisfies PreparedMainnetTransaction;
const evidence = {
  id: '00000000-0000-4000-8000-000000000002', invoiceId: invoice.id, quoteId: 'test-quote', buyer, merchant, chainId: 196,
  inputToken: token, outputToken: mainnetAddressConfig.usdt0 as Address, exactInputAmount: amount,
  expectedOutput: '1010000', minimumReceive: '1000000', routePath: 'wNVDAx--USDt0', routeFingerprint: `0x${'1'.repeat(64)}` as Hex,
  slippagePercent: '0.5', previewQuoteHash: `0x${'2'.repeat(64)}` as Hex, preparationHash: `0x${'3'.repeat(64)}` as Hex,
  authenticatedSwapResponseHash: `0x${'4'.repeat(64)}` as Hex, preparedAt: '2026-09-23T00:00:00.000Z',
  router: '0x7c5bee2a8091c3ef39072f64f18fac913060aeaf' as Address, spender,
  attributedApprovalCalldata: approval.attributedData, attributedApprovalCalldataHash: `0x${'5'.repeat(64)}` as Hex,
  attributedSwapCalldata: `0x${'11'.repeat(80)}` as Hex, attributedSwapCalldataHash: `0x${'6'.repeat(64)}` as Hex,
  builderCode, builderPayout: buyer, preparationBlockNumber: '12345', preparationBlockHash: `0x${'7'.repeat(64)}` as Hex,
  expiresAt: '2026-09-23T01:00:00.000Z', quote, approval, swap: {} as PreparedMainnetTransaction, stablecoinInvoiceAmount: '1000000',
} satisfies MainnetPreparationEvidence;

function fixture(preflightResult: MainnetPreflightResult = {
  status: 'APPROVAL_REQUIRED', ready: false, reason: 'Approval simulation passed.',
  builderCode: { status: 'VERIFIED', code: builderCode, payoutAddress: buyer, registryAddress: '0xd6c426f9c077358735622ae5a83468dc0510823b' as Address, chainId: 196 },
  balances: { assetAddress: token, assetBalance: '5000000000000000', assetDecimals: 18, allowance: '0', approvalSpender: spender, buyerAddress: buyer, buyerOkbBalance: '1000000000000000000', merchantAddress: merchant, merchantStablecoinBalance: '0', stablecoinAddress: mainnetAddressConfig.usdt0 as Address, stablecoinDecimals: 6, snapshotBlockNumber: '12345', snapshotBlockHash: `0x${'7'.repeat(64)}` as Hex },
  simulations: { stage: 'approval', approval: 'passed', swap: 'not-run' }, preparationId: evidence.id,
}) {
  const calls: MainnetPreflightRequest[] = [];
  const adapter = {
    getQuote: async (request: { assetAmount: string; assetKey: string; buyerAddress: string; invoice: Invoice }) => {
      expect(request.assetAmount).toBe(MAINNET_APPROVAL_PROOF_INPUT);
      expect(request.assetKey).toBe('wNvda');
      expect(request.buyerAddress).toBe(buyer);
      expect(request.invoice.id).toBe(invoice.id);
      return quote;
    },
    prepareApprovalTransaction: async () => approval,
    getBuilderCode: () => builderCode,
  } as unknown as OKXDEXMainnetAdapter;
  const repository = {
    savePreparation: async () => {}, getPreparation: async () => evidence, claimSettlement: async () => false,
  } satisfies MainnetReconciliationRepository;
  const service = createMainnetApprovalPreparationService({
    createAdapter: () => adapter,
    createRepository: () => repository,
    preflight: async (request) => { calls.push(request); return preflightResult; },
    now: () => new Date('2026-09-23T00:30:00.000Z'),
  });
  return { service, calls };
}

describe('backend-prepared mainnet approval service', () => {
  it('binds the fixed input to a fresh persisted preparation and returns only the exact attributed approval', async () => {
    const { service, calls } = fixture();
    const result = await service(invoice, buyer);
    expect(calls).toHaveLength(1);
    expect(result.status).toBe('APPROVAL_REQUIRED');
    expect(result.preparation).toMatchObject({
      invoiceId: invoice.id, buyer, merchant, chainId: 196, token, outputToken: mainnetAddressConfig.usdt0,
      spender, amount, minimumReceive: '1000000', nativeValue: '0', attributedApprovalCalldata: approval.attributedData,
    });
  });

  it('does not expose approval calldata unless Stage A passed and returned APPROVAL_REQUIRED', async () => {
    const { service } = fixture({
      status: 'SIMULATION_FAILED', ready: false, reason: 'Approval simulation failed.',
      builderCode: { status: 'VERIFIED', code: builderCode, payoutAddress: buyer, registryAddress: '0xd6c426f9c077358735622ae5a83468dc0510823b' as Address, chainId: 196 },
    });
    const result = await service(invoice, buyer);
    expect(result.status).toBe('SIMULATION_FAILED');
    expect(result).not.toHaveProperty('preparation');
  });

  it('fails closed if the persisted evidence belongs to another buyer', async () => {
    const changedEvidence = { ...evidence, buyer: '0x1111111111111111111111111111111111111111' as Address };
    const isolatedRepository = { savePreparation: async () => {}, getPreparation: async () => changedEvidence, claimSettlement: async () => false };
    const result = await createMainnetApprovalPreparationService({
      createAdapter: () => ({ getQuote: async () => quote, prepareApprovalTransaction: async () => approval, getBuilderCode: () => builderCode } as unknown as OKXDEXMainnetAdapter),
      createRepository: () => isolatedRepository,
      preflight: async () => ({
        status: 'APPROVAL_REQUIRED', ready: false, reason: 'passed',
        builderCode: { status: 'VERIFIED', code: builderCode, payoutAddress: buyer, registryAddress: '0xd6c426f9c077358735622ae5a83468dc0510823b' as Address, chainId: 196 },
        balances: {
          assetAddress: token, assetBalance: '5000000000000000', assetDecimals: 18, allowance: '0', approvalSpender: spender,
          buyerAddress: buyer, buyerOkbBalance: '1000000000000000000', merchantAddress: merchant, merchantStablecoinBalance: '0',
          stablecoinAddress: mainnetAddressConfig.usdt0 as Address, stablecoinDecimals: 6, snapshotBlockNumber: '12345', snapshotBlockHash: `0x${'7'.repeat(64)}` as Hex,
        },
        simulations: { stage: 'approval', approval: 'passed', swap: 'not-run' }, preparationId: evidence.id,
      } as unknown as MainnetPreflightResult),
      now: () => new Date('2026-09-23T00:30:00.000Z'),
    })(invoice, buyer);
    expect(result.status).toBe('BLOCKED');
    expect(result).not.toHaveProperty('preparation');
  });
});
