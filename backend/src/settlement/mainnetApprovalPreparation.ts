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
};

export type MainnetApprovalPreparationResult = {
  status: MainnetPreflightResult['status'];
  reason: string;
  preparation?: MainnetApprovalPreparation;
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
    const adapter = createAdapter();
    const repository = createRepository();
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

    if (result.status !== 'APPROVAL_REQUIRED'
      || result.simulations?.stage !== 'approval'
      || result.simulations.approval !== 'passed'
      || result.simulations.swap !== 'not-run'
      || result.builderCode.status !== 'VERIFIED'
      || !result.preparationId
      || !result.balances
      || BigInt(result.balances.allowance) === BigInt(MAINNET_APPROVAL_PROOF_INPUT)
      || result.balances.assetDecimals !== 18
      || result.balances.stablecoinDecimals !== 6
      || result.balances.assetAddress.toLowerCase() !== mainnetSupportedAssets.find((asset) => asset.key === 'wNvda')?.address.toLowerCase()
      || result.balances.stablecoinAddress.toLowerCase() !== mainnetAddressConfig.usdt0.toLowerCase()
      || result.balances.buyerAddress.toLowerCase() !== buyerAddress.toLowerCase()) {
      return { status: result.status, reason: result.reason };
    }

    const evidence = await repository.getPreparation(result.preparationId);
    if (!evidence
      || Date.parse(evidence.expiresAt) <= now().getTime()
      || evidence.preparationBlockNumber !== result.balances.snapshotBlockNumber
      || evidence.preparationBlockHash !== result.balances.snapshotBlockHash
      || evidence.spender.toLowerCase() !== result.balances.approvalSpender.toLowerCase()
      || result.balances.allowance === evidence.exactInputAmount
      || !isExactApproval(evidence, invoice, buyerAddress, adapter.getBuilderCode())) {
      return { status: 'BLOCKED', reason: 'The persisted mainnet approval preparation is missing, stale, or does not match the invoice and buyer.' };
    }

    return {
      status: result.status,
      reason: result.reason,
      preparation: {
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
        snapshotAllowance: result.balances.allowance,
      },
    };
  };
}
