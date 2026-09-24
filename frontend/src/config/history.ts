import { formatUnits, isAddress } from 'viem';
import type { Invoice, PaymentNetwork } from './api';
import { mainnetAssets, portfolioAssets } from './assets';
import {
  mainnetNetworkConfig,
  internalTestnetNetworkConfig,
  VERIFIED_MAINNET_USDT0_ADDRESS,
  VERIFIED_TESTNET_USDT0_ADDRESS,
} from './network';

export function getInvoicePaymentNetwork(invoice: Invoice): PaymentNetwork {
  if (invoice.paymentNetwork) return invoice.paymentNetwork;
  // All pre-network-field paid records were testnet receipts. Preserve that history
  // rather than ever relabeling a legacy transaction as a mainnet payment.
  return invoice.status === 'paid' || invoice.paymentTxHash ? 'x-layer-testnet' : 'x-layer-mainnet';
}

export function paymentNetworkLabel(network: PaymentNetwork): string {
  return network === 'x-layer-mainnet' ? 'X Layer Mainnet · 196' : 'Legacy X Layer Testnet · 1952';
}

function displayDecimal(value: string | number): string {
  const normalized = String(value);
  if (!normalized.includes('.')) return normalized;
  return normalized.replace(/0+$/, '').replace(/\.$/, '');
}

export function formatSpentAmount(invoice: Invoice): string {
  if (typeof invoice.spentAmount !== 'string' || !/^\d+$/.test(invoice.spentAmount)) return 'Amount unavailable';

  const knownAsset = [...Object.values(mainnetAssets).slice(0, 2), ...Object.values(portfolioAssets)].find((asset) =>
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

export function getExplorerTransactionUrl(
  transactionHash: string | undefined,
  network: PaymentNetwork = 'x-layer-mainnet',
): string | undefined {
  if (!transactionHash || !/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) return undefined;
  const explorerUrl = network === 'x-layer-mainnet' ? mainnetNetworkConfig.explorerUrl : internalTestnetNetworkConfig.explorerUrl;
  return `${explorerUrl}/tx/${transactionHash}`;
}

export function hasVerifiedPaymentEvidence(invoice: Invoice): boolean {
  const paymentNetwork = getInvoicePaymentNetwork(invoice);
  return Boolean(
    invoice.status === 'paid' &&
      invoice.paymentTxHash &&
      getExplorerTransactionUrl(invoice.paymentTxHash, paymentNetwork) &&
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

export function isOfficialSettlementAsset(address: string | undefined, network: PaymentNetwork = 'x-layer-mainnet'): boolean {
  const expected = network === 'x-layer-mainnet' ? VERIFIED_MAINNET_USDT0_ADDRESS : VERIFIED_TESTNET_USDT0_ADDRESS;
  return Boolean(address && address.toLowerCase() === expected.toLowerCase());
}
