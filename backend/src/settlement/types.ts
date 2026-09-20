import type { Address, Hex } from 'viem';
import type { Invoice, InvoiceRepository, PaymentEvidence } from '../invoices/types.js';

export type SettlementQuoteData = {
  invoiceId: Hex;
  buyer: Address;
  merchant: Address;
  asset: Address;
  assetAmount: string;
  stablecoin: Address;
  stablecoinAmount: string;
  chainId: number;
  settlementContract: Address;
  expiry: string;
};

export type SettlementQuoteResponse = {
  invoiceId: string;
  assetKey: 'demoAapl' | 'demoNvda';
  invoiceIdHash: Hex;
  quote: SettlementQuoteData;
  quoteId: Hex;
  signature: Hex;
  assetDecimals: number;
  stablecoinDecimals: number;
  assetAmount: string;
  stablecoinAmount: string;
  referencePriceUsd: string;
  expiresAt: string;
};

export type ReconcilePaymentInput = {
  txHash: Hex;
  buyerAddress: Address;
  smartSpendUsed?: boolean;
  smartSpendRecommendedAsset?: 'demoAapl' | 'demoNvda';
  smartSpendReason?: string;
};

export type SettlementAdapter = {
  readonly name: 'TestnetSettlementAdapter' | 'OKXDEXMainnetAdapter';
  createQuote(invoice: Invoice, buyerAddress: string, assetKey?: string): Promise<SettlementQuoteResponse>;
  reconcilePayment(invoice: Invoice, input: ReconcilePaymentInput): Promise<PaymentEvidence>;
};

export type SettlementAdapterDependencies = {
  invoiceRepository?: InvoiceRepository;
};

export class SettlementError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'SettlementError';
    this.code = code;
  }
}

export class SettlementNotConfiguredError extends SettlementError {
  constructor(message = 'Testnet settlement is not configured yet.') {
    super(message, 'settlement_not_configured');
    this.name = 'SettlementNotConfiguredError';
  }
}

export class SettlementQuoteError extends SettlementError {
  constructor(message: string) {
    super(message, 'invalid_settlement_quote');
    this.name = 'SettlementQuoteError';
  }
}

export class SettlementVerificationError extends SettlementError {
  constructor(message: string) {
    super(message, 'settlement_verification_failed');
    this.name = 'SettlementVerificationError';
  }
}

export class InvoiceNotPayableError extends SettlementError {
  constructor() {
    super('This invoice is already paid and cannot be paid again.', 'invoice_not_payable');
    this.name = 'InvoiceNotPayableError';
  }
}
