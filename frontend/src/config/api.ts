export type InvoiceStatus = 'pending' | 'paid';

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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const backendUrl = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${backendUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError('Unable to reach the PortPay backend.', 0);
  }

  const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    throw new ApiError(body.error || 'The PortPay backend returned an error.', response.status);
  }

  return body;
}

export function createInvoice(input: {
  title: string;
  amountUsdt0: string;
  merchantAddress: string;
}): Promise<{ invoice: Invoice }> {
  return request<{ invoice: Invoice }>('/api/invoices', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getMerchantInvoices(merchantAddress: string): Promise<{ invoices: Invoice[] }> {
  return request<{ invoices: Invoice[] }>(
    `/api/invoices?merchantAddress=${encodeURIComponent(merchantAddress)}`,
  );
}

export function getInvoice(invoiceId: string): Promise<{ invoice: Invoice }> {
  return request<{ invoice: Invoice }>(`/api/invoices/${encodeURIComponent(invoiceId)}`);
}
