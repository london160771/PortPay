import { isAddress, isHex, type Address } from 'viem';
import type { Invoice, MainnetApprovalPreparation, MainnetReadinessRecheckResponse, MainnetSubmissionResponse } from './api';
import { validatePreparedMainnetApproval } from './mainnetApproval';

export type MainnetSubmissionRecovery = Pick<MainnetSubmissionResponse, 'preparationId' | 'handoffId' | 'transactionHash'> & {
  invoiceId: string;
  buyerAddress: Address;
};

export const MAINNET_TARGET_PREPARATION_WINDOW_MS = 120_000;
export const MAINNET_PRE_PROMPT_MIN_REMAINING_MS = 30_000;

export function mainnetPreparationNeedsRefresh(
  expiresAt: string,
  nowMs = Date.now(),
  minimumRemainingMs = MAINNET_TARGET_PREPARATION_WINDOW_MS,
): boolean {
  const expiry = Date.parse(expiresAt);
  return !Number.isFinite(expiry) || expiry - nowMs < minimumRemainingMs;
}

export function validateMainnetPrePromptReadiness(
  result: MainnetReadinessRecheckResponse,
  preparation: MainnetApprovalPreparation,
  invoice: Invoice,
  buyer: Address,
  chainId: number | undefined,
  nowMs = Date.now(),
): string | null {
  const preparationError = validatePreparedMainnetApproval(preparation, invoice, buyer, chainId, nowMs);
  if (preparationError) return preparationError;
  if (result.status !== 'PREFLIGHT_PASSED' || result.ready || result.walletTransaction) {
    return result.reason || 'Read-only final readiness did not pass.';
  }
  if (result.preparationId !== preparation.preparationId || result.preparationHash !== preparation.preparationHash
    || result.expiresAt !== preparation.expiresAt) return 'The read-only readiness result does not match the displayed persisted preparation.';
  if (mainnetPreparationNeedsRefresh(preparation.expiresAt, nowMs, MAINNET_PRE_PROMPT_MIN_REMAINING_MS)) return 'The preparation does not have sufficient lifetime for a wallet prompt. Refresh it first.';
  return null;
}

const recoveryStoragePrefix = 'portpay.mainnet.submission.';

export function canOfferMainnetPay(
  result: {
    status: string;
    preparation?: MainnetApprovalPreparation;
    existingPayment?: { preparationId: string; handoffId: string; buyer: Address; transactionHash?: `0x${string}` };
  } | null,
  invoice: Invoice,
  buyer: Address | undefined,
  chainId: number | undefined,
  nowMs = Date.now(),
): boolean {
  return Boolean(result?.status === 'READY' && !result.existingPayment && result.preparation && buyer
    && result.preparation.handoffMessage?.startsWith('PortPay Mainnet Pay authorization\nChain ID: 196\n')
    && validatePreparedMainnetApproval(result.preparation, invoice, buyer, chainId, nowMs) === null);
}

export function readMainnetSubmissionRecovery(invoiceId: string): MainnetSubmissionRecovery | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const value = sessionStorage.getItem(`${recoveryStoragePrefix}${invoiceId}`);
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const attempt = parsed as Partial<MainnetSubmissionRecovery>;
    if (attempt.invoiceId !== invoiceId || typeof attempt.preparationId !== 'string' || !attempt.preparationId
      || typeof attempt.handoffId !== 'string' || !attempt.handoffId
      || typeof attempt.transactionHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(attempt.transactionHash)
      || typeof attempt.buyerAddress !== 'string' || !isAddress(attempt.buyerAddress)) return null;
    return attempt as MainnetSubmissionRecovery;
  } catch {
    return null;
  }
}

export function saveMainnetSubmissionRecovery(attempt: MainnetSubmissionRecovery): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(`${recoveryStoragePrefix}${attempt.invoiceId}`, JSON.stringify(attempt));
    }
  } catch {
    // Recovery storage is only a locator; the backend independently validates every identifier.
  }
}

export function clearMainnetSubmissionRecovery(invoiceId: string): void {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(`${recoveryStoragePrefix}${invoiceId}`);
  } catch {
    // A stale recovery locator cannot authorize a payment without server-side evidence.
  }
}

export function validateReadyMainnetHandoff(
  result: MainnetReadinessRecheckResponse,
  preparation: MainnetApprovalPreparation,
  invoice: Invoice,
  buyer: Address,
  chainId: number | undefined,
  nowMs = Date.now(),
): string | null {
  if (invoice.paymentNetwork !== 'x-layer-mainnet' || invoice.status !== 'pending') return 'A pending Mainnet invoice is required.';
  const preparationError = validatePreparedMainnetApproval(preparation, invoice, buyer, chainId, nowMs);
  if (preparationError) return preparationError;
  if (!result.ready || result.status !== 'READY' || !result.walletTransaction) return result.reason || 'Mainnet readiness recheck did not return READY.';
  if (result.preparationId !== preparation.preparationId || result.preparationHash !== preparation.preparationHash) {
    return 'The readiness response does not match the displayed persisted preparation.';
  }
  if (!result.handoffId || !result.expiresAt || !result.handoffStartedAt
    || Date.parse(result.expiresAt) !== Date.parse(preparation.expiresAt)
    || !Number.isFinite(Date.parse(result.handoffStartedAt))
    || Date.parse(result.handoffStartedAt) >= Date.parse(result.expiresAt)
    || nowMs >= Date.parse(result.expiresAt)) return 'The server-authorized wallet handoff is missing or expired.';

  const transaction = result.walletTransaction;
  if (transaction.chainId !== 196 || transaction.from.toLowerCase() !== buyer.toLowerCase()
    || !isAddress(transaction.to) || !isHex(transaction.data) || transaction.data.length <= 2
    || transaction.value !== '0') return 'The server wallet transaction has an invalid buyer, chain, target, calldata, or native value.';
  return null;
}
