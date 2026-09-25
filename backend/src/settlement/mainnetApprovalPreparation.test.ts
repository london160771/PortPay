import { decodeFunctionData, encodeFunctionData, type Address, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { mainnetAddressConfig, mainnetSupportedAssets } from '../config/xlayerMainnet.js';
import type { Invoice } from '../invoices/types.js';
import { toMainnetBuilderCodeDataSuffix } from './builderCodes.js';
import type { MainnetQuote, OKXDEXMainnetAdapter, PreparedMainnetTransaction } from './mainnet.js';
import type { MainnetPreparationEvidence, MainnetReconciliationRepository } from './mainnetReconciliationRepository.js';
import { createMainnetApprovalPreparationService, MAINNET_APPROVAL_PROOF_SLIPPAGE_PERCENT, MAINNET_SIZING_MAX_QUOTES, MAINNET_TOTAL_QUOTE_BUDGET } from './mainnetApprovalPreparation.js';
import type { MainnetPreflightRequest, MainnetPreflightResult } from './mainnetPreflight.js';

const buyer = '0xbabdfef588cf57efcc7c8857960e3ccdd9167589' as Address;
const merchant = '0x815c2fb8178f0bf80ada8c5b97ff44ece90e6e25' as Address;
const spender = '0x8b773d83bc66be128c60e07e17c8901f7a64f000' as Address;
const builderCode = '5fc2j7wx6trof4eu';
const suffix = toMainnetBuilderCodeDataSuffix(builderCode)!;
const approveAbi = [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }] as const;
const fixedNow = new Date('2026-09-23T00:30:00.000Z');
const assetFor = (assetKey: 'wNvda' | 'wAapl') => mainnetSupportedAssets.find((asset) => asset.key === assetKey)!;

function makeInvoice(amountUsdt0 = '1'): Invoice {
  return {
    id: '00000000-0000-4000-8000-000000000001', title: 'Mainnet invoice', amountUsdt0, merchantAddress: merchant,
    paymentUrl: 'http://localhost:5173/pay/00000000-0000-4000-8000-000000000001', status: 'pending', paymentNetwork: 'x-layer-mainnet',
    createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z',
  };
}

function makeQuote(invoice: Invoice, assetKey: 'wNvda' | 'wAapl', amount: string): MainnetQuote {
  const expected = (BigInt(amount) / 1_000_000_000_000n).toString();
  const invoiceAmount = BigInt(Math.round(Number(invoice.amountUsdt0) * 1_000_000)).toString();
  const slippageOutput = (BigInt(expected) * 985_000n / 1_000_000n).toString();
  return {
    asset: assetFor(assetKey).address as Address, assetAmount: amount, assetKey, buyer, chainId: 196,
    createdAt: fixedNow.toISOString(), expiresAt: new Date(fixedNow.getTime() + 120_000).toISOString(), invoiceId: invoice.id,
    invoiceStablecoinAmount: invoiceAmount, merchant, minReceiveAmount: (BigInt(slippageOutput) > BigInt(invoiceAmount) ? slippageOutput : invoiceAmount),
    quotedStablecoinAmount: expected, routerPath: `${assetFor(assetKey).address}--${mainnetAddressConfig.usdt0}`,
    slippagePercent: MAINNET_APPROVAL_PROOF_SLIPPAGE_PERCENT, stablecoin: mainnetAddressConfig.usdt0 as Address,
  };
}

function makeApproval(quote: MainnetQuote): PreparedMainnetTransaction {
  const data = encodeFunctionData({ abi: approveAbi, functionName: 'approve', args: [spender, BigInt(quote.assetAmount)] });
  return {
    amount: quote.assetAmount, attributedData: `${data}${suffix.slice(2)}` as Hex, builderCode, data, dataSuffix: suffix,
    from: buyer, gas: 50_000n, gasPrice: 1_000_000n, kind: 'approval', to: quote.asset, value: 0n, chainId: 196,
  };
}

function makeEvidence(quote: MainnetQuote, approval: PreparedMainnetTransaction): MainnetPreparationEvidence {
  return {
    id: '00000000-0000-4000-8000-000000000002', invoiceId: quote.invoiceId, quoteId: 'test-quote', buyer, merchant, chainId: 196,
    inputToken: quote.asset, outputToken: mainnetAddressConfig.usdt0 as Address, exactInputAmount: quote.assetAmount,
    inputConsumptionMode: 'exact-in-max-debit-net-observed', expectedOutput: quote.quotedStablecoinAmount,
    minimumReceive: quote.minReceiveAmount, routePath: 'connected-test-route', routeFingerprint: `0x${'1'.repeat(64)}` as Hex,
    slippagePercent: quote.slippagePercent, previewQuoteHash: `0x${'2'.repeat(64)}` as Hex,
    preparationHash: `0x${'3'.repeat(64)}` as Hex, authenticatedSwapResponseHash: `0x${'4'.repeat(64)}` as Hex,
    preparedAt: fixedNow.toISOString(), router: '0x7c5bee2a8091c3ef39072f64f18fac913060aeaf' as Address, spender,
    attributedApprovalCalldata: approval.attributedData!, attributedApprovalCalldataHash: `0x${'5'.repeat(64)}` as Hex,
    attributedSwapCalldata: `0x${'11'.repeat(80)}` as Hex, attributedSwapCalldataHash: `0x${'6'.repeat(64)}` as Hex,
    builderCode, builderPayout: buyer, preparationBlockNumber: '12345', preparationBlockHash: `0x${'7'.repeat(64)}` as Hex,
    expiresAt: new Date(fixedNow.getTime() + 120_000).toISOString(), quote, approval,
    swap: { kind: 'swap', from: buyer, to: '0x7c5bee2a8091c3ef39072f64f18fac913060aeaf' as Address, data: `0x${'11'.repeat(80)}` as Hex, attributedData: `0x${'11'.repeat(80)}${suffix.slice(2)}` as Hex, dataSuffix: suffix, builderCode, value: 0n, chainId: 196 },
    stablecoinInvoiceAmount: quote.invoiceStablecoinAmount,
  };
}

function preflightResult(
  quote: MainnetQuote,
  status: 'APPROVAL_REQUIRED' | 'READY' | 'INSUFFICIENT_BALANCE',
  approval: PreparedMainnetTransaction,
): MainnetPreflightResult {
  const evidence = makeEvidence(quote, approval);
  const allowance = status === 'READY' ? quote.assetAmount : '0';
  return {
    status, ready: status === 'READY', reason: status === 'INSUFFICIENT_BALANCE' ? 'Buyer balance does not cover the invoice-sized input.' : 'Read-only gates passed.',
    builderCode: { status: 'VERIFIED', code: builderCode, payoutAddress: buyer, registryAddress: '0xd6c426f9c077358735622ae5a83468dc0510823b' as Address, chainId: 196 },
    balances: {
      assetAddress: quote.asset, assetBalance: status === 'INSUFFICIENT_BALANCE' ? '0' : (BigInt(quote.assetAmount) * 2n).toString(),
      assetDecimals: 18, allowance, approvalSpender: spender, buyerAddress: buyer, buyerOkbBalance: '1000000000000000000',
      merchantAddress: merchant, merchantStablecoinBalance: '0', stablecoinAddress: mainnetAddressConfig.usdt0 as Address,
      stablecoinDecimals: 6, snapshotBlockNumber: '12345', snapshotBlockHash: `0x${'7'.repeat(64)}` as Hex,
    },
    ...(status === 'INSUFFICIENT_BALANCE' ? {} : { simulations: status === 'READY'
      ? { stage: 'swap' as const, approval: 'not-run' as const, swap: 'passed' as const }
      : { stage: 'approval' as const, approval: 'passed' as const, swap: 'not-run' as const } }),
    ...(status === 'INSUFFICIENT_BALANCE' ? {} : { preparationId: evidence.id }),
  };
}

function fixture(options: {
  initialStatus?: 'APPROVAL_REQUIRED' | 'READY' | 'INSUFFICIENT_BALANCE';
  recheckStatus?: 'PREFLIGHT_PASSED' | 'INSUFFICIENT_ALLOWANCE' | 'EXPIRED';
  existingHandoff?: boolean;
  unfillableSizingQuote?: boolean;
} = {}) {
  const calls: MainnetPreflightRequest[] = [];
  const sizingRequests: Array<{ assetAmount: string; assetKey: string }> = [];
  const finalQuotes: Array<{ assetAmount: string; assetKey: string }> = [];
  let approvalPreparationCalls = 0;
  let currentInvoice = makeInvoice();
  let persisted: MainnetPreparationEvidence | null = options.existingHandoff
    ? makeEvidence(makeQuote(currentInvoice, 'wNvda', '2000000000000000000'), makeApproval(makeQuote(currentInvoice, 'wNvda', '2000000000000000000')))
    : null;
  const adapter = {
    getSizingQuote: async (request: { assetAmount: string; assetKey: 'wNvda' | 'wAapl' }) => {
      sizingRequests.push({ assetAmount: request.assetAmount, assetKey: request.assetKey });
      const expected = options.unfillableSizingQuote ? 1n : BigInt(request.assetAmount) / 1_000_000_000_000n;
      return { expectedOutputAmount: expected.toString(), protectedOutputAmount: (expected * 985_000n / 1_000_000n).toString() };
    },
    getQuote: async (request: { assetAmount: string; assetKey: 'wNvda' | 'wAapl'; invoice: Invoice }) => {
      currentInvoice = request.invoice;
      finalQuotes.push({ assetAmount: request.assetAmount, assetKey: request.assetKey });
      return makeQuote(request.invoice, request.assetKey, request.assetAmount);
    },
    prepareApprovalTransaction: async (quote: MainnetQuote) => { approvalPreparationCalls += 1; return makeApproval(quote); },
    getBuilderCode: () => builderCode,
  } as unknown as OKXDEXMainnetAdapter;
  const repository = {
    savePreparation: async (value: MainnetPreparationEvidence) => { persisted = value; },
    getPreparation: async () => persisted,
    createHandoff: async () => null, getHandoff: async () => null,
    getHandoffForInvoice: async () => options.existingHandoff ? {
      id: currentInvoice.id, preparationId: '00000000-0000-4000-8000-000000000002', invoiceId: currentInvoice.id, buyer, chainId: 196 as const,
      preparationHash: `0x${'3'.repeat(64)}` as Hex, calldataHash: `0x${'6'.repeat(64)}` as Hex, handoffStartedAt: fixedNow.toISOString(),
    } : null,
    recordSubmission: async () => null, getSubmission: async () => null, getSubmissionForPreparation: async () => null,
    claimSettlement: async (): Promise<false> => false,
  } satisfies MainnetReconciliationRepository;
  const service = createMainnetApprovalPreparationService({
    createAdapter: () => adapter,
    createRepository: () => repository,
    preflight: async (request) => {
      calls.push(request);
      const approval = request.approval;
      const quote = request.quote;
      if (options.initialStatus === 'INSUFFICIENT_BALANCE') return preflightResult(quote, 'INSUFFICIENT_BALANCE', approval);
      const result = preflightResult(quote, options.initialStatus ?? 'APPROVAL_REQUIRED', approval);
      persisted = makeEvidence(quote, approval);
      return result;
    },
    recheckPersistedPreparation: async (_invoice, preparationId) => options.recheckStatus === 'EXPIRED'
      ? { status: 'EXPIRED', ready: false, reason: 'Expired.', preparationId, checkedAt: fixedNow.toISOString() }
      : options.recheckStatus === 'INSUFFICIENT_ALLOWANCE'
        ? { status: 'INSUFFICIENT_ALLOWANCE', ready: false, reason: 'Exact allowance is not visible yet.', preparationId, checkedAt: fixedNow.toISOString() }
        : { status: 'PREFLIGHT_PASSED', ready: false, reason: 'Exact allowance and persisted calls passed.', preparationId, preparationHash: `0x${'3'.repeat(64)}` as Hex, checkedAt: fixedNow.toISOString() },
    now: () => fixedNow,
  });
  return { service, calls, sizingRequests, finalQuotes, getApprovalPreparationCalls: () => approvalPreparationCalls, getPersisted: () => persisted };
}

describe('invoice-sized Mainnet approval preparation', () => {
  it('derives the $1 input from bounded exact-in quotes and exposes the full exact approval', async () => {
    const value = fixture();
    const result = await value.service(makeInvoice('1'), buyer, { assetKey: 'wNvda' });
    const amount = value.finalQuotes[0]!.assetAmount;
    expect(result.status).toBe('APPROVAL_REQUIRED');
    expect(value.sizingRequests.length).toBeGreaterThan(0);
    expect(value.sizingRequests.length).toBeLessThanOrEqual(MAINNET_SIZING_MAX_QUOTES);
    expect(value.sizingRequests.length + value.finalQuotes.length).toBeLessThanOrEqual(MAINNET_TOTAL_QUOTE_BUDGET);
    expect(value.finalQuotes).toEqual([{ assetAmount: amount, assetKey: 'wNvda' }]);
    expect(amount).not.toBe('4800000000000000');
    expect(result.preparation).toMatchObject({ token: assetFor('wNvda').address, amount, minimumReceive: expect.any(String) });
    expect(BigInt(result.preparation!.minimumReceive)).toBeGreaterThanOrEqual(1_000_000n);
    const decoded = decodeFunctionData({ abi: approveAbi, data: result.preparation!.approvalCalldata });
    expect(decoded.args[1]).toBe(BigInt(amount));
    expect(value.calls).toHaveLength(1);
  });

  it('derives a different, larger exact-in input for a larger invoice instead of using a fixed proof amount', async () => {
    const value = fixture();
    const oneDollar = await value.service(makeInvoice('1'), buyer, { assetKey: 'wNvda' });
    const tenDollars = await value.service(makeInvoice('10'), buyer, { assetKey: 'wNvda' });
    const firstAmount = BigInt(oneDollar.preparation!.amount);
    const largerAmount = BigInt(tenDollars.preparation!.amount);
    expect(largerAmount).toBeGreaterThan(firstAmount);
    expect(tenDollars.preparation!.amount).not.toBe('4800000000000000');
    expect(BigInt(tenDollars.preparation!.minimumReceive)).toBeGreaterThanOrEqual(10_000_000n);
  });

  it('uses the buyer-selected supported xStock and binds its exact input to approval', async () => {
    const value = fixture();
    const result = await value.service(makeInvoice('2'), buyer, { assetKey: 'wAapl' });
    expect(result.status).toBe('APPROVAL_REQUIRED');
    expect(value.sizingRequests.every((request) => request.assetKey === 'wAapl')).toBe(true);
    expect(result.preparation?.token.toLowerCase()).toBe(assetFor('wAapl').address.toLowerCase());
    expect(value.finalQuotes).toHaveLength(1);
  });

  it('fails clearly when the buyer balance cannot cover the invoice-sized input', async () => {
    const value = fixture({ initialStatus: 'INSUFFICIENT_BALANCE' });
    const result = await value.service(makeInvoice('50'), buyer, { assetKey: 'wNvda' });
    expect(result.status).toBe('INSUFFICIENT_BALANCE');
    expect(result.reason).toMatch(/balance/i);
    expect(result).not.toHaveProperty('preparation');
  });

  it('stops after the bounded quote budget when the available route cannot cover the invoice', async () => {
    const value = fixture({ unfillableSizingQuote: true });
    const result = await value.service(makeInvoice('50'), buyer, { assetKey: 'wNvda' });
    expect(result.status).toBe('INVALID_ROUTE');
    expect(result.reason).toMatch(/within 4 bounded sizing quote requests/i);
    expect(value.sizingRequests).toHaveLength(MAINNET_SIZING_MAX_QUOTES);
    expect(value.sizingRequests.length + value.finalQuotes.length).toBeLessThanOrEqual(MAINNET_TOTAL_QUOTE_BUDGET);
    expect(value.finalQuotes).toHaveLength(0);
    expect(value.calls).toHaveLength(0);
  });

  it('returns READY from the existing persisted preparation after exact allowance recheck without another quote or preparation', async () => {
    const value = fixture({ recheckStatus: 'PREFLIGHT_PASSED' });
    const initial = await value.service(makeInvoice('5'), buyer, { assetKey: 'wAapl' });
    const prepId = initial.preparation!.preparationId;
    const quoteCount = value.finalQuotes.length;
    const sizingCount = value.sizingRequests.length;
    const approvalCount = value.getApprovalPreparationCalls();
    const ready = await value.service(makeInvoice('5'), buyer, { assetKey: 'wAapl', preparationId: prepId });
    expect(ready.status).toBe('READY');
    expect(ready.preparation).toMatchObject({ preparationId: prepId, amount: initial.preparation!.amount, attributedApprovalCalldata: initial.preparation!.attributedApprovalCalldata });
    expect(ready.preparation?.handoffMessage).toContain(`Invoice ID: ${makeInvoice('5').id}`);
    expect(value.finalQuotes).toHaveLength(quoteCount);
    expect(value.sizingRequests).toHaveLength(sizingCount);
    expect(value.getApprovalPreparationCalls()).toBe(approvalCount);
  });

  it('keeps approval available if the post-approval allowance is not yet exact and never replaces the preparation', async () => {
    const value = fixture({ recheckStatus: 'INSUFFICIENT_ALLOWANCE' });
    const initial = await value.service(makeInvoice('2'), buyer, { assetKey: 'wNvda' });
    const counts = [value.sizingRequests.length, value.finalQuotes.length, value.getApprovalPreparationCalls()];
    const retry = await value.service(makeInvoice('2'), buyer, { assetKey: 'wNvda', preparationId: initial.preparation!.preparationId });
    expect(retry.status).toBe('APPROVAL_REQUIRED');
    expect(retry.preparation?.preparationId).toBe(initial.preparation?.preparationId);
    expect([value.sizingRequests.length, value.finalQuotes.length, value.getApprovalPreparationCalls()]).toEqual(counts);
  });

  it('skips the approval-required state when exact allowance is already present', async () => {
    const value = fixture({ initialStatus: 'READY' });
    const result = await value.service(makeInvoice('3'), buyer, { assetKey: 'wNvda' });
    expect(result.status).toBe('READY');
    expect(BigInt(result.preparation!.snapshotAllowance)).toBe(BigInt(result.preparation!.amount));
  });

  it('returns an existing invoice handoff without sizing or requesting another swap preparation', async () => {
    const value = fixture({ existingHandoff: true });
    const result = await value.service(makeInvoice(), buyer, { assetKey: 'wNvda' });
    expect(result.status).toBe('HANDOFF_UNRESOLVED');
    expect(value.sizingRequests).toHaveLength(0);
    expect(value.finalQuotes).toHaveLength(0);
    expect(value.calls).toHaveLength(0);
  });
});
