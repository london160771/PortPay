export type InvoiceStatus = 'pending' | 'paid';
export type PaymentNetwork = 'x-layer-testnet' | 'x-layer-mainnet';

export type Invoice = {
  id: string;
  title: string;
  amountUsdt0: string;
  merchantAddress: string;
  paymentUrl: string;
  status: InvoiceStatus;
  paymentNetwork?: PaymentNetwork;
  mainnetAttemptStatus?: 'none' | 'unresolved' | 'submitted';
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
  smartSpendUsed?: boolean;
  smartSpendRecommendedAsset?: 'demoAapl' | 'demoNvda';
  smartSpendReason?: string;
};

export type SettlementQuote = {
  invoiceId: string;
  assetKey: 'demoAapl' | 'demoNvda';
  invoiceIdHash: `0x${string}`;
  quote: {
    invoiceId: `0x${string}`;
    buyer: `0x${string}`;
    merchant: `0x${string}`;
    asset: `0x${string}`;
    assetAmount: string;
    stablecoin: `0x${string}`;
    stablecoinAmount: string;
    chainId: number;
    settlementContract: `0x${string}`;
    expiry: string;
  };
  quoteId: `0x${string}`;
  signature: `0x${string}`;
  assetDecimals: number;
  stablecoinDecimals: number;
  assetAmount: string;
  stablecoinAmount: string;
  referencePriceUsd: string;
  expiresAt: string;
};

export type MainnetApprovalPreparation = {
  preparationId: string;
  preparationHash: `0x${string}`;
  invoiceId: string;
  buyer: `0x${string}`;
  merchant: `0x${string}`;
  chainId: 196;
  token: `0x${string}`;
  outputToken: `0x${string}`;
  spender: `0x${string}`;
  amount: string;
  minimumReceive: string;
  nativeValue: string;
  approvalCalldata: `0x${string}`;
  attributedApprovalCalldata: `0x${string}`;
  dataSuffix: `0x${string}`;
  builderCode: string;
  expiresAt: string;
  preparationBlockNumber: string;
  snapshotAllowance: string;
  handoffMessage?: string;
};

export type MainnetApprovalPreparationResponse = {
  status: string;
  reason: string;
  preparation?: MainnetApprovalPreparation;
  existingPayment?: {
    preparationId: string;
    handoffId: string;
    buyer: `0x${string}`;
    transactionHash?: `0x${string}`;
  };
};

export type MainnetReadinessRecheckResponse = {
  status: string;
  ready: boolean;
  reason: string;
  preparationId: string;
  preparationHash?: `0x${string}`;
  expiresAt?: string;
  handoffId?: string;
  handoffStartedAt?: string;
  transactionHash?: `0x${string}`;
  checkedAt: string;
  walletTransaction?: {
    from: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    value: string;
    chainId: 196;
  };
};

export type MainnetSubmissionResponse = {
  status: 'submitted';
  preparationId: string;
  handoffId: string;
  transactionHash: `0x${string}`;
  submittedAt: string;
  expiresAt: string;
};

export type MainnetSubmissionRecoveryResponse = {
  submission: MainnetSubmissionResponse | null;
};

export type MainnetReconciliationResponse = {
  invoice?: Invoice;
  code?: string;
  error?: string;
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

export function resolveBackendUrl(configuredUrl: string | undefined, production: boolean): string {
  const url = configuredUrl?.trim();
  if (!url && production) throw new ApiError('VITE_BACKEND_URL is required for a production build.', 0);
  return (url || 'http://localhost:3001').replace(/\/$/, '');
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const backendUrl = resolveBackendUrl(import.meta.env.VITE_BACKEND_URL, import.meta.env.PROD);
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

export function getMerchantPaymentHistory(merchantAddress: string): Promise<{ payments: Invoice[] }> {
  return request<{ payments: Invoice[] }>(
    `/api/history/merchant?merchantAddress=${encodeURIComponent(merchantAddress)}`,
  );
}

export function getBuyerPaymentHistory(buyerAddress: string): Promise<{ payments: Invoice[] }> {
  return request<{ payments: Invoice[] }>(
    `/api/history/buyer?buyerAddress=${encodeURIComponent(buyerAddress)}`,
  );
}

export function getInvoice(invoiceId: string): Promise<{ invoice: Invoice }> {
  return request<{ invoice: Invoice }>(`/api/invoices/${encodeURIComponent(invoiceId)}`);
}

export function createSettlementQuote(
  invoiceId: string,
  buyerAddress: string,
  assetKey: 'demoAapl' | 'demoNvda' = 'demoAapl',
): Promise<{ quote: SettlementQuote }> {
  return request<{ quote: SettlementQuote }>(`/api/invoices/${encodeURIComponent(invoiceId)}/quote`, {
    method: 'POST',
    body: JSON.stringify({ buyerAddress, assetKey }),
  });
}

export function prepareMainnetApproval(
  invoiceId: string,
  buyerAddress: string,
): Promise<MainnetApprovalPreparationResponse> {
  return request<MainnetApprovalPreparationResponse>(`/api/invoices/${encodeURIComponent(invoiceId)}/mainnet/approval-preparation`, {
    method: 'POST',
    body: JSON.stringify({ buyerAddress }),
  });
}

export function recheckMainnetReadiness(
  invoiceId: string,
  preparationId: string,
  buyerAddress: string,
  buyerSignature: string,
): Promise<MainnetReadinessRecheckResponse> {
  return request<MainnetReadinessRecheckResponse>(`/api/invoices/${encodeURIComponent(invoiceId)}/mainnet/readiness-recheck`, {
    method: 'POST',
    body: JSON.stringify({ preparationId, buyerAddress, buyerSignature }),
  });
}

export function preflightMainnetReadiness(
  invoiceId: string,
  preparationId: string,
  buyerAddress: string,
): Promise<MainnetReadinessRecheckResponse> {
  return request<MainnetReadinessRecheckResponse>(`/api/invoices/${encodeURIComponent(invoiceId)}/mainnet/readiness-recheck`, {
    method: 'POST',
    body: JSON.stringify({ preparationId, buyerAddress, preflightOnly: true }),
  });
}

export function recordMainnetSubmission(
  invoiceId: string,
  preparationId: string,
  handoffId: string,
  transactionHash: string,
): Promise<MainnetSubmissionResponse> {
  return request<MainnetSubmissionResponse>(`/api/invoices/${encodeURIComponent(invoiceId)}/mainnet/submitted`, {
    method: 'POST',
    body: JSON.stringify({ preparationId, handoffId, txHash: transactionHash }),
  });
}

export function recoverMainnetSubmission(
  invoiceId: string,
  preparationId: string,
  buyerAddress: string,
): Promise<MainnetSubmissionRecoveryResponse> {
  return request<MainnetSubmissionRecoveryResponse>(`/api/invoices/${encodeURIComponent(invoiceId)}/mainnet/submission-recovery`, {
    method: 'POST',
    body: JSON.stringify({ preparationId, buyerAddress }),
  });
}

export function reconcileMainnetPayment(
  invoiceId: string,
  preparationId: string,
  transactionHash: string,
): Promise<MainnetReconciliationResponse> {
  return request<MainnetReconciliationResponse>(`/api/invoices/${encodeURIComponent(invoiceId)}/mainnet/reconcile`, {
    method: 'POST',
    body: JSON.stringify({ preparationId, txHash: transactionHash }),
  });
}

export function reconcileInvoicePayment(
  invoiceId: string,
  input: {
    txHash: string;
    buyerAddress: string;
    smartSpendUsed?: boolean;
    smartSpendRecommendedAsset?: 'demoAapl' | 'demoNvda';
    smartSpendReason?: string;
  },
): Promise<{ invoice: Invoice }> {
  return request<{ invoice: Invoice }>(`/api/invoices/${encodeURIComponent(invoiceId)}/reconcile`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
