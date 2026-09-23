import {
  createPublicClient,
  decodeFunctionData,
  decodeFunctionResult,
  getAddress,
  http,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import type { Invoice } from '../invoices/types.js';
import {
  mainnetAddressConfig,
  mainnetSupportedAssets,
  xLayerMainnetChain,
} from '../config/xlayerMainnet.js';
import { verifyMainnetBuilderCode, type MainnetBuilderCodeCheck, type MainnetBuilderCodeReadClient } from './mainnetBuilderCodes.js';
import {
  type MainnetQuote,
  type OKXDEXMainnetAdapter,
  type PreparedMainnetTransaction,
} from './mainnet.js';
import { persistMainnetPreparation, type MainnetReconciliationRepository } from './mainnetReconciliationRepository.js';

export const erc20ReadAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
] as const;

const approveAbi = [{
  type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }],
}] as const;
const GAS_SAFETY_MARGIN_BPS = 12_000n;
const BPS_DENOMINATOR = 10_000n;

export type MainnetReadOnlyClient = {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(args: { blockNumber: bigint }): Promise<{ number: bigint | null; hash: Hex | null }>;
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    blockNumber?: bigint;
  }): Promise<unknown>;
  getBalance(args: { address: Address; blockNumber?: bigint }): Promise<bigint>;
  call(args: { account: Address; to: Address; data: Hex; value: bigint }): Promise<unknown>;
  estimateGas(args: { account: Address; to: Address; data: Hex; value: bigint }): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
};

export type MainnetBalanceSnapshot = {
  assetAddress: Address;
  assetBalance: string;
  assetDecimals: number;
  allowance: string;
  approvalSpender: Address;
  buyerAddress: Address;
  buyerOkbBalance: string;
  merchantAddress: Address;
  merchantStablecoinBalance: string;
  stablecoinAddress: Address;
  stablecoinDecimals: number;
  requiredGasWei?: string;
  approvalGasEstimate?: string;
  swapGasEstimate?: string;
  gasPriceWei?: string;
  snapshotBlockNumber: string;
  snapshotBlockHash: Hex;
};

export type MainnetSimulationResult = {
  stage: 'approval' | 'swap';
  approval: 'passed' | 'not-run';
  swap: 'passed' | 'not-run';
};

export type MainnetPreflightStatus =
  | 'READY' | 'BLOCKED' | 'EXPIRED' | 'INVALID_ROUTE' | 'WRONG_RECIPIENT' | 'WRONG_CHAIN'
  | 'INVALID_APPROVAL' | 'INVALID_ATTRIBUTION' | 'INVALID_DECIMALS' | 'INSUFFICIENT_BALANCE'
  | 'APPROVAL_REQUIRED' | 'INSUFFICIENT_ALLOWANCE' | 'INSUFFICIENT_GAS' | 'SIMULATION_FAILED' | 'RPC_ERROR'
  | 'DUPLICATE_SETTLEMENT';

export type MainnetPreflightResult = {
  status: MainnetPreflightStatus;
  ready: boolean;
  reason: string;
  builderCode: MainnetBuilderCodeCheck;
  balances?: MainnetBalanceSnapshot;
  simulations?: MainnetSimulationResult;
  preparationId?: string;
};

export type MainnetPreflightRequest = {
  adapter: OKXDEXMainnetAdapter;
  invoice: Invoice;
  quote: MainnetQuote;
  approval: PreparedMainnetTransaction;
  swap: PreparedMainnetTransaction;
  publicClient?: MainnetReadOnlyClient;
  builderCodeClient?: MainnetBuilderCodeReadClient;
  repository?: MainnetReconciliationRepository;
  expectedBuilderPayoutAddress?: string;
};

function defaultClient(): MainnetReadOnlyClient {
  return createPublicClient({ chain: xLayerMainnetChain, transport: http(xLayerMainnetChain.rpcUrls.default.http[0]) }) as unknown as MainnetReadOnlyClient;
}

function sameAddress(left: string, right: string): boolean { return left.toLowerCase() === right.toLowerCase(); }

function asBigInt(value: unknown, label: string): bigint {
  if (typeof value !== 'bigint' || value < 0n) throw new Error(`${label} was not a valid non-negative bigint.`);
  return value;
}

function asDecimals(value: unknown, expected: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value !== expected) {
    throw new Error(`${label} decimals mismatch: expected ${expected}.`);
  }
  return value;
}

function normalizeAddress(value: string, label: string): Address {
  if (!isAddress(value)) throw new Error(`${label} is not a valid EVM address.`);
  return getAddress(value);
}

function failure(status: MainnetPreflightStatus, reason: string, builderCode: MainnetBuilderCodeCheck, balances?: MainnetBalanceSnapshot, simulations?: MainnetSimulationResult, preparationId?: string): MainnetPreflightResult {
  return { status, ready: false, reason, builderCode, ...(balances ? { balances } : {}), ...(simulations ? { simulations } : {}), ...(preparationId ? { preparationId } : {}) };
}

function bufferedGas(estimate: bigint): bigint {
  if (estimate <= 0n) throw new Error('RPC returned an invalid zero gas estimate.');
  return (estimate * GAS_SAFETY_MARGIN_BPS + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}

function dataFromCallResult(result: unknown): Hex {
  if (typeof result === 'string') return result as Hex;
  if (typeof result === 'object' && result !== null && 'data' in result && result.data === undefined) return '0x';
  if (typeof result === 'object' && result !== null && 'data' in result && typeof result.data === 'string') return result.data as Hex;
  throw new Error('Approval simulation returned malformed RPC data.');
}

async function simulateExactApproval(publicClient: MainnetReadOnlyClient, approval: PreparedMainnetTransaction): Promise<void> {
  const data = approval.attributedData;
  if (!data) throw new Error('The approval is missing its exact attributed calldata.');
  const result = dataFromCallResult(await publicClient.call({ account: approval.from, to: approval.to, data, value: approval.value }));
  if (result === '0x') return; // Some ERC-20s return no data; this is permitted by the token interface.
  if (!/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error('Approval simulation returned malformed ERC-20 data.');
  let success: unknown;
  try { success = decodeFunctionResult({ abi: approveAbi, functionName: 'approve', data: result }); }
  catch { throw new Error('Approval simulation return data could not be decoded.'); }
  if (success !== true) throw new Error('Approval simulation returned false.');
}

export async function readMainnetBalances(
  publicClient: MainnetReadOnlyClient,
  quote: MainnetQuote,
  approval: PreparedMainnetTransaction,
): Promise<MainnetBalanceSnapshot> {
  const buyerAddress = normalizeAddress(quote.buyer, 'Quote buyer');
  const merchantAddress = normalizeAddress(quote.merchant, 'Quote merchant');
  const assetAddress = normalizeAddress(quote.asset, 'Quote asset');
  const stablecoinAddress = normalizeAddress(quote.stablecoin, 'Quote stablecoin');
  const supportedAsset = mainnetSupportedAssets.find((asset) => sameAddress(asset.address, assetAddress));
  if (!supportedAsset || !sameAddress(stablecoinAddress, mainnetAddressConfig.usdt0)) throw new Error('Read-only balance tokens are not the configured mainnet assets.');
  const decoded = decodeFunctionData({ abi: approveAbi, data: approval.data });
  if (decoded.functionName !== 'approve' || decoded.args?.length !== 2 || typeof decoded.args[0] !== 'string') throw new Error('Approval calldata could not be decoded for read-only balance checks.');
  const approvalSpender = normalizeAddress(decoded.args[0], 'Approval spender');
  const snapshotBlockNumber = await publicClient.getBlockNumber();
  const snapshotBlock = await publicClient.getBlock({ blockNumber: snapshotBlockNumber });
  if (snapshotBlock.number !== snapshotBlockNumber || !snapshotBlock.hash || !/^0x[0-9a-fA-F]{64}$/.test(snapshotBlock.hash)) throw new Error('Mainnet preparation snapshot block data is inconsistent.');
  const [assetBalance, allowance, buyerOkbBalance, merchantStablecoinBalance, assetDecimals, stablecoinDecimals] = await Promise.all([
    publicClient.readContract({ address: assetAddress, abi: erc20ReadAbi, functionName: 'balanceOf', args: [buyerAddress], blockNumber: snapshotBlockNumber }),
    publicClient.readContract({ address: assetAddress, abi: erc20ReadAbi, functionName: 'allowance', args: [buyerAddress, approvalSpender], blockNumber: snapshotBlockNumber }),
    publicClient.getBalance({ address: buyerAddress, blockNumber: snapshotBlockNumber }),
    publicClient.readContract({ address: stablecoinAddress, abi: erc20ReadAbi, functionName: 'balanceOf', args: [merchantAddress], blockNumber: snapshotBlockNumber }),
    publicClient.readContract({ address: assetAddress, abi: erc20ReadAbi, functionName: 'decimals', blockNumber: snapshotBlockNumber }),
    publicClient.readContract({ address: stablecoinAddress, abi: erc20ReadAbi, functionName: 'decimals', blockNumber: snapshotBlockNumber }),
  ]);
  return {
    assetAddress,
    assetBalance: asBigInt(assetBalance, 'Asset balance').toString(),
    assetDecimals: asDecimals(assetDecimals, supportedAsset.decimals, 'Input token'),
    allowance: asBigInt(allowance, 'Allowance').toString(),
    approvalSpender,
    buyerAddress,
    buyerOkbBalance: asBigInt(buyerOkbBalance, 'Buyer OKB balance').toString(),
    merchantAddress,
    merchantStablecoinBalance: asBigInt(merchantStablecoinBalance, 'Merchant USD₮0 balance').toString(),
    stablecoinAddress,
    stablecoinDecimals: asDecimals(stablecoinDecimals, 6, 'Mainnet USD₮0'),
    snapshotBlockNumber: snapshotBlockNumber.toString(),
    snapshotBlockHash: snapshotBlock.hash,
  };
}

async function estimateBufferedGas(
  publicClient: MainnetReadOnlyClient,
  approval: PreparedMainnetTransaction,
  swap: PreparedMainnetTransaction,
): Promise<Pick<MainnetBalanceSnapshot, 'requiredGasWei' | 'approvalGasEstimate' | 'swapGasEstimate' | 'gasPriceWei'>> {
  if (!approval.attributedData || !swap.attributedData) throw new Error('Gas estimation requires exact attributed approval and swap calldata.');
  const [approvalGas, swapGas, gasPrice] = await Promise.all([
    publicClient.estimateGas({ account: approval.from, to: approval.to, data: approval.attributedData, value: approval.value }),
    publicClient.estimateGas({ account: swap.from, to: swap.to, data: swap.attributedData, value: swap.value }),
    publicClient.getGasPrice(),
  ]);
  const approvalGasEstimate = bufferedGas(asBigInt(approvalGas, 'Attributed approval gas estimate'));
  const swapGasEstimate = bufferedGas(asBigInt(swapGas, 'Attributed swap gas estimate'));
  const exactGasPrice = asBigInt(gasPrice, 'Mainnet gas price');
  if (exactGasPrice === 0n) throw new Error('RPC returned an invalid zero gas price.');
  return {
    requiredGasWei: ((approvalGasEstimate + swapGasEstimate) * exactGasPrice).toString(),
    approvalGasEstimate: approvalGasEstimate.toString(),
    swapGasEstimate: swapGasEstimate.toString(),
    gasPriceWei: exactGasPrice.toString(),
  };
}

function mapPreparationError(error: unknown): { status: MainnetPreflightStatus; reason: string } {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('expired')) return { status: 'EXPIRED', reason: message };
  if (lower.includes('recipient')) return { status: 'WRONG_RECIPIENT', reason: message };
  if (lower.includes('chain')) return { status: 'WRONG_CHAIN', reason: message };
  if (lower.includes('decimals')) return { status: 'INVALID_DECIMALS', reason: message };
  if (lower.includes('approval') || lower.includes('spender')) return { status: 'INVALID_APPROVAL', reason: message };
  if (lower.includes('router') || lower.includes('route') || lower.includes('calldata')) return { status: 'INVALID_ROUTE', reason: message };
  return { status: 'BLOCKED', reason: message };
}

export async function runMainnetPreflight(request: MainnetPreflightRequest): Promise<MainnetPreflightResult> {
  const publicClient = request.publicClient ?? defaultClient();
  const builderCode = await verifyMainnetBuilderCode({
    code: request.adapter.getBuilderCode(),
    expectedPayoutAddress: request.expectedBuilderPayoutAddress,
    client: request.builderCodeClient,
  });
  if (request.invoice.status !== 'pending') return failure('DUPLICATE_SETTLEMENT', 'The invoice is no longer pending and cannot be prepared for settlement.', builderCode);
  let chainId: number;
  try { chainId = await publicClient.getChainId(); }
  catch { return failure('RPC_ERROR', 'Unable to read the X Layer Mainnet chain ID.', builderCode); }
  if (chainId !== 196 || request.quote.chainId !== 196 || request.approval.chainId !== 196 || request.swap.chainId !== 196) return failure('WRONG_CHAIN', 'Every mainnet preparation object and the read-only RPC must use chain 196.', builderCode);
  if (request.quote.invoiceId !== request.invoice.id) return failure('BLOCKED', 'The quote is bound to a different invoice.', builderCode);
  if (!sameAddress(request.quote.merchant, request.invoice.merchantAddress)) return failure('WRONG_RECIPIENT', 'The quote merchant does not match the invoice merchant.', builderCode);
  const expectedAsset = mainnetSupportedAssets.find((asset) => asset.key === request.quote.assetKey);
  if (!expectedAsset || !sameAddress(request.quote.asset, expectedAsset.address) || !sameAddress(request.quote.stablecoin, mainnetAddressConfig.usdt0)) return failure('INVALID_ROUTE', 'The quote tokens do not match the isolated mainnet configuration.', builderCode);
  try {
    const expectedInvoiceAmount = parseUnits(request.invoice.amountUsdt0, 6).toString();
    if (request.quote.invoiceStablecoinAmount !== expectedInvoiceAmount || BigInt(request.quote.minReceiveAmount) < BigInt(expectedInvoiceAmount) || BigInt(request.quote.minReceiveAmount) > BigInt(request.quote.quotedStablecoinAmount)) return failure('INVALID_ROUTE', 'The quote output or minimum receive does not satisfy the invoice.', builderCode);
    await request.adapter.validatePreparedTransaction(request.quote, request.approval);
    await request.adapter.validatePreparedTransaction(request.quote, request.swap);
  } catch (error) {
    const mapped = mapPreparationError(error);
    return failure(mapped.status, mapped.reason, builderCode);
  }
  if (builderCode.status !== 'VERIFIED') {
    const reason = builderCode.status === 'MISSING' || builderCode.status === 'PAYOUT_NOT_CONFIGURED'
      ? 'A separate registered mainnet Builder Code is required before live-ready status.'
      : `Mainnet Builder Code verification is ${builderCode.status.toLowerCase()}.`;
    return failure(builderCode.status === 'MISSING' || builderCode.status === 'PAYOUT_NOT_CONFIGURED' ? 'BLOCKED' : 'INVALID_ATTRIBUTION', reason, builderCode);
  }

  let balances: MainnetBalanceSnapshot;
  try { balances = await readMainnetBalances(publicClient, request.quote, request.approval); }
  catch (error) {
    const mapped = mapPreparationError(error);
    return failure(mapped.status === 'BLOCKED' ? 'RPC_ERROR' : mapped.status, mapped.reason, builderCode);
  }
  const requiredInput = BigInt(request.quote.assetAmount);
  if (BigInt(balances.assetBalance) < requiredInput) return failure('INSUFFICIENT_BALANCE', 'The buyer does not hold enough of the selected mainnet asset.', builderCode, balances);

  if (!request.repository || !builderCode.payoutAddress) return failure('BLOCKED', 'Supabase-backed immutable preparation evidence is required before any wallet approval can be considered.', builderCode, balances);
  let preparationId: string;
  try {
    const persisted = await persistMainnetPreparation({
      repository: request.repository,
      quote: request.quote,
      approval: request.approval,
      swap: request.swap,
      builderPayout: builderCode.payoutAddress,
      snapshotBlockNumber: BigInt(balances.snapshotBlockNumber),
      snapshotBlockHash: balances.snapshotBlockHash,
    });
    preparationId = persisted.id;
  } catch (error) {
    return failure('BLOCKED', error instanceof Error ? `Unable to persist immutable mainnet preparation: ${error.message}` : 'Unable to persist immutable mainnet preparation.', builderCode, balances);
  }

  const stageA: MainnetSimulationResult = { stage: 'approval', approval: 'passed', swap: 'not-run' };
  const allowance = BigInt(balances.allowance);
  if (allowance !== requiredInput) {
    try { await simulateExactApproval(publicClient, request.approval); }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Exact attributed approval simulation failed.';
      return failure(message.includes('returned false') || message.includes('malformed ERC-20') || message.includes('could not be decoded') ? 'INVALID_APPROVAL' : 'SIMULATION_FAILED', message, builderCode, balances, undefined, preparationId);
    }
    const allowanceKind = allowance < requiredInput ? 'below' : 'above';
    return failure('APPROVAL_REQUIRED', `Stage A simulated the exact attributed approval successfully, but the pinned onchain allowance is ${allowanceKind} the required amount. Allowance must equal the exact input amount; Stage B is withheld until that exact allowance is confirmed onchain.`, builderCode, balances, stageA, preparationId);
  }

  let gas: Pick<MainnetBalanceSnapshot, 'requiredGasWei' | 'approvalGasEstimate' | 'swapGasEstimate' | 'gasPriceWei'>;
  try { gas = await estimateBufferedGas(publicClient, request.approval, request.swap); }
  catch (error) {
    return failure('RPC_ERROR', error instanceof Error ? `Stage B exact attributed gas estimation failed: ${error.message}` : 'Stage B exact attributed gas estimation failed.', builderCode, balances, { stage: 'swap', approval: 'not-run', swap: 'not-run' }, preparationId);
  }
  balances = { ...balances, ...gas };
  try {
    if (!request.swap.attributedData) throw new Error('The swap is missing its exact attributed calldata.');
    await publicClient.call({ account: request.swap.from, to: request.swap.to, data: request.swap.attributedData, value: request.swap.value });
  } catch (error) {
    return failure('SIMULATION_FAILED', error instanceof Error ? error.message : 'Stage B swap simulation failed.', builderCode, balances, { stage: 'swap', approval: 'not-run', swap: 'not-run' }, preparationId);
  }
  if (BigInt(balances.buyerOkbBalance) < BigInt(balances.requiredGasWei!)) return failure('INSUFFICIENT_GAS', 'The buyer OKB balance is below the buffered requirement for exact attributed approval and swap calldata (20% safety margin).', builderCode, balances, { stage: 'swap', approval: 'not-run', swap: 'passed' }, preparationId);
  return {
    status: 'READY',
    ready: true,
    reason: 'The pinned allowance exactly matches the required input; Stage B exact attributed approval/swap gas estimates and swap simulation passed. READY remains preparation-only, never broadcast authorization.',
    builderCode,
    balances,
    simulations: { stage: 'swap', approval: 'not-run', swap: 'passed' },
    preparationId,
  };
}
