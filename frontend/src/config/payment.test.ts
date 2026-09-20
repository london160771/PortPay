import { describe, expect, it } from 'vitest';
import type { SettlementQuote } from './api';
import { needsApproval, validatePaymentQuote } from './payment';

const buyer = '0x1111111111111111111111111111111111111111';
const asset = '0x2222222222222222222222222222222222222222';
const stablecoin = '0x3333333333333333333333333333333333333333';
const settlement = '0x4444444444444444444444444444444444444444';
const quote: SettlementQuote = {
  invoiceId: '00000000-0000-4000-8000-000000000001',
  invoiceIdHash: `0x${'a'.repeat(64)}`,
  quote: {
    invoiceId: `0x${'a'.repeat(64)}`,
    buyer,
    merchant: '0x5555555555555555555555555555555555555555',
    asset,
    assetAmount: '80000000000000000',
    stablecoin,
    stablecoinAmount: '20000000',
    settlementContract: settlement,
    chainId: 1952,
    expiry: '1500',
  },
  quoteId: `0x${'b'.repeat(64)}`,
  signature: `0x${'c'.repeat(130)}`,
  assetDecimals: 18,
  stablecoinDecimals: 6,
  assetAmount: '0.08',
  stablecoinAmount: '20',
  referencePriceUsd: '250.00',
  expiresAt: '1970-01-01T00:25:00.000Z',
};

describe('buyer payment guards', () => {
  it('accepts only the configured buyer, tokens, chain, contract, and usable expiry', () => {
    expect(validatePaymentQuote(quote, buyer, asset, stablecoin, settlement, 1000)).toBeNull();
    expect(validatePaymentQuote(quote, settlement, asset, stablecoin, settlement, 1000)).toMatch(/does not match/);
    expect(validatePaymentQuote(quote, buyer, stablecoin, stablecoin, settlement, 1000)).toMatch(/does not match/);
    expect(validatePaymentQuote(quote, buyer, asset, asset, settlement, 1000)).toMatch(/does not match/);
    expect(validatePaymentQuote(quote, buyer, asset, stablecoin, asset, 1000)).toMatch(/does not match/);
    expect(validatePaymentQuote({ ...quote, quote: { ...quote.quote, chainId: 196 } }, buyer, asset, stablecoin, settlement, 1000)).toMatch(/does not match/);
    expect(validatePaymentQuote(quote, buyer, asset, stablecoin, settlement, 1470)).toMatch(/expiry/);
  });

  it('approves only when the existing allowance is insufficient', () => {
    expect(needsApproval(79n, 80n)).toBe(true);
    expect(needsApproval(80n, 80n)).toBe(false);
    expect(needsApproval(81n, 80n)).toBe(false);
  });
});
