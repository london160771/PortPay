import { decodeFunctionData, isAddress, parseUnits } from 'viem';
import type { Address } from 'viem';
import type { Invoice, MainnetApprovalPreparation } from './api';
import { portPayBuilderCode, toBuilderCodeDataSuffix, VERIFIED_TESTNET_BUILDER_CODE } from './builderCodes';
import {
  mainnetNetworkConfig,
  VERIFIED_MAINNET_USDT0_ADDRESS,
  VERIFIED_MAINNET_WNVDA_ADDRESS,
  VERIFIED_MAINNET_WAAPL_ADDRESS,
} from './network';

const approveAbi = [{
  type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const;
const maxUint256 = (1n << 256n) - 1n;
const isHexData = (value: string): boolean => /^0x(?:[0-9a-fA-F]{2})+$/.test(value);

export function hasExactMainnetAllowance(currentAllowance: unknown, requiredAmount: string): boolean {
  return typeof currentAllowance === 'bigint' && currentAllowance >= 0n
    && /^\d+$/.test(requiredAmount) && currentAllowance === BigInt(requiredAmount);
}

export function isSamePersistedMainnetPreparation(
  original: MainnetApprovalPreparation,
  refreshed: MainnetApprovalPreparation,
): boolean {
  return refreshed.preparationId === original.preparationId
    && refreshed.preparationHash === original.preparationHash
    && refreshed.invoiceId === original.invoiceId
    && refreshed.buyer.toLowerCase() === original.buyer.toLowerCase()
    && refreshed.merchant.toLowerCase() === original.merchant.toLowerCase()
    && refreshed.chainId === original.chainId
    && refreshed.token.toLowerCase() === original.token.toLowerCase()
    && refreshed.outputToken.toLowerCase() === original.outputToken.toLowerCase()
    && refreshed.spender.toLowerCase() === original.spender.toLowerCase()
    && refreshed.amount === original.amount
    && refreshed.minimumReceive === original.minimumReceive
    && refreshed.attributedApprovalCalldata === original.attributedApprovalCalldata
    && refreshed.dataSuffix === original.dataSuffix
    && refreshed.builderCode === original.builderCode
    && refreshed.expiresAt === original.expiresAt;
}

export function validatePreparedMainnetApproval(
  preparation: MainnetApprovalPreparation,
  invoice: Invoice,
  connectedBuyer: Address,
  connectedChainId: number | undefined,
  nowMs = Date.now(),
): string | null {
  if (connectedChainId !== 196 || preparation.chainId !== 196) return 'Switch the connected wallet to X Layer Mainnet (chain 196).';
  if (preparation.invoiceId !== invoice.id) return 'The approval preparation belongs to a different invoice.';
  if (preparation.buyer.toLowerCase() !== connectedBuyer.toLowerCase()) return 'The connected wallet does not match the prepared buyer.';
  if (!isAddress(invoice.merchantAddress) || preparation.merchant.toLowerCase() !== invoice.merchantAddress.toLowerCase()) return 'The prepared merchant does not match this invoice.';
  const supportedAsset = [
    { address: VERIFIED_MAINNET_WNVDA_ADDRESS, configuredAddress: mainnetNetworkConfig.wNvdaAddress },
    { address: VERIFIED_MAINNET_WAAPL_ADDRESS, configuredAddress: mainnetNetworkConfig.wAaplAddress },
  ].find((asset) => preparation.token.toLowerCase() === asset.address.toLowerCase()
    && preparation.token.toLowerCase() === asset.configuredAddress.toLowerCase());
  if (!isAddress(preparation.token) || !supportedAsset) return 'The preparation does not use a configured supported Mainnet xStock.';
  if (!isAddress(preparation.outputToken) || preparation.outputToken.toLowerCase() !== VERIFIED_MAINNET_USDT0_ADDRESS.toLowerCase()
    || preparation.outputToken.toLowerCase() !== mainnetNetworkConfig.usdt0Address.toLowerCase()) return 'The preparation does not use official mainnet USD₮0.';
  if (!isAddress(preparation.spender)) return 'The prepared approval spender is invalid.';
  if (!/^\d+$/.test(preparation.amount) || BigInt(preparation.amount) <= 0n || BigInt(preparation.amount) === maxUint256) return 'The prepared approval amount is invalid or unlimited.';
  let invoiceAmount: bigint;
  try { invoiceAmount = parseUnits(invoice.amountUsdt0, 6); }
  catch { return 'The invoice amount is invalid for mainnet USD₮0.'; }
  if (!/^\d+$/.test(preparation.minimumReceive) || BigInt(preparation.minimumReceive) < invoiceAmount) return 'The prepared minimum receive does not cover this invoice.';
  if (preparation.nativeValue !== '0') return 'The prepared approval must not send native OKB.';
  if (!/^\d+$/.test(preparation.snapshotAllowance)) return 'The pinned allowance evidence is malformed.';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(preparation.preparationId)
    || !/^0x[0-9a-fA-F]{64}$/.test(preparation.preparationHash)) return 'Immutable preparation binding metadata is invalid.';
  if (!Number.isFinite(Date.parse(preparation.expiresAt)) || Date.parse(preparation.expiresAt) <= nowMs) return 'The mainnet approval preparation has expired. Refresh it.';
  if (!/^[a-z0-9]{16}$/.test(preparation.builderCode)
    || preparation.builderCode === VERIFIED_TESTNET_BUILDER_CODE
    || (portPayBuilderCode && preparation.builderCode === portPayBuilderCode)) return 'The preparation does not use a separate mainnet Builder Code.';
  const expectedSuffix = toBuilderCodeDataSuffix(preparation.builderCode);
  if (!expectedSuffix || preparation.dataSuffix !== expectedSuffix) return 'The prepared mainnet Builder Code suffix is invalid.';
  if (!isHexData(preparation.approvalCalldata) || !isHexData(preparation.attributedApprovalCalldata)
    || !preparation.attributedApprovalCalldata.startsWith(preparation.approvalCalldata)
    || preparation.attributedApprovalCalldata !== `${preparation.approvalCalldata}${preparation.dataSuffix.slice(2)}`) return 'The attributed approval calldata does not match the backend preparation.';

  try {
    const decoded = decodeFunctionData({ abi: approveAbi, data: preparation.approvalCalldata as `0x${string}` });
    if (decoded.functionName !== 'approve'
      || typeof decoded.args[0] !== 'string'
      || decoded.args[0].toLowerCase() !== preparation.spender.toLowerCase()
      || decoded.args[1] !== BigInt(preparation.amount)) return 'Approval calldata does not exactly match the prepared spender and amount.';
  } catch {
    return 'The prepared approval calldata could not be decoded.';
  }

  return null;
}
