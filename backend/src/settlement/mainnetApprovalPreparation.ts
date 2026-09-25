import { decodeFunctionData, parseUnits, type Address, type Hex } from 'viem';
import type { Invoice } from '../invoices/types.js';
import { mainnetAddressConfig, mainnetSupportedAssets, VERIFIED_TESTNET_BUILDER_CODE, type MainnetAssetKey } from '../config/xlayerMainnet.js';
import { OkxDexApiClient } from './okxDexApi.js';
import {
  MAINNET_MAX_SLIPPAGE_PERCENT,
  OKXDEXMainnetAdapter,
  grossAmountForMinimum,
  minimumAfterSlippage,
  MainnetPreparationError,
  type MainnetQuote,
  type PreparedMainnetTransaction,
} from './mainnet.js';
import { toMainnetBuilderCodeDataSuffix } from './builderCodes.js';
import { mainnetHandoffAuthorizationMessage } from './mainnetHandoffAuthorization.js';
import {
  createMainnetReconciliationRepository,
  type MainnetPreparationEvidence,
  type MainnetReconciliationRepository,
} from './mainnetReconciliationRepository.js';
import {
  runMainnetPreflight,
  type MainnetPreflightResult,
} from './mainnetPreflight.js';
import { createMainnetPaymentService, type MainnetReadinessRecheck } from './mainnetPayment.js';

export const MAINNET_APPROVAL_PROOF_SLIPPAGE_PERCENT = MAINNET_MAX_SLIPPAGE_PERCENT;
export const MAINNET_TOTAL_QUOTE_BUDGET = 5;
export const MAINNET_FINAL_VALIDATION_QUOTE_COUNT = 1;
export const MAINNET_SIZING_MAX_QUOTES = MAINNET_TOTAL_QUOTE_BUDGET - MAINNET_FINAL_VALIDATION_QUOTE_COUNT;
const INITIAL_SIZING_INPUT = 10n ** 18n;
const MAX_UINT256 = (1n << 256n) - 1n;

const approvalAbi = [{
  type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

export type MainnetApprovalPreparation = {
  preparationId: string;
  preparationHash: Hex;
  invoiceId: string;
  buyer: Address;
  merchant: Address;
  chainId: 196;
  token: Address;
  outputToken: Address;
  spender: Address;
  amount: string;
  minimumReceive: string;
  nativeValue: '0';
  approvalCalldata: Hex;
  attributedApprovalCalldata: Hex;
  dataSuffix: Hex;
  builderCode: string;
  expiresAt: string;
  preparationBlockNumber: string;
  snapshotAllowance: string;
  handoffMessage?: string;
};

export type MainnetApprovalPreparationResult = {
  status: MainnetPreflightResult['status'] | 'HANDOFF_UNRESOLVED' | 'SUBMITTED';
  reason: string;
  preparation?: MainnetApprovalPreparation;
  existingPayment?: {
    preparationId: string;
    handoffId: string;
    buyer: Address;
    transactionHash?: Hex;
  };
};

export type MainnetApprovalPreparationService = (
  invoice: Invoice,
  buyerAddress: Address,
  request?: { assetKey?: MainnetAssetKey; preparationId?: string },
) => Promise<MainnetApprovalPreparationResult>;

export type MainnetApprovalPreparationDependencies = {
  createAdapter?: () => OKXDEXMainnetAdapter;
  createRepository?: () => MainnetReconciliationRepository;
  preflight?: typeof runMainnetPreflight;
  recheckPersistedPreparation?: (invoice: Invoice, preparationId: string, buyerAddress: Address) => Promise<MainnetReadinessRecheck>;
  now?: () => Date;
};

function approvalPreparationFromEvidence(
  evidence: MainnetPreparationEvidence,
  snapshotAllowance: string,
  handoffMessage?: string,
): MainnetApprovalPreparation {
  return {
    preparationId: evidence.id,
    preparationHash: evidence.preparationHash,
    invoiceId: evidence.invoiceId,
    buyer: evidence.buyer,
    merchant: evidence.merchant,
    chainId: 196,
    token: evidence.inputToken,
    outputToken: evidence.outputToken,
    spender: evidence.spender,
    amount: evidence.exactInputAmount,
    minimumReceive: evidence.minimumReceive,
    nativeValue: '0',
    approvalCalldata: evidence.approval.data,
    attributedApprovalCalldata: evidence.attributedApprovalCalldata,
    dataSuffix: evidence.approval.dataSuffix!,
    builderCode: evidence.builderCode,
    expiresAt: evidence.expiresAt,
    preparationBlockNumber: evidence.preparationBlockNumber,
    snapshotAllowance,
    ...(handoffMessage ? { handoffMessage } : {}),
  };
}

function handoffMatchesPreparation(handoff: {
  id: string; invoiceId: string; preparationId: string; buyer: Address; chainId: number;
  preparationHash: Hex; calldataHash: Hex; handoffStartedAt: string;
}, invoice: Invoice, evidence: MainnetPreparationEvidence): boolean {
  const startedAt = Date.parse(handoff.handoffStartedAt);
  return handoff.invoiceId === invoice.id && handoff.preparationId === evidence.id
    && handoff.chainId === 196 && handoff.buyer.toLowerCase() === evidence.buyer.toLowerCase()
    && handoff.preparationHash === evidence.preparationHash
    && handoff.calldataHash === evidence.attributedSwapCalldataHash
    && Number.isFinite(startedAt) && startedAt >= Date.parse(evidence.preparedAt)
    && startedAt < Date.parse(evidence.expiresAt);
}

function isExactApproval(evidence: MainnetPreparationEvidence, invoice: Invoice, buyer: Address, expectedBuilderCode: string | undefined): boolean {
  const approval = evidence.approval;
  let invoiceAmount: string;
  try { invoiceAmount = parseUnits(invoice.amountUsdt0, 6).toString(); }
  catch { return false; }
  const supportedAsset = mainnetSupportedAssets.find((asset) => asset.key === evidence.quote.assetKey
    && asset.address.toLowerCase() === evidence.inputToken.toLowerCase());
  let requiredInput: bigint;
  try {
    if (!/^\d+$/.test(evidence.exactInputAmount)) return false;
    requiredInput = BigInt(evidence.exactInputAmount);
  } catch { return false; }
  if (!approval.attributedData || !approval.dataSuffix || !approval.builderCode
    || evidence.invoiceId !== invoice.id
    || evidence.buyer.toLowerCase() !== buyer.toLowerCase()
    || evidence.merchant.toLowerCase() !== invoice.merchantAddress.toLowerCase()
    || evidence.chainId !== 196
    || !supportedAsset || evidence.quote.invoiceId !== invoice.id || evidence.quote.chainId !== 196
    || evidence.quote.assetAmount !== evidence.exactInputAmount || evidence.quote.assetKey !== supportedAsset.key
    || evidence.quote.asset.toLowerCase() !== evidence.inputToken.toLowerCase()
    || evidence.quote.buyer.toLowerCase() !== buyer.toLowerCase()
    || evidence.quote.merchant.toLowerCase() !== invoice.merchantAddress.toLowerCase()
    || evidence.outputToken.toLowerCase() !== mainnetAddressConfig.usdt0.toLowerCase()
    || requiredInput <= 0n || requiredInput === MAX_UINT256
    || evidence.stablecoinInvoiceAmount !== invoiceAmount
    || BigInt(evidence.minimumReceive) < BigInt(evidence.stablecoinInvoiceAmount)
    || approval.kind !== 'approval' || approval.chainId !== 196 || approval.value !== 0n
    || approval.from.toLowerCase() !== buyer.toLowerCase()
    || approval.to.toLowerCase() !== evidence.inputToken.toLowerCase()
    || approval.amount !== evidence.exactInputAmount
    || approval.attributedData !== evidence.attributedApprovalCalldata
    || evidence.builderCode !== expectedBuilderCode
    || evidence.builderCode === VERIFIED_TESTNET_BUILDER_CODE
    || approval.dataSuffix !== toMainnetBuilderCodeDataSuffix(evidence.builderCode)
    || evidence.attributedApprovalCalldata !== `${approval.data}${approval.dataSuffix.slice(2)}`) return false;
  try {
    const decoded = decodeFunctionData({ abi: approvalAbi, data: approval.data });
    return decoded.functionName === 'approve'
      && typeof decoded.args[0] === 'string'
      && decoded.args[0].toLowerCase() === evidence.spender.toLowerCase()
      && decoded.args[1] === requiredInput;
  } catch {
    return false;
  }
}

async function sizeExactInInput(
  adapter: OKXDEXMainnetAdapter,
  invoice: Invoice,
  buyerAddress: Address,
  assetKey: MainnetAssetKey,
): Promise<string> {
  const invoiceAmount = parseUnits(invoice.amountUsdt0, 6);
  if (invoiceAmount <= 0n) throw new MainnetPreparationError('Invoice amount must be positive before Mainnet quote sizing.');
  const targetExpected = grossAmountForMinimum(invoiceAmount.toString(), MAINNET_APPROVAL_PROOF_SLIPPAGE_PERCENT);
  const acceptableMaximum = targetExpected + targetExpected / 100n;
  let inputAmount = INITIAL_SIZING_INPUT;

  for (let attempt = 0; attempt < MAINNET_SIZING_MAX_QUOTES; attempt += 1) {
    if (inputAmount <= 0n || inputAmount > MAX_UINT256) {
      throw new MainnetPreparationError('Invoice quote sizing produced an invalid xStock input amount.');
    }
    const quote = await adapter.getSizingQuote({
      assetAmount: inputAmount.toString(), assetKey, buyerAddress, invoice,
      slippagePercent: MAINNET_APPROVAL_PROOF_SLIPPAGE_PERCENT,
    });
    if (!/^\d+$/.test(quote.expectedOutputAmount) || BigInt(quote.expectedOutputAmount) <= 0n
      || !/^\d+$/.test(quote.protectedOutputAmount)) {
      throw new MainnetPreparationError('OKX returned malformed output during bounded invoice sizing.');
    }
    const expectedOutput = BigInt(quote.expectedOutputAmount);
    const protectedOutput = BigInt(quote.protectedOutputAmount);
    if (protectedOutput !== minimumAfterSlippage(quote.expectedOutputAmount, MAINNET_APPROVAL_PROOF_SLIPPAGE_PERCENT)) {
      throw new MainnetPreparationError('OKX sizing quote returned an inconsistent protected output.');
    }
    if (protectedOutput >= invoiceAmount && expectedOutput <= acceptableMaximum) return inputAmount.toString();

    const nextInput = (inputAmount * targetExpected + expectedOutput - 1n) / expectedOutput;
    if (nextInput === inputAmount) {
      if (expectedOutput < targetExpected) inputAmount += 1n;
      else throw new MainnetPreparationError('Invoice sizing could not converge within the bounded exact-in quote budget.');
    } else {
      inputAmount = nextInput;
    }
  }
  throw new MainnetPreparationError(`Could not find an exact-in ${assetKey} amount whose protected output covers this invoice within ${MAINNET_SIZING_MAX_QUOTES} bounded sizing quote requests. No final validation quote or swap preparation was created; refresh later or use a smaller invoice.`);
}

export function createMainnetApprovalPreparationService(dependencies: MainnetApprovalPreparationDependencies = {}): MainnetApprovalPreparationService {
  const createAdapter = dependencies.createAdapter ?? (() => new OKXDEXMainnetAdapter({ apiClient: new OkxDexApiClient() }));
  const createRepository = dependencies.createRepository ?? createMainnetReconciliationRepository;
  const preflight = dependencies.preflight ?? runMainnetPreflight;
  const defaultPaymentService = dependencies.recheckPersistedPreparation ? undefined : createMainnetPaymentService();
  const recheckPersistedPreparation = dependencies.recheckPersistedPreparation
    ?? ((invoice: Invoice, preparationId: string, buyerAddress: Address) => defaultPaymentService!.recheck(
      invoice, preparationId, buyerAddress, undefined, { preflightOnly: true },
    ));
  const now = dependencies.now ?? (() => new Date());

  return async (invoice, buyerAddress, request = {}) => {
    const repository = createRepository();
    const handoff = await repository.getHandoffForInvoice(invoice.id);
    if (handoff) {
      const evidence = await repository.getPreparation(handoff.preparationId);
      if (!evidence || evidence.invoiceId !== invoice.id || evidence.chainId !== 196
        || evidence.buyer.toLowerCase() !== buyerAddress.toLowerCase()
        || !handoffMatchesPreparation(handoff, invoice, evidence)) {
        return { status: 'BLOCKED', reason: 'An existing Mainnet payment handoff cannot be safely recovered for this buyer and invoice.' };
      }
      const submission = await repository.getSubmissionForPreparation(evidence.id);
      if (submission && (submission.invoiceId !== invoice.id || submission.handoffId !== handoff.id
        || submission.chainId !== 196 || !/^0x[0-9a-fA-F]{64}$/.test(submission.transactionHash))) {
        return { status: 'BLOCKED', reason: 'Existing Mainnet submission evidence does not match the invoice handoff.' };
      }
      if (!submission) {
        return {
          status: 'HANDOFF_UNRESOLVED',
          reason: 'Payment status unresolved. This invoice already has its one Mainnet handoff and cannot be retried. Ask the merchant for a new invoice if payment did not complete.',
          existingPayment: { preparationId: evidence.id, handoffId: handoff.id, buyer: evidence.buyer },
        };
      }
      return {
        status: 'SUBMITTED',
        reason: 'An existing Mainnet transaction is awaiting canonical reconciliation. Resume that transaction only.',
        existingPayment: {
          preparationId: evidence.id, handoffId: handoff.id, buyer: evidence.buyer,
          transactionHash: submission.transactionHash,
        },
      };
    }

    const assetKey = request.assetKey ?? 'wNvda';
    if (!mainnetSupportedAssets.some((asset) => asset.key === assetKey)) {
      return { status: 'INVALID_ROUTE', reason: 'Choose one of PortPay’s configured Mainnet xStock assets.' };
    }

    if (request.preparationId) {
      const evidence = await repository.getPreparation(request.preparationId);
      if (!evidence || !isExactApproval(evidence, invoice, buyerAddress, evidence.builderCode)
        || evidence.quote.assetKey !== assetKey || Date.parse(evidence.expiresAt) <= now().getTime()) {
        return { status: 'BLOCKED', reason: 'The existing invoice preparation is missing, stale, or does not match the selected asset and buyer.' };
      }
      const recheck = await recheckPersistedPreparation(invoice, evidence.id, buyerAddress);
      if (recheck.status === 'PREFLIGHT_PASSED' && recheck.ready === false
        && recheck.preparationId === evidence.id && recheck.preparationHash === evidence.preparationHash) {
        return {
          status: 'READY', reason: recheck.reason,
          preparation: approvalPreparationFromEvidence(evidence, evidence.exactInputAmount, mainnetHandoffAuthorizationMessage(evidence)),
        };
      }
      if (recheck.status === 'INSUFFICIENT_ALLOWANCE') {
        return {
          status: 'APPROVAL_REQUIRED', reason: recheck.reason,
          preparation: approvalPreparationFromEvidence(evidence, '0'),
        };
      }
      return { status: recheck.status === 'PREFLIGHT_PASSED' ? 'BLOCKED' : recheck.status, reason: recheck.reason };
    }

    const adapter = createAdapter();
    let assetAmount: string;
    try { assetAmount = await sizeExactInInput(adapter, invoice, buyerAddress, assetKey); }
    catch (error) {
      return { status: 'INVALID_ROUTE', reason: error instanceof Error ? error.message : 'Could not safely size the invoice against the selected asset.' };
    }
    let quote: MainnetQuote;
    let approval: PreparedMainnetTransaction;
    try {
      quote = await adapter.getQuote({
        assetAmount, assetKey, buyerAddress, invoice, slippagePercent: MAINNET_APPROVAL_PROOF_SLIPPAGE_PERCENT,
      });
      approval = await adapter.prepareApprovalTransaction(quote);
    } catch (error) {
      return { status: 'INVALID_ROUTE', reason: error instanceof Error ? error.message : 'The final exact-in quote or approval preparation could not cover this invoice.' };
    }
    const result = await preflight({
      adapter,
      invoice,
      quote,
      approval,
      repository,
      expectedBuilderPayoutAddress: mainnetAddressConfig.builderPayoutAddress,
    });

    const allowanceIsExact = result.balances
      && BigInt(result.balances.allowance) === BigInt(quote.assetAmount);
    const approvalRequired = result.status === 'APPROVAL_REQUIRED' && !result.ready
      && result.simulations?.stage === 'approval'
      && result.simulations.approval === 'passed'
      && result.simulations.swap === 'not-run'
      && !allowanceIsExact;
    const ready = result.status === 'READY' && result.ready
      && result.simulations?.stage === 'swap'
      && result.simulations.approval === 'not-run'
      && result.simulations.swap === 'passed'
      && allowanceIsExact;

    if ((!approvalRequired && !ready)
      || result.builderCode.status !== 'VERIFIED'
      || result.builderCode.chainId !== 196
      || result.builderCode.code !== adapter.getBuilderCode()
      || !result.builderCode.payoutAddress
      || !result.preparationId
      || !result.balances
      || result.balances.assetDecimals !== 18
      || result.balances.stablecoinDecimals !== 6
      || result.balances.assetAddress.toLowerCase() !== quote.asset.toLowerCase()
      || result.balances.stablecoinAddress.toLowerCase() !== mainnetAddressConfig.usdt0.toLowerCase()
      || result.balances.buyerAddress.toLowerCase() !== buyerAddress.toLowerCase()) {
      return result.status === 'READY'
        ? { status: 'BLOCKED', reason: 'READY did not match the exact persisted preparation, buyer, balances, simulations, or Builder Code evidence.' }
        : { status: result.status, reason: result.reason };
    }

    const evidence = await repository.getPreparation(result.preparationId);
    if (!evidence
      || Date.parse(evidence.expiresAt) <= now().getTime()
      || evidence.preparationBlockNumber !== result.balances.snapshotBlockNumber
      || evidence.preparationBlockHash !== result.balances.snapshotBlockHash
      || evidence.spender.toLowerCase() !== result.balances.approvalSpender.toLowerCase()
      || (ready && BigInt(result.balances.allowance) !== BigInt(evidence.exactInputAmount))
      || (!ready && BigInt(result.balances.allowance) === BigInt(evidence.exactInputAmount))
      || result.builderCode.payoutAddress.toLowerCase() !== evidence.builderPayout.toLowerCase()
      || !isExactApproval(evidence, invoice, buyerAddress, adapter.getBuilderCode())) {
      return { status: 'BLOCKED', reason: 'The persisted mainnet approval preparation is missing, stale, or does not match the invoice and buyer.' };
    }

    return {
      status: result.status,
      reason: result.reason,
      preparation: approvalPreparationFromEvidence(
        evidence, result.balances.allowance,
        ready ? mainnetHandoffAuthorizationMessage(evidence) : undefined,
      ),
    };
  };
}
