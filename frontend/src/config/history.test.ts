import { describe, expect, it } from 'vitest';
import type { Invoice } from './api';
import {
  formatPaymentTimestamp,
  formatReceivedAmount,
  formatSpentAmount,
  getExplorerTransactionUrl,
  hasVerifiedPaymentEvidence,
} from './history';

const paidInvoice: Invoice = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Live Phase 3 test',
  amountUsdt0: '1',
  merchantAddress: '0x815c2fb8178f0bf80ada8c5b97ff44ece90e6e25',
  paymentUrl: 'http://localhost:5173/invoice/00000000-0000-4000-8000-000000000001',
  status: 'paid',
  createdAt: '2026-09-20T16:40:00.000Z',
  updatedAt: '2026-09-20T16:47:50.246Z',
  paymentTxHash: '0x452381c8774aae0f277688aa8a3e640a57e29726d45644dcfb64894854ba66be',
  paidAt: '2026-09-20T16:47:50.246Z',
  buyerAddress: '0xbabdfef588cf57efcc7c8857960e3ccdd9167589',
  spentAsset: '0x756546fce7d7ca3bb4be127904b002baf13b432e',
  spentAmount: '4000000000000000',
  stablecoinReceived: '1',
  quoteId: '0x10b0d1f6c4c2f7b36c4fef0f7a6a7767c7e2c23d649fdfb3e1fcb0e2f6bfd340',
  settlementContract: '0xc0b34a6e0858815e7e176a0bcf15f223b1154a04',
  settlementBlockNumber: '41464046',
};

describe('payment history formatting', () => {
  it('formats the live DemoAAPL amount and USD₮0 receipt', () => {
    expect(formatSpentAmount(paidInvoice)).toBe('0.004 DemoAAPL');
    expect(formatReceivedAmount(paidInvoice)).toBe('1 USD₮0');
    expect(hasVerifiedPaymentEvidence(paidInvoice)).toBe(true);
  });

  it('keeps mainnet asset names and explorer URLs separate from historical testnet receipts', () => {
    const mainnetInvoice: Invoice = {
      ...paidInvoice,
      paymentNetwork: 'x-layer-mainnet',
      spentAsset: '0xa8ddb5cd96b5222afe198316e9a57caa642850d5',
      spentAmount: '4800000000000000',
    };
    expect(formatSpentAmount(mainnetInvoice)).toBe('0.0048 wNVDAx');
    expect(getExplorerTransactionUrl(mainnetInvoice.paymentTxHash, mainnetInvoice.paymentNetwork))
      .toContain('/web3/explorer/xlayer/tx/');
    expect(getExplorerTransactionUrl(paidInvoice.paymentTxHash, 'x-layer-testnet'))
      .toContain('/web3/explorer/xlayer-test/tx/');
  });

  it('rejects unsafe or incomplete transaction evidence', () => {
    expect(getExplorerTransactionUrl(undefined)).toBeUndefined();
    expect(getExplorerTransactionUrl('0x123')).toBeUndefined();
    expect(hasVerifiedPaymentEvidence({ ...paidInvoice, paymentTxHash: '0x123' })).toBe(false);
    expect(formatSpentAmount({ ...paidInvoice, spentAmount: 'not-base-units' })).toBe('Amount unavailable');
    expect(formatPaymentTimestamp('not-a-date')).toBe('Timestamp unavailable');
  });

  it('formats numeric receipt values returned by a database runtime', () => {
    expect(formatReceivedAmount({ ...paidInvoice, stablecoinReceived: 1 as unknown as string }))
      .toBe('1 USD₮0');
  });

  it('formats very large base-unit amounts from exact strings without precision loss', () => {
    const largeBaseUnits = '90071992547409930000000000000000000000';
    expect(formatSpentAmount({ ...paidInvoice, spentAmount: largeBaseUnits }))
      .toBe('90071992547409930000 DemoAAPL');
    expect(formatSpentAmount({ ...paidInvoice, spentAmount: Number.MAX_SAFE_INTEGER as unknown as string }))
      .toBe('Amount unavailable');
  });
});
