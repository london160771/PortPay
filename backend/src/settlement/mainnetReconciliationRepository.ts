import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { decodeFunctionData, getAddress, isAddress, keccak256, parseAbi, type Address, type Hex } from 'viem';
import { databaseConfig, isDatabaseConfigured } from '../config/database.js';
import { VERIFIED_TESTNET_BUILDER_CODE } from '../config/xlayerMainnet.js';
import { appendBuilderCodeSuffix, toMainnetBuilderCodeDataSuffix } from './builderCodes.js';
import { isAuthenticatedMainnetSwapPreparation, validateMainnetSwapExecutionEvidence, type MainnetQuote, type PreparedMainnetTransaction } from './mainnet.js';

export type MainnetPreparationEvidence = {
  id: string;
  invoiceId: string;
  quoteId: string;
  buyer: Address;
  merchant: Address;
  chainId: 196;
  inputToken: Address;
  outputToken: Address;
  exactInputAmount: string;
  expectedOutput: string;
  minimumReceive: string;
  routePath: string;
  routeFingerprint: Hex;
  slippagePercent: string;
  previewQuoteHash: Hex;
  preparationHash: Hex;
  authenticatedSwapResponseHash: Hex;
  preparedAt: string;
  router: Address;
  spender: Address;
  attributedApprovalCalldata: Hex;
  attributedApprovalCalldataHash: Hex;
  attributedSwapCalldata: Hex;
  attributedSwapCalldataHash: Hex;
  builderCode: string;
  builderPayout: Address;
  preparationBlockNumber: string;
  preparationBlockHash: Hex;
  expiresAt: string;
  quote: MainnetQuote;
  approval: PreparedMainnetTransaction;
  swap: PreparedMainnetTransaction;
  stablecoinInvoiceAmount: string;
};

export type MainnetBalanceEvidence = {
  beforeBlockNumber: string;
  beforeBlockHash: Hex;
  receiptBlockNumber: string;
  receiptBlockHash: Hex;
  buyerInputBefore: string;
  buyerInputAfter: string;
  merchantOutputBefore: string;
  merchantOutputAfter: string;
  buyerInputDelta: string;
  merchantOutputDelta: string;
};

export type MainnetSettlementClaim = {
  preparationId: string;
  invoiceId: string;
  chainId: 196;
  transactionHash: Hex;
  evidence: {
    buyer: Address;
    merchant: Address;
    inputToken: Address;
    outputToken: Address;
    inputAmount: string;
    outputAmount: string;
    router: Address;
    builderPayout: Address;
    blockNumber: string;
    blockHash: Hex;
    builderCode: string;
    balances: MainnetBalanceEvidence;
  };
};

export interface MainnetReconciliationRepository {
  savePreparation(evidence: MainnetPreparationEvidence): Promise<void>;
  getPreparation(id: string): Promise<MainnetPreparationEvidence | null>;
  /** Atomically claims the invoice and (chain, tx hash). True only for the first claim. */
  claimSettlement(claim: MainnetSettlementClaim): Promise<boolean>;
}

const approvalAbi = [{
  type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }],
}] as const;
const recipientSwapAbi = parseAbi([
  'function dagSwapTo(uint256 orderId, address receiver, (uint256 fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, uint256 deadLine) baseRequest, (address[] mixAdapters, address[] assetTo, uint256[] rawData, bytes[] extraData, uint256 fromToken)[] paths) payable returns (uint256)',
  'function uniswapV3SwapToWithBaseRequest(uint256 orderId, address receiver, (uint256 fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, uint256 deadLine) baseRequest, uint256[] pools) payable returns (uint256)',
  'function unxswapToWithBaseRequest(uint256 orderId, address receiver, (uint256 fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, uint256 deadLine) baseRequest, bytes32[] pools) payable returns (uint256)',
]);

export async function persistMainnetPreparation(options: {
  repository: MainnetReconciliationRepository;
  quote: MainnetQuote;
  approval: PreparedMainnetTransaction;
  swap: PreparedMainnetTransaction;
  builderPayout: string;
  snapshotBlockNumber: bigint;
  snapshotBlockHash: Hex;
}): Promise<MainnetPreparationEvidence> {
  const { quote, approval, swap } = options;
  if (!isAuthenticatedMainnetSwapPreparation(swap)) {
    throw new Error('Only a fresh server-side authenticated OKX V6 /swap preparation can be persisted.');
  }
  if (!approval.attributedData || !swap.attributedData || !approval.builderCode || approval.builderCode !== swap.builderCode
    || swap.execution?.builderCode !== approval.builderCode
    || !/^[a-z0-9]{16}$/.test(approval.builderCode) || approval.builderCode === VERIFIED_TESTNET_BUILDER_CODE) {
    throw new Error('Both exact prepared transactions and a separate valid mainnet Builder Code are required to persist preparation evidence.');
  }
  if (!isAddress(options.builderPayout)) throw new Error('A verified mainnet Builder Code payout is required.');
  const suffix = toMainnetBuilderCodeDataSuffix(approval.builderCode);
  if (!suffix || approval.attributedData !== appendBuilderCodeSuffix(approval.data, suffix)
    || swap.attributedData !== appendBuilderCodeSuffix(swap.data, suffix)) {
    throw new Error('Prepared approval and swap calldata must contain the exact configured mainnet Builder Code suffix.');
  }
  validateMainnetSwapExecutionEvidence(quote, swap);
  const decoded = decodeFunctionData({ abi: approvalAbi, data: approval.attributedData.slice(0, approval.data.length) as Hex });
  if (decoded.functionName !== 'approve' || typeof decoded.args?.[0] !== 'string' || decoded.args[1] !== BigInt(quote.assetAmount)
    || approval.kind !== 'approval' || approval.chainId !== 196 || approval.value !== 0n
    || approval.from.toLowerCase() !== quote.buyer.toLowerCase() || approval.to.toLowerCase() !== quote.asset.toLowerCase()) {
    throw new Error('Prepared exact approval evidence is malformed or not bound to the quote.');
  }
  if (!swap.execution || decoded.args[0].toLowerCase() !== swap.execution.spender.toLowerCase()
    || keccak256(approval.attributedData) !== swap.execution.attributedApprovalCalldataHash) {
    throw new Error('Authenticated swap preparation is not bound to the exact attributed approval and spender.');
  }
  const decodedSwap = decodeFunctionData({ abi: recipientSwapAbi, data: swap.attributedData.slice(0, swap.data.length) as Hex });
  const swapArgs = decodedSwap.args as readonly unknown[];
  const baseRequest = swapArgs[2] as { fromToken: bigint; toToken: Address; fromTokenAmount: bigint; minReturnAmount: bigint } | undefined;
  const packedAsset = baseRequest ? `0x${(baseRequest.fromToken & ((1n << 160n) - 1n)).toString(16).padStart(40, '0')}` : '';
  if (swap.kind !== 'swap' || swap.chainId !== 196 || swap.value !== 0n || swap.from.toLowerCase() !== quote.buyer.toLowerCase()
    || swapArgs[1]?.toString().toLowerCase() !== quote.merchant.toLowerCase()
    || !baseRequest || getAddress(packedAsset) !== getAddress(quote.asset) || baseRequest.toToken.toLowerCase() !== quote.stablecoin.toLowerCase()
    || baseRequest.fromTokenAmount !== BigInt(quote.assetAmount) || baseRequest.minReturnAmount !== BigInt(swap.minReceiveAmount ?? '0')
    || BigInt(swap.minReceiveAmount ?? '0') < BigInt(quote.invoiceStablecoinAmount) || !swap.execution) {
    throw new Error('Prepared exact swap evidence is malformed or not bound to the quote recipient and amounts.');
  }
  const evidence: MainnetPreparationEvidence = {
    id: randomUUID(), invoiceId: quote.invoiceId, quoteId: quote.quoteId ?? `${quote.invoiceId}:${quote.createdAt}`,
    buyer: getAddress(quote.buyer), merchant: getAddress(quote.merchant), chainId: 196,
    inputToken: getAddress(quote.asset), outputToken: getAddress(quote.stablecoin), exactInputAmount: quote.assetAmount,
    expectedOutput: swap.execution.expectedOutputAmount, minimumReceive: swap.execution.minimumReceiveAmount,
    routePath: swap.execution.routePath, routeFingerprint: swap.execution.routeFingerprint,
    slippagePercent: swap.execution.slippagePercent, previewQuoteHash: swap.execution.previewQuoteHash,
    preparationHash: swap.execution.preparationHash, preparedAt: swap.execution.preparedAt,
    authenticatedSwapResponseHash: swap.execution.authenticatedResponseHash,
    router: getAddress(swap.to), spender: getAddress(decoded.args[0]),
    attributedApprovalCalldata: approval.attributedData, attributedApprovalCalldataHash: keccak256(approval.attributedData),
    attributedSwapCalldata: swap.attributedData, attributedSwapCalldataHash: keccak256(swap.attributedData),
    builderCode: approval.builderCode, builderPayout: getAddress(options.builderPayout),
    preparationBlockNumber: options.snapshotBlockNumber.toString(), preparationBlockHash: options.snapshotBlockHash,
    expiresAt: swap.execution.expiresAt, quote: structuredClone(quote), approval: structuredClone(approval), swap: structuredClone(swap),
    stablecoinInvoiceAmount: quote.invoiceStablecoinAmount,
  };
  await options.repository.savePreparation(evidence);
  return evidence;
}

export class SupabaseMainnetReconciliationRepository implements MainnetReconciliationRepository {
  constructor(private readonly client: SupabaseClient) {}

  async savePreparation(evidence: MainnetPreparationEvidence): Promise<void> {
    const jsonEvidence = JSON.parse(JSON.stringify(evidence, (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value)) as Record<string, unknown>;
    const { error } = await this.client.from('mainnet_preparations').insert({
      id: evidence.id,
      invoice_id: evidence.invoiceId,
      quote_id: evidence.quoteId,
      buyer_address: evidence.buyer,
      merchant_address: evidence.merchant,
      chain_id: evidence.chainId,
      input_token: evidence.inputToken,
      output_token: evidence.outputToken,
      exact_input_amount: evidence.exactInputAmount,
      minimum_receive: evidence.minimumReceive,
      router_address: evidence.router,
      spender_address: evidence.spender,
      attributed_approval_calldata: evidence.attributedApprovalCalldata,
      attributed_approval_calldata_hash: evidence.attributedApprovalCalldataHash,
      attributed_swap_calldata: evidence.attributedSwapCalldata,
      attributed_swap_calldata_hash: evidence.attributedSwapCalldataHash,
      builder_code: evidence.builderCode,
      builder_payout_address: evidence.builderPayout,
      preparation_block_number: evidence.preparationBlockNumber,
      preparation_block_hash: evidence.preparationBlockHash,
      expires_at: evidence.expiresAt,
      stablecoin_invoice_amount: evidence.stablecoinInvoiceAmount,
      evidence: jsonEvidence,
    });
    if (error) throw new Error(`Failed to persist immutable mainnet preparation: ${error.message}`);
  }

  async getPreparation(id: string): Promise<MainnetPreparationEvidence | null> {
    const { data, error } = await this.client
      .from('mainnet_preparations')
      .select('evidence')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Failed to load mainnet preparation evidence: ${error.message}`);
    if (!data) return null;
    const stored = data.evidence as MainnetPreparationEvidence & {
      approval: Omit<MainnetPreparationEvidence['approval'], 'value' | 'gas' | 'gasPrice'> & { value: string; gas?: string; gasPrice?: string };
      swap: Omit<MainnetPreparationEvidence['swap'], 'value' | 'gas' | 'gasPrice'> & { value: string; gas?: string; gasPrice?: string };
    };
    const restoreTransaction = (transaction: typeof stored.approval): MainnetPreparationEvidence['approval'] => ({
      ...transaction,
      value: BigInt(transaction.value),
      ...(transaction.gas === undefined ? {} : { gas: BigInt(transaction.gas) }),
      ...(transaction.gasPrice === undefined ? {} : { gasPrice: BigInt(transaction.gasPrice) }),
    });
    return { ...stored, approval: restoreTransaction(stored.approval), swap: restoreTransaction(stored.swap) };
  }

  async claimSettlement(claim: MainnetSettlementClaim): Promise<boolean> {
    const { data, error } = await this.client.rpc('claim_mainnet_settlement', {
      p_preparation_id: claim.preparationId,
      p_invoice_id: claim.invoiceId,
      p_chain_id: claim.chainId,
      p_transaction_hash: claim.transactionHash,
      p_evidence: claim.evidence,
    });
    if (error) throw new Error(`Atomic mainnet settlement claim failed: ${error.message}`);
    return data === true || (typeof data === 'object' && data !== null && 'claimed' in data && data.claimed === true);
  }
}

export function createMainnetReconciliationRepository(): MainnetReconciliationRepository {
  if (!isDatabaseConfigured) throw new Error('Supabase is required for mainnet settlement reconciliation.');
  const client = createClient(databaseConfig.supabaseUrl, databaseConfig.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  return new SupabaseMainnetReconciliationRepository(client);
}

/** Test utility with serialized claims, matching the database uniqueness contract. */
export class InMemoryMainnetReconciliationRepository implements MainnetReconciliationRepository {
  private readonly preparations = new Map<string, MainnetPreparationEvidence>();
  private readonly settlements = new Map<string, MainnetSettlementClaim>();
  private readonly invoices = new Set<string>();
  private readonly transactions = new Set<string>();
  private claimQueue: Promise<void> = Promise.resolve();

  async savePreparation(evidence: MainnetPreparationEvidence): Promise<void> {
    if (this.preparations.has(evidence.id)) throw new Error('Preparation evidence is immutable and cannot be replaced.');
    this.preparations.set(evidence.id, structuredClone(evidence));
  }

  async getPreparation(id: string): Promise<MainnetPreparationEvidence | null> {
    const value = this.preparations.get(id);
    return value ? structuredClone(value) : null;
  }

  async claimSettlement(claim: MainnetSettlementClaim): Promise<boolean> {
    let release!: () => void;
    const previous = this.claimQueue;
    this.claimQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const txKey = `${claim.chainId}:${claim.transactionHash.toLowerCase()}`;
      const preparation = this.preparations.get(claim.preparationId);
      if (!/^0x[0-9a-fA-F]{64}$/.test(claim.transactionHash) || claim.chainId !== 196
        || this.invoices.has(claim.invoiceId) || this.transactions.has(txKey)
        || !preparation || preparation.invoiceId !== claim.invoiceId || preparation.chainId !== claim.chainId) return false;
      this.invoices.add(claim.invoiceId);
      this.transactions.add(txKey);
      this.settlements.set(claim.invoiceId, structuredClone(claim));
      return true;
    } finally {
      release();
    }
  }

  settlementCount(): number { return this.settlements.size; }
}
