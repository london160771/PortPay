import type { Address } from 'viem';
import type { SettlementQuote } from './api';
import { xLayerTestnet } from './network';

export function validatePaymentQuote(
  quote: SettlementQuote,
  buyer: Address,
  asset: Address,
  stablecoin: Address,
  settlement: Address,
  nowSeconds = Math.floor(Date.now() / 1000),
): string | null {
  const signed = quote.quote;
  if (
    signed.buyer.toLowerCase() !== buyer.toLowerCase()
    || signed.asset.toLowerCase() !== asset.toLowerCase()
    || signed.stablecoin.toLowerCase() !== stablecoin.toLowerCase()
    || signed.settlementContract.toLowerCase() !== settlement.toLowerCase()
    || signed.chainId !== xLayerTestnet.id
  ) return 'The quote does not match this wallet or the configured X Layer Testnet contracts. Refresh it.';
  if (BigInt(signed.expiry) <= BigInt(nowSeconds + 30)) {
    return 'This quote is too close to expiry. Refresh it before paying.';
  }
  return null;
}

export function needsApproval(allowance: bigint, requiredAmount: bigint): boolean {
  return allowance < requiredAmount;
}
