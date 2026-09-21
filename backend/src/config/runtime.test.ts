import { describe, expect, it } from 'vitest';
import {
  createMerchantAuthConfig,
  findMerchantApiCredential,
  findMerchantCredentialByAddress,
  resolveRuntimeUrl,
  validateWebhookUrl,
} from './runtime.js';

describe('production URL configuration', () => {
  it('does not generate localhost payment links or CORS defaults when production URLs are missing', () => {
    expect(resolveRuntimeUrl('PUBLIC_APP_URL', undefined, false)).toBe('http://localhost:5173');
    expect(resolveRuntimeUrl('PUBLIC_APP_URL', 'https://pay.example.test/', true)).toBe('https://pay.example.test');
    expect(() => resolveRuntimeUrl('PUBLIC_APP_URL', undefined, true)).toThrow('PUBLIC_APP_URL is required');
    expect(() => resolveRuntimeUrl('CORS_ORIGIN', undefined, true)).toThrow('CORS_ORIGIN is required');
  });
});

describe('server-side merchant API credentials', () => {
  const merchantAddress = '0x815c2fb8178f0bf80ada8c5b97ff44ece90e6e25';
  const apiKey = 'test_key_only_on_backend_123456789';
  const webhookSecret = 'webhook_secret_only_on_backend_1234';

  it('loads test credentials without exposing them to frontend configuration', () => {
    const config = createMerchantAuthConfig({
      PORTPAY_TEST_API_KEY: apiKey,
      PORTPAY_TEST_MERCHANT_ADDRESS: merchantAddress,
      PORTPAY_TEST_WEBHOOK_URL: 'https://merchant.example.test/portpay',
      PORTPAY_TEST_WEBHOOK_SECRET: webhookSecret,
    });

    expect(config.credentials).toHaveLength(1);
    expect(config.credentials[0]).toMatchObject({
      environment: 'test',
      merchantAddress,
      webhookUrl: 'https://merchant.example.test/portpay',
    });
    expect(findMerchantApiCredential(`Bearer ${apiKey}`, config)?.merchantAddress).toBe(merchantAddress);
    expect(findMerchantCredentialByAddress(merchantAddress.toUpperCase(), config)?.environment).toBe('test');
  });

  it('rejects malformed or missing credentials', () => {
    expect(() => createMerchantAuthConfig({
      PORTPAY_TEST_API_KEY: ' ',
      PORTPAY_TEST_MERCHANT_ADDRESS: 'not-a-wallet',
    })).toThrow('must contain at least 32 characters');

    const config = createMerchantAuthConfig({});
    expect(config.credentials).toHaveLength(0);
    expect(findMerchantApiCredential('Bearer wrong', config)).toBeUndefined();
    expect(validateWebhookUrl('https://merchant.example.test/portpay')).toBe('https://merchant.example.test/portpay');
    expect(() => validateWebhookUrl('http://127.0.0.1/internal')).toThrow('must use HTTPS');
    expect(() => validateWebhookUrl('https://localhost/internal')).toThrow('must use HTTPS');
  });
});
