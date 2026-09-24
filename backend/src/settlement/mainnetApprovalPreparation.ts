import { decodeFunctionData, parseUnits, type Address, type Hex } from 'viem';
import type { Invoice } from '../invoices/types.js';
import { mainnetAddressConfig, mainnetSupportedAssets, VERIFIED_TESTNET_BUILDER_CODE } from '../config/xlayerMainnet.js';
import { OkxDexApiClient } from './okxDexApi.js';
import {
  MAINNET_MAX_SLIPPAGE_PERCENT,
  OKXDEXMainnetAdapter,
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

export const MAINNET_APPROVAL_PROOF_INPUT = '4800000000000000';
export const MAINNET_APPROVAL_PROOF_SLIPPAGE_PERCENT = MAINNET_MAX_SLIPPAGE_PERCENT;

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
) => Promise<MainnetApprovalPreparationResult>;

export type MainnetApprovalPreparationDependencies = {
  createAdapter?: () => OKXDEXMainnetAdapter;
  createRepository?: () => MainnetReconciliationRepository;
  preflight?: typeof runMainnetPreflight;
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
  if (!approval.attributedData || !approval.dataSuffix || !approval.builderCode
    || evidence.invoiceId !== invoice.id
    || evidence.buyer.toLowerCase() !== buyer.toLowerCase()
    || evidence.merchant.toLowerCase() !== invoice.merchantAddress.toLowerCase()
    || evidence.chainId !== 196
    || evidence.inputToken.toLowerCase() !== mainnetSupportedAssets.find((asset) => asset.key === 'wNvda')?.address.toLowerCase()
    || evidence.outputToken.toLowerCase() !== mainnetAddressConfig.usdt0.toLowerCase()
    || evidence.exactInputAmount !== MAINNET_APPROVAL_PROOF_INPUT
    || evidence.stablecoinInvoiceAmount !== invoiceAmount
    || BigInt(evidence.minimumReceive) < BigInt(evidence.stablecoinInvoiceAmount)
    || approval.kind !== 'approval' || approval.chainId !== 196 || approval.value !== 0n
    || approval.from.toLowerCase() !== buyer.toLowerCase()
    || approval.to.toLowerCase() !== evidence.inputToken.toLowerCase()
    || approval.amount !== MAINNET_APPROVAL_PROOF_INPUT
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
      && decoded.args[1] === BigInt(MAINNET_APPROVAL_PROOF_INPUT);
  } catch {
    return false;
  }
}

export function createMainnetApprovalPreparationService(dependencies: MainnetApprovalPreparationDependencies = {}): MainnetApprovalPreparationService {
  const createAdapter = dependencies.createAdapter ?? (() => new OKXDEXMainnetAdapter({ apiClient: new OkxDexApiClient() }));
  const createRepository = dependencies.createRepository ?? createMainnetReconciliationRepository;
  const preflight = dependencies.preflight ?? runMainnetPreflight;
  const now = dependencies.now ?? (() => new Date());

  return async (invoice, buyerAddress) => {
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
    const adapter = createAdapter();
    const quote: MainnetQuote = await adapter.getQuote({
      assetAmount: MAINNET_APPROVAL_PROOF_INPUT,
      assetKey: 'wNvda',
      buyerAddress,
      invoice,
      slippagePercent: MAINNET_APPROVAL_PROOF_SLIPPAGE_PERCENT,
    });
    const approval: PreparedMainnetTransaction = await adapter.prepareApprovalTransaction(quote);
    const result = await preflight({
      adapter,
      invoice,
      quote,
      approval,
      repository,
      expectedBuilderPayoutAddress: mainnetAddressConfig.builderPayoutAddress,
    });

    const allowanceIsExact = result.balances
      && BigInt(result.balances.allowance) === BigInt(MAINNET_APPROVAL_PROOF_INPUT);
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
      || result.balances.assetAddress.toLowerCase() !== mainnetSupportedAssets.find((asset) => asset.key === 'wNvda')?.address.toLowerCase()
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
