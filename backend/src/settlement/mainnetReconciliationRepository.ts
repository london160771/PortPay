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
  inputConsumptionMode: 'exact-in-max-debit-net-observed';
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

/** Server-recorded wallet handoff authorization; the exact transaction may only be observed later. */
export type MainnetHandoffEvidence = {
  id: string;
  preparationId: string;
  invoiceId: string;
  buyer: Address;
  chainId: 196;
  preparationHash: Hex;
  calldataHash: Hex;
  handoffStartedAt: string;
};

export type MainnetSubmissionEvidence = {
  preparationId: string;
  handoffId: string;
  invoiceId: string;
  chainId: 196;
  transactionHash: Hex;
  submittedAt: string;
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
    maxInputAmount: string;
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
  createHandoff(evidence: Omit<MainnetHandoffEvidence, 'id' | 'handoffStartedAt'>): Promise<MainnetHandoffEvidence | null>;
  getHandoff(id: string): Promise<MainnetHandoffEvidence | null>;
  getHandoffForInvoice(invoiceId: string): Promise<MainnetHandoffEvidence | null>;
  recordSubmission(evidence: Omit<MainnetSubmissionEvidence, 'submittedAt'>): Promise<MainnetSubmissionEvidence | null>;
  getSubmission(preparationId: string, transactionHash: Hex): Promise<MainnetSubmissionEvidence | null>;
  getSubmissionForPreparation(preparationId: string): Promise<MainnetSubmissionEvidence | null>;
  /** Atomically persists settlement and invoice-paid evidence. Exact retries return already_paid. */
  claimSettlement(claim: MainnetSettlementClaim): Promise<'claimed' | 'already_paid' | false>;
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
    inputConsumptionMode: swap.execution.inputConsumptionMode,
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

  async recordSubmission(evidence: Omit<MainnetSubmissionEvidence, 'submittedAt'>): Promise<MainnetSubmissionEvidence | null> {
    const { data, error } = await this.client.from('mainnet_submissions').insert({
      preparation_id: evidence.preparationId,
      handoff_id: evidence.handoffId,
      invoice_id: evidence.invoiceId,
      chain_id: evidence.chainId,
      transaction_hash: evidence.transactionHash.toLowerCase(),
    }).select('preparation_id,handoff_id,invoice_id,chain_id,transaction_hash,submitted_at').maybeSingle();
    if (!error && data) return mapMainnetSubmission(data);
    if (!error || error.code !== '23505') throw new Error(`Failed to record mainnet submission evidence: ${error?.message ?? 'no row returned'}`);

    // A retry of the same notification is idempotent; uniqueness conflicts with any other
    // preparation, invoice, or transaction remain rejected.
    const existing = await this.client.from('mainnet_submissions')
      .select('preparation_id,handoff_id,invoice_id,chain_id,transaction_hash,submitted_at')
      .eq('preparation_id', evidence.preparationId)
      .maybeSingle();
    if (existing.error) throw new Error(`Failed to read mainnet submission evidence: ${existing.error.message}`);
    if (!existing.data || existing.data.invoice_id !== evidence.invoiceId || existing.data.handoff_id !== evidence.handoffId
      || existing.data.chain_id !== 196 || String(existing.data.transaction_hash).toLowerCase() !== evidence.transactionHash.toLowerCase()) return null;
    return mapMainnetSubmission(existing.data);
  }

  async createHandoff(evidence: Omit<MainnetHandoffEvidence, 'id' | 'handoffStartedAt'>): Promise<MainnetHandoffEvidence | null> {
    const { data, error } = await this.client.from('mainnet_handoffs').insert({
      // Retain deterministic IDs; invoice_id also has its own database uniqueness rule.
      id: evidence.invoiceId,
      preparation_id: evidence.preparationId,
      invoice_id: evidence.invoiceId,
      buyer_address: evidence.buyer,
      chain_id: evidence.chainId,
      preparation_hash: evidence.preparationHash,
      calldata_hash: evidence.calldataHash,
    }).select('id,preparation_id,invoice_id,buyer_address,chain_id,preparation_hash,calldata_hash,handoff_started_at').single();
    if (error || !data) {
      if (error?.code === '23505') return null;
      if (error?.code === '23514') return null;
      throw new Error(`Failed to persist mainnet wallet handoff authorization: ${error?.message ?? 'no row returned'}`);
    }
    return mapMainnetHandoff(data);
  }

  async getHandoff(id: string): Promise<MainnetHandoffEvidence | null> {
    const { data, error } = await this.client.from('mainnet_handoffs')
      .select('id,preparation_id,invoice_id,buyer_address,chain_id,preparation_hash,calldata_hash,handoff_started_at')
      .eq('id', id).maybeSingle();
    if (error) throw new Error(`Failed to load mainnet handoff authorization: ${error.message}`);
    return data ? mapMainnetHandoff(data) : null;
  }

  async getHandoffForInvoice(invoiceId: string): Promise<MainnetHandoffEvidence | null> {
    const { data, error } = await this.client.from('mainnet_handoffs')
      .select('id,preparation_id,invoice_id,buyer_address,chain_id,preparation_hash,calldata_hash,handoff_started_at')
      .eq('invoice_id', invoiceId).maybeSingle();
    if (error) throw new Error(`Failed to load invoice mainnet handoff: ${error.message}`);
    return data ? mapMainnetHandoff(data) : null;
  }

  async getSubmission(preparationId: string, transactionHash: Hex): Promise<MainnetSubmissionEvidence | null> {
    const { data, error } = await this.client.from('mainnet_submissions')
      .select('preparation_id,handoff_id,invoice_id,chain_id,transaction_hash,submitted_at')
      .eq('preparation_id', preparationId)
      .eq('transaction_hash', transactionHash.toLowerCase())
      .maybeSingle();
    if (error) throw new Error(`Failed to load mainnet submission evidence: ${error.message}`);
    if (!data) return null;
    return mapMainnetSubmission(data);
  }

  async getSubmissionForPreparation(preparationId: string): Promise<MainnetSubmissionEvidence | null> {
    const { data, error } = await this.client.from('mainnet_submissions')
      .select('preparation_id,handoff_id,invoice_id,chain_id,transaction_hash,submitted_at')
      .eq('preparation_id', preparationId)
      .maybeSingle();
    if (error) throw new Error(`Failed to recover mainnet submission evidence: ${error.message}`);
    return data ? mapMainnetSubmission(data) : null;
  }

  async claimSettlement(claim: MainnetSettlementClaim): Promise<'claimed' | 'already_paid' | false> {
    const { data, error } = await this.client.rpc('finalize_mainnet_settlement', {
      p_preparation_id: claim.preparationId,
      p_invoice_id: claim.invoiceId,
      p_chain_id: claim.chainId,
      p_transaction_hash: claim.transactionHash,
      p_evidence: claim.evidence,
    });
    if (error) throw new Error(`Atomic mainnet settlement/invoice update failed: ${error.message}`);
    if (data === 'claimed' || data === 'already_paid') return data;
    return false;
  }
}

function mapMainnetHandoff(data: Record<string, unknown>): MainnetHandoffEvidence {
  if (data.chain_id !== 196 || typeof data.handoff_started_at !== 'string') throw new Error('Stored mainnet handoff evidence is malformed.');
  return {
    id: String(data.id), preparationId: String(data.preparation_id), invoiceId: String(data.invoice_id),
    buyer: String(data.buyer_address) as Address, chainId: 196,
    preparationHash: String(data.preparation_hash) as Hex, calldataHash: String(data.calldata_hash) as Hex,
    handoffStartedAt: data.handoff_started_at,
  };
}

function mapMainnetSubmission(data: Record<string, unknown>): MainnetSubmissionEvidence {
  if (data.chain_id !== 196 || typeof data.submitted_at !== 'string' || typeof data.handoff_id !== 'string') {
    throw new Error('Stored mainnet submission evidence is malformed.');
  }
  return {
    preparationId: String(data.preparation_id), handoffId: data.handoff_id,
    invoiceId: String(data.invoice_id), chainId: 196,
    transactionHash: String(data.transaction_hash) as Hex, submittedAt: data.submitted_at,
  };
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
  private readonly submissions = new Map<string, MainnetSubmissionEvidence>();
  private readonly handoffs = new Map<string, MainnetHandoffEvidence>();
  private readonly submittedTransactions = new Set<string>();
  private readonly submittedInvoices = new Set<string>();
  private readonly settlements = new Map<string, MainnetSettlementClaim>();
  private readonly invoices = new Set<string>();
  private readonly transactions = new Set<string>();
  private claimQueue: Promise<void> = Promise.resolve();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async savePreparation(evidence: MainnetPreparationEvidence): Promise<void> {
    if (this.preparations.has(evidence.id)) throw new Error('Preparation evidence is immutable and cannot be replaced.');
    this.preparations.set(evidence.id, structuredClone(evidence));
  }

  async getPreparation(id: string): Promise<MainnetPreparationEvidence | null> {
    const value = this.preparations.get(id);
    return value ? structuredClone(value) : null;
  }

  async createHandoff(evidence: Omit<MainnetHandoffEvidence, 'id' | 'handoffStartedAt'>): Promise<MainnetHandoffEvidence | null> {
    if ([...this.handoffs.values()].some((handoff) => handoff.invoiceId === evidence.invoiceId)) return null;
    const preparation = this.preparations.get(evidence.preparationId);
    const startedAt = this.now().toISOString();
    const startedMs = Date.parse(startedAt);
    if (!preparation || preparation.invoiceId !== evidence.invoiceId || preparation.chainId !== 196
      || evidence.chainId !== 196 || preparation.buyer.toLowerCase() !== evidence.buyer.toLowerCase()
      || preparation.preparationHash !== evidence.preparationHash
      || preparation.attributedSwapCalldataHash !== evidence.calldataHash
      || !Number.isFinite(startedMs) || startedMs < Date.parse(preparation.preparedAt)
      || startedMs >= Date.parse(preparation.expiresAt)) return null;
    const handoff: MainnetHandoffEvidence = { ...structuredClone(evidence), id: evidence.invoiceId, handoffStartedAt: startedAt };
    this.handoffs.set(handoff.id, handoff);
    return structuredClone(handoff);
  }

  async getHandoff(id: string): Promise<MainnetHandoffEvidence | null> {
    const value = this.handoffs.get(id);
    return value ? structuredClone(value) : null;
  }

  async getHandoffForInvoice(invoiceId: string): Promise<MainnetHandoffEvidence | null> {
    const value = [...this.handoffs.values()].find((handoff) => handoff.invoiceId === invoiceId);
    return value ? structuredClone(value) : null;
  }

  async recordSubmission(evidence: Omit<MainnetSubmissionEvidence, 'submittedAt'>): Promise<MainnetSubmissionEvidence | null> {
    const existing = this.submissions.get(evidence.preparationId);
    if (existing) return existing.invoiceId === evidence.invoiceId
      && existing.handoffId === evidence.handoffId
      && existing.transactionHash.toLowerCase() === evidence.transactionHash.toLowerCase() ? structuredClone(existing) : null;
    const txKey = `${evidence.chainId}:${evidence.transactionHash.toLowerCase()}`;
    const preparation = this.preparations.get(evidence.preparationId);
    const submittedAtIso = this.now().toISOString();
    const submittedAt = Date.parse(submittedAtIso);
    const handoff = this.handoffs.get(evidence.handoffId);
    if (evidence.chainId !== 196 || !preparation || preparation.invoiceId !== evidence.invoiceId
      || !handoff || handoff.preparationId !== evidence.preparationId || handoff.invoiceId !== evidence.invoiceId
      || handoff.chainId !== 196 || handoff.buyer.toLowerCase() !== preparation.buyer.toLowerCase()
      || handoff.preparationHash !== preparation.preparationHash || handoff.calldataHash !== preparation.attributedSwapCalldataHash
      || !Number.isFinite(submittedAt) || submittedAt < Date.parse(handoff.handoffStartedAt)
      || this.submittedInvoices.has(evidence.invoiceId) || this.submittedTransactions.has(txKey)) return null;
    const submission: MainnetSubmissionEvidence = { ...structuredClone(evidence), submittedAt: submittedAtIso };
    this.submissions.set(evidence.preparationId, submission);
    this.submittedInvoices.add(evidence.invoiceId);
    this.submittedTransactions.add(txKey);
    return structuredClone(submission);
  }

  async getSubmission(preparationId: string, transactionHash: Hex): Promise<MainnetSubmissionEvidence | null> {
    const value = this.submissions.get(preparationId);
    return value && value.transactionHash.toLowerCase() === transactionHash.toLowerCase() ? structuredClone(value) : null;
  }

  async getSubmissionForPreparation(preparationId: string): Promise<MainnetSubmissionEvidence | null> {
    const value = this.submissions.get(preparationId);
    return value ? structuredClone(value) : null;
  }

  async claimSettlement(claim: MainnetSettlementClaim): Promise<'claimed' | 'already_paid' | false> {
    let release!: () => void;
    const previous = this.claimQueue;
    this.claimQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const txKey = `${claim.chainId}:${claim.transactionHash.toLowerCase()}`;
      const preparation = this.preparations.get(claim.preparationId);
      if (!/^0x[0-9a-fA-F]{64}$/.test(claim.transactionHash) || claim.chainId !== 196
        || !preparation || preparation.invoiceId !== claim.invoiceId || preparation.chainId !== claim.chainId) return false;
      const prior = this.settlements.get(claim.invoiceId);
      if (prior) return prior.preparationId === claim.preparationId
        && prior.transactionHash.toLowerCase() === claim.transactionHash.toLowerCase()
        && JSON.stringify(prior.evidence) === JSON.stringify(claim.evidence) ? 'already_paid' : false;
      if (this.invoices.has(claim.invoiceId) || this.transactions.has(txKey)) return false;
      this.invoices.add(claim.invoiceId);
      this.transactions.add(txKey);
      this.settlements.set(claim.invoiceId, structuredClone(claim));
      return 'claimed';
    } finally {
      release();
    }
  }

  settlementCount(): number { return this.settlements.size; }
}
