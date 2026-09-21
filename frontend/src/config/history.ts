import { formatUnits, isAddress } from 'viem';
import type { Invoice } from './api';
import { portfolioAssets } from './assets';
import { portPayNetworkConfig, VERIFIED_TESTNET_USDT0_ADDRESS } from './network';

function displayDecimal(value: string | number): string {
  const normalized = String(value);
  if (!normalized.includes('.')) return normalized;
  return normalized.replace(/0+$/, '').replace(/\.$/, '');
}

export function formatSpentAmount(invoice: Invoice): string {
  if (typeof invoice.spentAmount !== 'string' || !/^\d+$/.test(invoice.spentAmount)) return 'Amount unavailable';

  const knownAsset = Object.values(portfolioAssets).find((asset) =>
    invoice.spentAsset && isAddress(invoice.spentAsset) && asset.address
      && invoice.spentAsset.toLowerCase() === asset.address.toLowerCase());
  if (knownAsset) {
    try {
      return `${displayDecimal(formatUnits(BigInt(invoice.spentAmount), knownAsset.decimals))} ${knownAsset.label}`;
    } catch {
      return 'Amount unavailable';
    }
  }

  return 'Unknown asset amount';
}

export function formatReceivedAmount(invoice: Invoice): string {
  const amount = invoice.stablecoinReceived ?? invoice.amountUsdt0;
  const normalizedAmount = typeof amount === 'number' ? String(amount) : amount;
  if (!/^\d+(?:\.\d+)?$/.test(normalizedAmount)) return 'Amount unavailable';
  return `${displayDecimal(normalizedAmount)} USD₮0`;
}

export function formatPaymentTimestamp(value: string | undefined): string {
  if (!value) return 'Timestamp unavailable';
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? 'Timestamp unavailable' : timestamp.toLocaleString();
}

export function getExplorerTransactionUrl(transactionHash: string | undefined): string | undefined {
  if (!transactionHash || !/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) return undefined;
  return `${portPayNetworkConfig.explorerUrl}/tx/${transactionHash}`;
}

export function hasVerifiedPaymentEvidence(invoice: Invoice): boolean {
  return Boolean(
    invoice.status === 'paid' &&
      invoice.paymentTxHash &&
      getExplorerTransactionUrl(invoice.paymentTxHash) &&
      invoice.paidAt &&
      invoice.buyerAddress &&
      invoice.spentAsset &&
      invoice.spentAmount &&
      invoice.stablecoinReceived &&
      invoice.quoteId &&
      invoice.settlementContract &&
      invoice.settlementBlockNumber,
  );
}

export function isOfficialSettlementAsset(address: string | undefined): boolean {
  return Boolean(address && address.toLowerCase() === VERIFIED_TESTNET_USDT0_ADDRESS.toLowerCase());
}
