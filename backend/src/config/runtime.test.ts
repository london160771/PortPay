import { describe, expect, it } from 'vitest';
import { resolveRuntimeUrl } from './runtime.js';

describe('production URL configuration', () => {
  it('does not generate localhost payment links or CORS defaults when production URLs are missing', () => {
    expect(resolveRuntimeUrl('PUBLIC_APP_URL', undefined, false)).toBe('http://localhost:5173');
    expect(resolveRuntimeUrl('PUBLIC_APP_URL', 'https://pay.example.test/', true)).toBe('https://pay.example.test');
    expect(() => resolveRuntimeUrl('PUBLIC_APP_URL', undefined, true)).toThrow('PUBLIC_APP_URL is required');
    expect(() => resolveRuntimeUrl('CORS_ORIGIN', undefined, true)).toThrow('CORS_ORIGIN is required');
  });
});
