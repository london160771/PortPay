import { encodeFunctionData, type Address, type Hex } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import type { Invoice, MainnetApprovalPreparation, MainnetApprovalPreparationResponse, MainnetReadinessRecheckResponse } from './api';
import { toBuilderCodeDataSuffix } from './builderCodes';
import { mainnetNetworkConfig } from './network';
import { canOfferMainnetPay, clearMainnetSubmissionRecovery, mainnetPreparationNeedsRefresh, MAINNET_PRE_PROMPT_MIN_REMAINING_MS, MAINNET_TARGET_PREPARATION_WINDOW_MS, readMainnetSubmissionRecovery, saveMainnetSubmissionRecovery, validateMainnetPrePromptReadiness, validateReadyMainnetHandoff } from './mainnetPayment';

const buyer = '0xbabdfef588cf57efcc7c8857960e3ccdd9167589' as Address;
const merchant = '0x815c2fb8178f0bf80ada8c5b97ff44ece90e6e25' as Address;
const router = '0x7c5bee2a8091c3ef39072f64f18fac913060aeaf' as Address;
const spender = '0x8b773d83bc66be128c60e07e17c8901f7a64f000' as Address;
const code = '5fc2j7wx6trof4eu';
const amount = '4800000000000000';
const invoiceId = '00000000-0000-4000-8000-000000000001';
const preparationId = '00000000-0000-4000-8000-000000000002';
const expiresAt = '2026-09-23T00:01:00.000Z';
const now = Date.parse('2026-09-23T00:00:20.000Z');
const approveAbi = [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }] as const;

const invoice: Invoice = {
  id: invoiceId, title: 'Proof invoice', amountUsdt0: '1', merchantAddress: merchant,
  paymentUrl: `https://portpay.example/pay/${invoiceId}`, status: 'pending', paymentNetwork: 'x-layer-mainnet',
  createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z',
};

function preparation(overrides: Partial<MainnetApprovalPreparation> = {}): MainnetApprovalPreparation {
  const approvalCalldata = encodeFunctionData({ abi: approveAbi, functionName: 'approve', args: [spender, BigInt(amount)] });
  const dataSuffix = toBuilderCodeDataSuffix(code)!;
  return {
    preparationId, preparationHash: `0x${'a'.repeat(64)}` as Hex, invoiceId, buyer, merchant, chainId: 196,
    token: mainnetNetworkConfig.wNvdaAddress as Address, outputToken: mainnetNetworkConfig.usdt0Address as Address,
    spender, amount, minimumReceive: '1000000', nativeValue: '0', approvalCalldata,
    attributedApprovalCalldata: `${approvalCalldata}${dataSuffix.slice(2)}` as Hex, dataSuffix, builderCode: code,
    expiresAt, preparationBlockNumber: '12345', snapshotAllowance: amount, ...overrides,
    handoffMessage: 'PortPay Mainnet Pay authorization\nChain ID: 196\nTest',
  };
}

function readiness(overrides: Partial<MainnetReadinessRecheckResponse> = {}): MainnetReadinessRecheckResponse {
  return {
    status: 'READY', ready: true, reason: 'Ready', preparationId,
    preparationHash: `0x${'a'.repeat(64)}`, expiresAt,
    handoffId: '00000000-0000-4000-8000-000000000003', handoffStartedAt: '2026-09-23T00:00:19.000Z',
    checkedAt: '2026-09-23T00:00:20.000Z',
    walletTransaction: { from: buyer, to: router, data: `0x${'ab'.repeat(100)}` as Hex, value: '0', chainId: 196 },
    ...overrides,
  };
}

describe('buyer-signed Mainnet handoff guard', () => {
  it('refreshes an expired or too-close preparation before requesting a wallet signature', () => {
    expect(mainnetPreparationNeedsRefresh('2026-09-23T00:00:19.000Z', now)).toBe(true);
    expect(mainnetPreparationNeedsRefresh(expiresAt, now)).toBe(true);
    expect(mainnetPreparationNeedsRefresh(new Date(now + MAINNET_TARGET_PREPARATION_WINDOW_MS).toISOString(), now)).toBe(false);
    expect(mainnetPreparationNeedsRefresh('not-a-date', now)).toBe(true);
    const fresh = preparation();
    expect(validateMainnetPrePromptReadiness({
      status: 'PREFLIGHT_PASSED', ready: false, reason: 'Read-only gates passed.', preparationId,
      preparationHash: fresh.preparationHash, expiresAt: fresh.expiresAt, checkedAt: new Date(now).toISOString(),
    }, fresh, invoice, buyer, 196, now)).toBeNull();
    expect(validateMainnetPrePromptReadiness({
      status: 'PREFLIGHT_PASSED', ready: false, reason: 'Read-only gates passed.', preparationId,
      preparationHash: fresh.preparationHash, expiresAt: '2026-09-23T00:00:30.000Z', checkedAt: new Date(now).toISOString(),
    }, fresh, invoice, buyer, 196, now)).not.toBeNull();
    const shortUnderlyingWindow = preparation({ expiresAt: new Date(now + MAINNET_PRE_PROMPT_MIN_REMAINING_MS + 1).toISOString() });
    expect(mainnetPreparationNeedsRefresh(shortUnderlyingWindow.expiresAt, now)).toBe(true);
    expect(validateMainnetPrePromptReadiness({
      status: 'PREFLIGHT_PASSED', ready: false, reason: 'Read-only gates passed.', preparationId,
      preparationHash: shortUnderlyingWindow.preparationHash, expiresAt: shortUnderlyingWindow.expiresAt,
      checkedAt: new Date(now).toISOString(),
    }, shortUnderlyingWindow, invoice, buyer, 196, now)).toBeNull();
  });

  it('makes Pay available for a READY response containing the validated existing preparation', () => {
    const persistedPreparation = preparation();
    const response: MainnetApprovalPreparationResponse = { status: 'READY', reason: 'Full preflight passed.', preparation: persistedPreparation };
    expect(canOfferMainnetPay(response, invoice, buyer, 196, now)).toBe(true);
    expect(canOfferMainnetPay({ status: 'READY' }, invoice, buyer, 196, now)).toBe(false);
    expect(canOfferMainnetPay({ ...response, status: 'APPROVAL_REQUIRED' }, invoice, buyer, 196, now)).toBe(false);
    const retry = {
      ...response, status: 'HANDOFF_UNRESOLVED',
      existingPayment: { preparationId, handoffId: '00000000-0000-4000-8000-000000000003', buyer },
    };
    expect(canOfferMainnetPay(retry, invoice, buyer, 196, now)).toBe(false);
    expect(canOfferMainnetPay({ ...retry, status: 'READY' }, invoice, buyer, 196, now)).toBe(false);
    expect(canOfferMainnetPay({ ...retry, existingPayment: { ...retry.existingPayment, transactionHash: `0x${'c'.repeat(64)}` as Hex } }, invoice, buyer, 196, now)).toBe(false);
    expect(canOfferMainnetPay({ ...retry, existingPayment: { ...retry.existingPayment, preparationId: 'different' } }, invoice, buyer, 196, now)).toBe(false);
  });

  it('accepts only the READY server response bound to the same fresh preparation and buyer', () => {
    expect(validateReadyMainnetHandoff(readiness(), preparation(), invoice, buyer, 196, now)).toBeNull();
  });

  it.each([
    ['not READY', readiness({ status: 'BLOCKED', ready: false }), preparation(), invoice, buyer, 196],
    ['different preparation', readiness({ preparationId: '00000000-0000-4000-8000-000000000004' }), preparation(), invoice, buyer, 196],
    ['different preparation hash', readiness({ preparationHash: `0x${'b'.repeat(64)}` as Hex }), preparation(), invoice, buyer, 196],
    ['wrong buyer', readiness({ walletTransaction: { ...readiness().walletTransaction!, from: merchant } }), preparation(), invoice, buyer, 196],
    ['wrong chain', readiness({ walletTransaction: { ...readiness().walletTransaction!, chainId: 1952 as 196 } }), preparation(), invoice, buyer, 196],
    ['nonzero native value', readiness({ walletTransaction: { ...readiness().walletTransaction!, value: '1' } }), preparation(), invoice, buyer, 196],
    ['missing calldata', readiness({ walletTransaction: { ...readiness().walletTransaction!, data: '0x' } }), preparation(), invoice, buyer, 196],
    ['expired before wallet prompt', readiness(), preparation({ expiresAt: '2026-09-23T00:00:19.000Z' }), invoice, buyer, 196],
    ['testnet invoice', readiness(), preparation(), { ...invoice, paymentNetwork: 'x-layer-testnet' } as Invoice, buyer, 196],
  ])('rejects %s', (_name, result, prepared, targetInvoice, targetBuyer, chainId) => {
    expect(validateReadyMainnetHandoff(result, prepared, targetInvoice, targetBuyer, chainId, now)).not.toBeNull();
  });

  it('persists and restores only the same submitted transaction locator for reload recovery', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => { values.delete(key); },
    });
    try {
      const attempt = { invoiceId, preparationId, handoffId: '00000000-0000-4000-8000-000000000003', transactionHash: `0x${'c'.repeat(64)}` as Hex, buyerAddress: buyer };
      saveMainnetSubmissionRecovery(attempt);
      expect(readMainnetSubmissionRecovery(invoiceId)).toEqual(attempt);
      expect(readMainnetSubmissionRecovery('another-invoice')).toBeNull();
      clearMainnetSubmissionRecovery(invoiceId);
      expect(readMainnetSubmissionRecovery(invoiceId)).toBeNull();
      expect(canOfferMainnetPay({
        status: 'HANDOFF_UNRESOLVED',
        existingPayment: { preparationId, handoffId: attempt.handoffId, buyer },
      }, invoice, buyer, 196, now)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
