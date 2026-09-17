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
};

export interface InvoiceRepository {
  create(invoice: Invoice): Promise<Invoice>;
  findById(id: string): Promise<Invoice | null>;
  listByMerchant(merchantAddress: string): Promise<Invoice[]>;
}
