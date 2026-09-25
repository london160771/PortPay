import { Attribution } from 'ox/erc8021';
import { decodeEventLog, decodeFunctionData, getAddress, isAddress, keccak256, parseAbi, parseUnits, type Address, type Hex } from 'viem';
import type { Invoice } from '../invoices/types.js';
import { mainnetAddressConfig, VERIFIED_MAINNET_BUILDER_CODE_REGISTRY_ADDRESS, VERIFIED_MAINNET_USDT0_ADDRESS, VERIFIED_TESTNET_BUILDER_CODE } from '../config/xlayerMainnet.js';
import { verifyMainnetBuilderCode, type MainnetBuilderCodeCheck } from './mainnetBuilderCodes.js';
import { erc20ReadAbi, type MainnetReadOnlyClient } from './mainnetPreflight.js';
import { validateMainnetSwapExecutionEvidence } from './mainnet.js';
import type {
  MainnetBalanceEvidence,
  MainnetPreparationEvidence,
  MainnetReconciliationRepository,
} from './mainnetReconciliationRepository.js';

const transferAbi = [{
  type: 'event', name: 'Transfer', anonymous: false,
  inputs: [{ indexed: true, name: 'from', type: 'address' }, { indexed: true, name: 'to', type: 'address' }, { indexed: false, name: 'value', type: 'uint256' }],
}] as const;
const approvalAbi = [{
  type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }],
}] as const;
const mainnetSwapAbi = parseAbi([
  'function dagSwapTo(uint256 orderId, address receiver, (uint256 fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, uint256 deadLine) baseRequest, (address[] mixAdapters, address[] assetTo, uint256[] rawData, bytes[] extraData, uint256 fromToken)[] paths) payable returns (uint256)',
  'function uniswapV3SwapToWithBaseRequest(uint256 orderId, address receiver, (uint256 fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, uint256 deadLine) baseRequest, uint256[] pools) payable returns (uint256)',
  'function unxswapToWithBaseRequest(uint256 orderId, address receiver, (uint256 fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, uint256 deadLine) baseRequest, bytes32[] pools) payable returns (uint256)',
]);
const DEFAULT_MAINNET_CONFIRMATION_DEPTH = 2;

export type MainnetReceiptLog = { address: Address; data: Hex; topics: readonly Hex[] };
export type MainnetTransactionReceipt = {
  status: 'success' | 'reverted'; to: Address | null; from: Address; blockNumber: bigint; blockHash: Hex | null; logs: readonly MainnetReceiptLog[];
};
export type MainnetTransaction = { from: Address; to: Address | null; input: Hex; value: bigint };
export type MainnetReceiptClient = Pick<MainnetReadOnlyClient, 'getChainId' | 'readContract' | 'getBlockNumber'> & {
  getTransactionReceipt(args: { hash: Hex }): Promise<MainnetTransactionReceipt>;
  getTransaction(args: { hash: Hex }): Promise<MainnetTransaction>;
  getBlock(args: { blockNumber: bigint }): Promise<{ number: bigint | null; hash: Hex | null; parentHash: Hex | null; timestamp: bigint }>;
};

export type MainnetReceiptVerification = {
  status: 'paid'; invoiceId: string; paymentTxHash: Hex; buyer: Address; merchant: Address;
  spentAsset: Address; spentAmount: string; stablecoin: Address; stablecoinReceived: string;
  router: Address; blockNumber: string; blockHash: Hex; confirmationDepth: number;
  builderCode: string; builderCodeCheck: MainnetBuilderCodeCheck; canonical: true; balanceEvidence: MainnetBalanceEvidence;
  claimDisposition: 'claimed' | 'already_paid';
};

export type MainnetReceiptVerifierOptions = {
  publicClient: MainnetReceiptClient;
  repository: MainnetReconciliationRepository;
  preparationId: string;
  invoice: Invoice;
  txHash: Hex;
  configuredMainnetBuilderCode?: string;
  expectedBuilderPayoutAddress?: string;
  confirmationDepth?: number;
  verifyBuilderCode?: (options: { code: string; expectedPayoutAddress?: string }) => Promise<MainnetBuilderCodeCheck>;
};

export class MainnetReceiptVerificationError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'MainnetReceiptVerificationError'; }
}

function fail(code: string, message: string): never { throw new MainnetReceiptVerificationError(code, message); }
function sameAddress(left: string, right: string): boolean { return left.toLowerCase() === right.toLowerCase(); }
function sameHex(left: string, right: string): boolean { return left.toLowerCase() === right.toLowerCase(); }
function normalizeAddress(value: string, label: string): Address {
  if (!isAddress(value)) return fail('INVALID_RECEIPT', `${label} is not a valid EVM address.`);
  return getAddress(value);
}
function exactUint(value: unknown, label: string): bigint {
  if (typeof value !== 'bigint' || value < 0n) return fail('INVALID_BALANCE_EVIDENCE', `${label} was not a non-negative bigint RPC value.`);
  return value;
}
function positiveStoredInteger(value: string, label: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) return fail('INVALID_PREPARATION', `${label} must be an exact positive base-unit integer.`);
  return BigInt(value);
}
function packedTokenAddress(value: bigint): Address {
  return getAddress(`0x${(value & ((1n << 160n) - 1n)).toString(16).padStart(40, '0')}`);
}
function permittedBuyerInputRecipients(evidence: MainnetPreparationEvidence, asset: Address, router: Address): Set<string> {
  const recipients = new Set([router.toLowerCase()]);
  let decoded: ReturnType<typeof decodeFunctionData<typeof mainnetSwapAbi>>;
  try {
    decoded = decodeFunctionData({ abi: mainnetSwapAbi, data: evidence.swap.data });
  } catch {
    return fail('INVALID_PREPARATION', 'Persisted swap calldata cannot be decoded to identify its input route.');
  }
  if (decoded.functionName !== 'dagSwapTo') return recipients;

  const baseRequest = decoded.args[2];
  const firstPath = decoded.args[3][0];
  if (!firstPath || !sameAddress(packedTokenAddress(baseRequest.fromToken), asset)
    || !sameAddress(packedTokenAddress(firstPath.fromToken), asset)
    || firstPath.mixAdapters.length !== 1 || firstPath.assetTo.length !== 1
    || !sameAddress(firstPath.mixAdapters[0], firstPath.assetTo[0])) {
    return fail('INVALID_PREPARATION', 'The first input route recipient is ambiguous or does not match the prepared input token.');
  }
  recipients.add(normalizeAddress(firstPath.assetTo[0], 'Prepared first-hop adapter').toLowerCase());
  return recipients;
}
function transferFromLog(log: MainnetReceiptLog, token: Address): { from: Address; to: Address; value: bigint } | undefined {
  if (!sameAddress(log.address, token)) return undefined;
  try {
    const decoded = decodeEventLog({ abi: transferAbi, data: log.data, topics: log.topics as [] | [Hex, ...Hex[]] });
    if (decoded.eventName !== 'Transfer') return undefined;
    return decoded.args as unknown as { from: Address; to: Address; value: bigint };
  } catch { return undefined; }
}
function confirmationDepth(value: number | undefined): number {
  const configured = value ?? Number(process.env.MAINNET_CONFIRMATION_DEPTH || DEFAULT_MAINNET_CONFIRMATION_DEPTH);
  if (!Number.isInteger(configured) || configured < 1 || configured > 64) fail('INVALID_RECEIPT', 'MAINNET_CONFIRMATION_DEPTH must be between 1 and 64.');
  return configured;
}

export function validatePersistedMainnetPreparation(evidence: MainnetPreparationEvidence, invoice: Invoice): {
  buyer: Address; merchant: Address; asset: Address; stablecoin: Address; router: Address; input: bigint; minimumOutput: bigint; invoiceOutput: bigint;
} {
  if (invoice.paymentNetwork !== 'x-layer-mainnet' || evidence.chainId !== 196 || evidence.invoiceId !== invoice.id || evidence.quote.invoiceId !== invoice.id) fail('INVALID_PREPARATION', 'Persisted preparation is not bound to a chain-196 invoice.');
  const buyer = normalizeAddress(evidence.buyer, 'Persisted buyer');
  const merchant = normalizeAddress(evidence.merchant, 'Persisted merchant');
  const asset = normalizeAddress(evidence.inputToken, 'Persisted input token');
  const stablecoin = normalizeAddress(evidence.outputToken, 'Persisted output token');
  const router = normalizeAddress(evidence.router, 'Persisted router');
  const input = positiveStoredInteger(evidence.exactInputAmount, 'Prepared input amount');
  const minimumOutput = positiveStoredInteger(evidence.minimumReceive, 'Prepared minimum receive');
  const invoiceOutput = positiveStoredInteger(evidence.stablecoinInvoiceAmount, 'Invoice stablecoin amount');
  const expectedInvoiceOutput = parseUnits(invoice.amountUsdt0, 6);
  const expiresAt = Date.parse(evidence.expiresAt);
  let approvalFunction: ReturnType<typeof decodeFunctionData<typeof approvalAbi>>;
  try {
    approvalFunction = decodeFunctionData({ abi: approvalAbi, data: evidence.attributedApprovalCalldata.slice(0, evidence.approval.data.length) as Hex });
  } catch { return fail('INVALID_PREPARATION', 'Persisted approval calldata cannot be decoded.'); }
  let approvalCodes: readonly string[] = [];
  try { approvalCodes = Attribution.fromData(evidence.attributedApprovalCalldata)?.codes ?? []; }
  catch { return fail('INVALID_ATTRIBUTION', 'Persisted approval attribution is malformed.'); }
  const approval = evidence.approval;
  const swap = evidence.swap;
  try { validateMainnetSwapExecutionEvidence(evidence.quote, swap); }
  catch { return fail('INVALID_PREPARATION', 'Persisted final swap preparation binding is invalid.'); }
  const execution = swap.execution;
  if (!sameAddress(merchant, invoice.merchantAddress) || !sameAddress(evidence.quote.merchant, merchant)
    || !sameAddress(evidence.quote.buyer, buyer) || !sameAddress(evidence.quote.asset, asset)
    || !sameAddress(evidence.quote.stablecoin, stablecoin) || evidence.quote.assetAmount !== evidence.exactInputAmount
    || evidence.quote.invoiceStablecoinAmount !== evidence.stablecoinInvoiceAmount
    || !execution || execution.invoiceId !== invoice.id || execution.chainId !== 196
    || !sameAddress(execution.buyer, buyer) || !sameAddress(execution.merchant, merchant)
    || !sameAddress(execution.inputToken, asset) || !sameAddress(execution.outputToken, stablecoin)
    || execution.exactInputAmount !== evidence.exactInputAmount || execution.inputConsumptionMode !== evidence.inputConsumptionMode
    || evidence.inputConsumptionMode !== 'exact-in-max-debit-net-observed' || execution.expectedOutputAmount !== evidence.expectedOutput
    || execution.authenticatedResponseHash !== evidence.authenticatedSwapResponseHash
    || execution.spender.toLowerCase() !== evidence.spender.toLowerCase()
    || execution.attributedApprovalCalldataHash !== evidence.attributedApprovalCalldataHash
    || execution.minimumReceiveAmount !== evidence.minimumReceive || execution.routePath !== evidence.routePath
    || execution.routeFingerprint !== evidence.routeFingerprint || execution.slippagePercent !== evidence.slippagePercent
    || execution.previewQuoteHash !== evidence.previewQuoteHash || execution.preparationHash !== evidence.preparationHash
    || execution.preparedAt !== evidence.preparedAt || execution.expiresAt !== evidence.expiresAt
    || execution.builderCode !== evidence.builderCode
    || !sameAddress(execution.router, router)
    || !Number.isFinite(expiresAt) || invoiceOutput !== expectedInvoiceOutput
    || !sameAddress(swap.to, router) || !sameAddress(swap.from, buyer) || swap.value !== 0n || swap.kind !== 'swap'
    || approval.kind !== 'approval' || !sameAddress(approval.from, buyer) || approval.chainId !== 196
    || !sameAddress(approval.to, asset) || approval.value !== 0n
    || evidence.attributedApprovalCalldata.slice(0, approval.data.length) !== approval.data
    || approvalFunction.functionName !== 'approve' || typeof approvalFunction.args?.[0] !== 'string'
    || !sameAddress(approvalFunction.args[0], evidence.spender) || approvalFunction.args[1] !== input
    || approvalCodes.length !== 1 || approvalCodes[0] !== evidence.builderCode
    || approval.attributedData !== evidence.attributedApprovalCalldata || swap.attributedData !== evidence.attributedSwapCalldata
    || approval.builderCode !== evidence.builderCode || swap.builderCode !== evidence.builderCode
    || keccak256(evidence.attributedApprovalCalldata) !== evidence.attributedApprovalCalldataHash
    || keccak256(evidence.attributedSwapCalldata) !== evidence.attributedSwapCalldataHash
    || !sameAddress(stablecoin, VERIFIED_MAINNET_USDT0_ADDRESS)
    || !sameAddress(mainnetAddressConfig.usdt0, VERIFIED_MAINNET_USDT0_ADDRESS)) {
    fail('INVALID_PREPARATION', 'Persisted quote, approval, swap, amounts, or network configuration do not agree.');
  }
  return { buyer, merchant, asset, stablecoin, router, input, minimumOutput, invoiceOutput };
}

export async function verifyMainnetReceipt(options: MainnetReceiptVerifierOptions): Promise<MainnetReceiptVerification> {
  const { invoice, publicClient, repository, txHash } = options;
  const evidence = await repository.getPreparation(options.preparationId);
  if (!evidence) fail('INVALID_PREPARATION', 'Immutable persisted mainnet preparation evidence was not found.');
  const exactPaidRetry = invoice.status === 'paid'
    && invoice.paymentNetwork === 'x-layer-mainnet'
    && invoice.paymentTxHash?.toLowerCase() === txHash.toLowerCase();
  if (invoice.status !== 'pending' && !exactPaidRetry) fail('DUPLICATE_SETTLEMENT', 'The invoice is already paid on another network/by another transaction or no longer payable.');
  const { buyer, merchant, asset, stablecoin, router, input: expectedInput, minimumOutput, invoiceOutput } = validatePersistedMainnetPreparation(evidence, invoice);
  const submission = await repository.getSubmission(evidence.id, options.txHash);
  const handoff = submission ? await repository.getHandoff(submission.handoffId) : null;
  const preparedAtMs = Date.parse(evidence.preparedAt);
  const expiresAtMs = Date.parse(evidence.expiresAt);
  const submittedAtMs = submission ? Date.parse(submission.submittedAt) : Number.NaN;
  if (!submission || !handoff || submission.handoffId !== handoff.id || handoff.preparationId !== evidence.id
    || handoff.invoiceId !== invoice.id || handoff.chainId !== 196 || handoff.buyer.toLowerCase() !== evidence.buyer.toLowerCase()
    || handoff.preparationHash !== evidence.preparationHash || handoff.calldataHash !== evidence.attributedSwapCalldataHash
    || Date.parse(handoff.handoffStartedAt) < preparedAtMs || Date.parse(handoff.handoffStartedAt) >= expiresAtMs
    || submission.invoiceId !== invoice.id || submission.chainId !== 196
    || submission.transactionHash.toLowerCase() !== options.txHash.toLowerCase()
    || !Number.isFinite(preparedAtMs) || !Number.isFinite(expiresAtMs) || !Number.isFinite(submittedAtMs)
    || submittedAtMs < Date.parse(handoff.handoffStartedAt)) {
    fail('INVALID_SUBMISSION', 'A server-recorded exact transaction linked to a valid pre-expiry wallet handoff is required.');
  }
  const configuredCode = (options.configuredMainnetBuilderCode ?? mainnetAddressConfig.builderCode).trim();
  const expectedPayout = (options.expectedBuilderPayoutAddress ?? mainnetAddressConfig.builderPayoutAddress).trim();
  if (!configuredCode || configuredCode !== evidence.builderCode || configuredCode === VERIFIED_TESTNET_BUILDER_CODE) fail('INVALID_ATTRIBUTION', 'Configured mainnet Builder Code must exactly match the persisted preparation and must not be the testnet code.');
  if (!expectedPayout || !isAddress(expectedPayout) || !sameAddress(expectedPayout, evidence.builderPayout)) fail('INVALID_ATTRIBUTION', 'Configured Builder Code payout does not match immutable preparation evidence.');

  const builderCodeCheck = await (options.verifyBuilderCode ?? verifyMainnetBuilderCode)({ code: configuredCode, expectedPayoutAddress: expectedPayout });
  if (builderCodeCheck.status !== 'VERIFIED' || builderCodeCheck.code !== configuredCode || builderCodeCheck.chainId !== 196
    || !sameAddress(builderCodeCheck.registryAddress, VERIFIED_MAINNET_BUILDER_CODE_REGISTRY_ADDRESS)
    || !builderCodeCheck.expectedPayoutAddress || !sameAddress(builderCodeCheck.expectedPayoutAddress, expectedPayout)
    || !builderCodeCheck.payoutAddress || !sameAddress(builderCodeCheck.payoutAddress, evidence.builderPayout)) {
    fail('INVALID_ATTRIBUTION', 'The configured mainnet Builder Code is not independently verified on the official registry to the persisted payout.');
  }
  if (await publicClient.getChainId() !== 196) fail('WRONG_CHAIN', 'The receipt RPC is not X Layer Mainnet.');

  const [receipt, transaction] = await Promise.all([publicClient.getTransactionReceipt({ hash: txHash }), publicClient.getTransaction({ hash: txHash })]);
  if (receipt.status !== 'success') fail('FAILED_TRANSACTION', 'The mainnet transaction reverted.');
  if (!receipt.to || !sameAddress(receipt.to, router) || !transaction.to || !sameAddress(transaction.to, router)) fail('INVALID_ROUTE', 'The transaction target does not match the persisted OKX router.');
  if (!sameAddress(receipt.from, buyer) || !sameAddress(transaction.from, buyer)) fail('INVALID_EXECUTION', 'The transaction sender does not match the persisted buyer.');
  if (transaction.value !== 0n || transaction.input !== evidence.attributedSwapCalldata) fail('INVALID_EXECUTION', 'Transaction calldata is not byte-for-byte identical to the persisted attributed swap calldata.');

  let codes: readonly string[];
  try { codes = Attribution.fromData(transaction.input)?.codes ?? []; }
  catch { return fail('INVALID_ATTRIBUTION', 'The confirmed transaction has malformed ERC-8021 attribution.'); }
  if (configuredCode !== evidence.swap.builderCode || codes.length !== 1 || codes[0] !== configuredCode || configuredCode === VERIFIED_TESTNET_BUILDER_CODE) fail('INVALID_ATTRIBUTION', 'Configured, prepared, and transaction Builder Codes must be the same registered mainnet code.');

  if (!receipt.blockHash || receipt.blockNumber <= 0n) fail('NON_CANONICAL_BLOCK', 'Receipt block number or hash is invalid.');
  const beforeBlockNumber = receipt.blockNumber - 1n;
  const [beforeBlock, receiptBlock, preparationBlock] = await Promise.all([
    publicClient.getBlock({ blockNumber: beforeBlockNumber }),
    publicClient.getBlock({ blockNumber: receipt.blockNumber }),
    publicClient.getBlock({ blockNumber: BigInt(evidence.preparationBlockNumber) }),
  ]);
  if (beforeBlock.number !== beforeBlockNumber || receiptBlock.number !== receipt.blockNumber || !beforeBlock.hash || !receiptBlock.hash
    || !receiptBlock.parentHash || !preparationBlock.hash || !sameHex(receipt.blockHash, receiptBlock.hash)
    || !sameHex(receiptBlock.parentHash, beforeBlock.hash)) {
    fail('NON_CANONICAL_BLOCK', 'Receipt, preparation, or deterministic balance block evidence is inconsistent or non-canonical.');
  }
  if (!/^(0|[1-9][0-9]*)$/.test(evidence.preparationBlockNumber) || !/^0x[0-9a-fA-F]{64}$/.test(evidence.preparationBlockHash)
    || BigInt(evidence.preparationBlockNumber) > beforeBlockNumber || preparationBlock.number !== BigInt(evidence.preparationBlockNumber)
    || !sameHex(preparationBlock.hash, evidence.preparationBlockHash)) fail('NON_CANONICAL_BLOCK', 'Persisted preparation snapshot block is not canonical or does not precede settlement.');
  const latestBlockNumber = await publicClient.getBlockNumber();
  const confirmations = latestBlockNumber >= receipt.blockNumber ? latestBlockNumber - receipt.blockNumber + 1n : 0n;
  const requiredConfirmations = confirmationDepth(options.confirmationDepth);
  if (confirmations < BigInt(requiredConfirmations)) fail('CONFIRMING', `The transaction has ${confirmations} confirmations; ${requiredConfirmations} are required.`);
  const rereadReceipt = await publicClient.getTransactionReceipt({ hash: txHash });
  if (rereadReceipt.status !== 'success' || rereadReceipt.blockNumber !== receipt.blockNumber || rereadReceipt.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase()) fail('NON_CANONICAL_BLOCK', 'The confirmed receipt changed during canonical re-read.');

  const assetTransfers = rereadReceipt.logs.map((log) => transferFromLog(log, asset)).filter((value): value is NonNullable<typeof value> => Boolean(value));
  const stablecoinTransfers = rereadReceipt.logs.map((log) => transferFromLog(log, stablecoin)).filter((value): value is NonNullable<typeof value> => Boolean(value));
  const buyerOutflows = assetTransfers.filter((transfer) => sameAddress(transfer.from, buyer));
  const buyerRefunds = assetTransfers.filter((transfer) => sameAddress(transfer.to, buyer));
  const allowedInputRecipients = permittedBuyerInputRecipients(evidence, asset, router);
  if (buyerOutflows.some((transfer) => !allowedInputRecipients.has(transfer.to.toLowerCase()))
    || buyerRefunds.some((transfer) => !sameAddress(transfer.from, router))) {
    fail('INVALID_INPUT_AMOUNT', 'Input-token movements include an unexplained route recipient or non-router transfer to/from the buyer.');
  }
  const grossBuyerOutflow = buyerOutflows.reduce((sum, transfer) => sum + transfer.value, 0n);
  const routerRefund = buyerRefunds.reduce((sum, transfer) => sum + transfer.value, 0n);
  if (grossBuyerOutflow <= 0n || grossBuyerOutflow > expectedInput || routerRefund > grossBuyerOutflow) {
    fail('INVALID_INPUT_AMOUNT', 'Observed buyer input-token outflow/refund exceeds the prepared maximum or is invalid.');
  }
  const netBuyerDebit = grossBuyerOutflow - routerRefund;
  const merchantOutput = stablecoinTransfers.filter((transfer) => sameAddress(transfer.to, merchant)).reduce((sum, transfer) => sum + transfer.value, 0n);
  if (netBuyerDebit <= 0n) fail('INVALID_INPUT_AMOUNT', 'The buyer net input-token debit must be positive.');
  if (merchantOutput < minimumOutput || merchantOutput < invoiceOutput) fail('INSUFFICIENT_OUTPUT', 'The merchant output is below the persisted minimum or invoice amount.');

  const [buyerBeforeRaw, buyerAfterRaw, merchantBeforeRaw, merchantAfterRaw] = await Promise.all([
    publicClient.readContract({ address: asset, abi: erc20ReadAbi, functionName: 'balanceOf', args: [buyer], blockNumber: beforeBlockNumber }),
    publicClient.readContract({ address: asset, abi: erc20ReadAbi, functionName: 'balanceOf', args: [buyer], blockNumber: receipt.blockNumber }),
    publicClient.readContract({ address: stablecoin, abi: erc20ReadAbi, functionName: 'balanceOf', args: [merchant], blockNumber: beforeBlockNumber }),
    publicClient.readContract({ address: stablecoin, abi: erc20ReadAbi, functionName: 'balanceOf', args: [merchant], blockNumber: receipt.blockNumber }),
  ]);
  const buyerBefore = exactUint(buyerBeforeRaw, 'Buyer input balance before');
  const buyerAfter = exactUint(buyerAfterRaw, 'Buyer input balance after');
  const merchantBefore = exactUint(merchantBeforeRaw, 'Merchant USD₮0 balance before');
  const merchantAfter = exactUint(merchantAfterRaw, 'Merchant USD₮0 balance after');
  if (buyerBefore < buyerAfter || buyerBefore - buyerAfter !== netBuyerDebit) fail('INVALID_INPUT_AMOUNT', 'The deterministic buyer balance delta does not equal the receipt-derived net debit.');
  if (merchantAfter - merchantBefore !== merchantOutput) fail('INVALID_OUTPUT_BALANCE', 'The deterministic merchant balance delta does not equal the receipt transfer amount.');

  const balanceEvidence: MainnetBalanceEvidence = {
    beforeBlockNumber: beforeBlockNumber.toString(), beforeBlockHash: beforeBlock.hash,
    receiptBlockNumber: receipt.blockNumber.toString(), receiptBlockHash: receiptBlock.hash,
    buyerInputBefore: buyerBefore.toString(), buyerInputAfter: buyerAfter.toString(),
    merchantOutputBefore: merchantBefore.toString(), merchantOutputAfter: merchantAfter.toString(),
    buyerInputDelta: (buyerBefore - buyerAfter).toString(), merchantOutputDelta: (merchantAfter - merchantBefore).toString(),
  };
  const claimDisposition = await repository.claimSettlement({
    preparationId: evidence.id,
    invoiceId: invoice.id,
    chainId: 196,
    transactionHash: txHash,
    evidence: {
      buyer, merchant, inputToken: asset, outputToken: stablecoin,
      inputAmount: netBuyerDebit.toString(), maxInputAmount: expectedInput.toString(), outputAmount: merchantOutput.toString(), router,
      builderPayout: evidence.builderPayout,
      blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
      builderCode: configuredCode, balances: balanceEvidence,
    },
  });
  if (!claimDisposition) fail('DUPLICATE_SETTLEMENT', 'The atomic database claim rejected a duplicate invoice or transaction.');

  return {
    status: 'paid', invoiceId: invoice.id, paymentTxHash: txHash, buyer, merchant,
    spentAsset: asset, spentAmount: netBuyerDebit.toString(), stablecoin, stablecoinReceived: merchantOutput.toString(),
    router, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
    confirmationDepth: Number(confirmations), builderCode: configuredCode, builderCodeCheck, canonical: true, balanceEvidence,
    claimDisposition,
  };
}
