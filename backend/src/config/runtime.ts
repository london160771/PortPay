import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

const envValue = (name: string, fallback = '') => process.env[name]?.trim() || fallback;

export type MerchantCredential = {
  environment: 'test';
  apiKey: string;
  merchantAddress: string;
  webhookUrl?: string;
  webhookSecret?: string;
};

export type MerchantAuthConfig = {
  credentials: readonly MerchantCredential[];
};

const WALLET_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function isPrivateWebhookHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) return true;
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (isIP(normalized) === 6) {
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fe8')
      || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')
      || normalized.startsWith('fc') || normalized.startsWith('fd')
      || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.')
      || normalized.startsWith('::ffff:192.168.');
  }
  return false;
}

export function validateWebhookUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PORTPAY_TEST_WEBHOOK_URL must be a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || isPrivateWebhookHostname(url.hostname)) {
    throw new Error('PORTPAY_TEST_WEBHOOK_URL must use HTTPS and must not target a local or private address.');
  }
  return url.toString();
}

function credentialFromEnv(env: NodeJS.ProcessEnv): MerchantCredential | undefined {
  const prefix = 'PORTPAY_TEST';
  const apiKey = env[`${prefix}_API_KEY`]?.trim();
  const merchantAddress = env[`${prefix}_MERCHANT_ADDRESS`]?.trim().toLowerCase();
  if (!apiKey && !merchantAddress) return undefined;
  if (!apiKey || apiKey.length < 32 || !merchantAddress || !WALLET_ADDRESS_PATTERN.test(merchantAddress)) {
    throw new Error('PORTPAY_TEST_API_KEY must contain at least 32 characters and PORTPAY_TEST_MERCHANT_ADDRESS must be valid.');
  }

  const configuredWebhookUrl = env[`${prefix}_WEBHOOK_URL`]?.trim();
  const webhookSecret = env[`${prefix}_WEBHOOK_SECRET`]?.trim();
  if (Boolean(configuredWebhookUrl) !== Boolean(webhookSecret) || (webhookSecret && webhookSecret.length < 32)) {
    throw new Error('PORTPAY_TEST_WEBHOOK_URL and PORTPAY_TEST_WEBHOOK_SECRET must be configured together with a secret of at least 32 characters.');
  }
  const webhookUrl = configuredWebhookUrl ? validateWebhookUrl(configuredWebhookUrl) : undefined;
  return {
    environment: 'test',
    apiKey,
    merchantAddress,
    ...(webhookUrl ? { webhookUrl } : {}),
    ...(webhookSecret ? { webhookSecret } : {}),
  };
}

export function createMerchantAuthConfig(env: NodeJS.ProcessEnv = process.env): MerchantAuthConfig {
  return {
    credentials: [credentialFromEnv(env)].filter(
      (credential): credential is MerchantCredential => Boolean(credential),
    ),
  };
}

export function findMerchantApiCredential(
  authorization: string | undefined,
  config: MerchantAuthConfig,
): MerchantCredential | undefined {
  if (!authorization?.startsWith('Bearer ')) return undefined;
  const apiKey = authorization.slice('Bearer '.length).trim();
  if (!apiKey) return undefined;
  return config.credentials.find((credential) => {
    const expected = Buffer.from(credential.apiKey);
    const provided = Buffer.from(apiKey);
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  });
}

export function findMerchantCredentialByAddress(
  merchantAddress: string,
  config: MerchantAuthConfig,
): MerchantCredential | undefined {
  return config.credentials.find((credential) => credential.merchantAddress === merchantAddress.toLowerCase());
}

export function resolveRuntimeUrl(name: 'PUBLIC_APP_URL' | 'CORS_ORIGIN', value: string | undefined, production: boolean): string {
  const url = value?.trim();
  if (!url && production) throw new Error(`${name} is required in production.`);
  return (url || 'http://localhost:5173').replace(/\/$/, '');
}

export const runtimeConfig = {
  publicAppUrl: resolveRuntimeUrl('PUBLIC_APP_URL', envValue('PUBLIC_APP_URL'), process.env.NODE_ENV === 'production'),
  corsOrigin: resolveRuntimeUrl('CORS_ORIGIN', envValue('CORS_ORIGIN'), process.env.NODE_ENV === 'production'),
  merchantAuth: createMerchantAuthConfig(),
} as const;
