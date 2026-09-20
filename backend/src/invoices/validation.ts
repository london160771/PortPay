export class InvoiceValidationError extends Error {
  readonly code = 'invalid_invoice';

  constructor(message: string) {
    super(message);
    this.name = 'InvoiceValidationError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WALLET_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const TRANSACTION_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

export type CreateInvoiceInput = {
  title: string;
  amountUsdt0: string;
  merchantAddress: string;
};

export type SmartSpendMetadataInput = {
  smartSpendUsed: boolean;
  smartSpendRecommendedAsset?: 'demoAapl' | 'demoNvda';
  smartSpendReason?: string;
};

export function validateInvoiceId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new InvoiceValidationError('Invoice ID must be a valid UUID.');
  }

  return value.toLowerCase();
}

export function validateMerchantAddress(value: unknown): string {
  return validateWalletAddress(value, 'Merchant wallet');
}

export function validateWalletAddress(value: unknown, label = 'Wallet'): string {
  if (typeof value !== 'string' || !WALLET_ADDRESS_PATTERN.test(value.trim())) {
    throw new InvoiceValidationError(`${label} address must be a valid EVM address.`);
  }

  return value.trim().toLowerCase();
}

export function validateTransactionHash(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !TRANSACTION_HASH_PATTERN.test(value.trim())) {
    throw new InvoiceValidationError('Transaction hash must be a valid 32-byte hash.');
  }

  return value.trim().toLowerCase() as `0x${string}`;
}

export function validateSmartSpendMetadata(input: unknown): SmartSpendMetadataInput {
  const body = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const smartSpendUsed = body.smartSpendUsed === true;
  if (!smartSpendUsed) return { smartSpendUsed: false };

  const recommendedAsset = body.smartSpendRecommendedAsset;
  if (recommendedAsset !== 'demoAapl' && recommendedAsset !== 'demoNvda') {
    throw new InvoiceValidationError('Smart Spend metadata must include a supported recommended asset.');
  }

  const reason = typeof body.smartSpendReason === 'string' ? body.smartSpendReason.trim() : '';
  if (!reason || reason.length > 240) {
    throw new InvoiceValidationError('Smart Spend reason must be between 1 and 240 characters.');
  }

  return {
    smartSpendUsed: true,
    smartSpendRecommendedAsset: recommendedAsset,
    smartSpendReason: reason,
  };
}

export function validateCreateInvoiceInput(input: unknown): CreateInvoiceInput {
  if (!input || typeof input !== 'object') {
    throw new InvoiceValidationError('Invoice body must be an object.');
  }

  const body = input as Record<string, unknown>;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) throw new InvoiceValidationError('Invoice title is required.');
  if (title.length > 120) throw new InvoiceValidationError('Invoice title must be 120 characters or fewer.');

  const amountValue = body.amountUsdt0;
  const amount = typeof amountValue === 'string' ? amountValue.trim() : String(amountValue ?? '').trim();
  if (!AMOUNT_PATTERN.test(amount)) {
    throw new InvoiceValidationError('Amount must be a positive USD₮0 value with up to 6 decimals.');
  }

  const [whole, fraction = ''] = amount.split('.');
  const normalizedFraction = fraction.replace(/0+$/, '');
  const normalizedAmount = normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
  if (normalizedAmount === '0' || !/[1-9]/.test(normalizedAmount) || whole.length > 32) {
    throw new InvoiceValidationError('Amount must be greater than zero and fit the USD₮0 precision.');
  }

  return {
    title,
    amountUsdt0: normalizedAmount,
    merchantAddress: validateMerchantAddress(body.merchantAddress),
  };
}
