export const invoiceStatuses = ['pending', 'paid'] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

export type Invoice = {
  id: string;
  title: string;
  amountUsdt0: string;
  merchantAddress: string;
  paymentUrl: string;
  status: InvoiceStatus;
  createdAt: string;
  updatedAt: string;
  paymentTxHash?: string;
  paidAt?: string;
  buyerAddress?: string;
  spentAsset?: string;
  spentAmount?: string;
  stablecoinReceived?: string;
  quoteId?: string;
  settlementContract?: string;
  settlementBlockNumber?: string;
};

export type PaymentEvidence = {
  paymentTxHash: string;
  paidAt: string;
  buyerAddress: string;
  spentAsset: string;
  spentAmount: string;
  stablecoinReceived: string;
  quoteId: string;
  settlementContract: string;
  settlementBlockNumber: string;
};

export interface InvoiceRepository {
  create(invoice: Invoice): Promise<Invoice>;
  findById(id: string): Promise<Invoice | null>;
  listByMerchant(merchantAddress: string): Promise<Invoice[]>;
  listPaidByMerchant(merchantAddress: string): Promise<Invoice[]>;
  listPaidByBuyer(buyerAddress: string): Promise<Invoice[]>;
  markPaid(id: string, evidence: PaymentEvidence): Promise<Invoice | null>;
}
