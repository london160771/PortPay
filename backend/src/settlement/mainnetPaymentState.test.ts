import { describe, expect, it } from 'vitest';
import {
  assertMainnetPaymentStateTransition,
  canTransitionMainnetPaymentState,
} from './mainnetPaymentState.js';

describe('mainnet payment state design', () => {
  it('allows preparation through canonical confirmation without changing testnet invoice states', () => {
    expect(canTransitionMainnetPaymentState('pending', 'prepared')).toBe(true);
    expect(canTransitionMainnetPaymentState('prepared', 'ready')).toBe(true);
    expect(canTransitionMainnetPaymentState('ready', 'submitted')).toBe(true);
    expect(canTransitionMainnetPaymentState('submitted', 'confirming')).toBe(true);
    expect(canTransitionMainnetPaymentState('confirming', 'paid')).toBe(true);
  });

  it('rejects skipping verification or reopening terminal states', () => {
    expect(canTransitionMainnetPaymentState('pending', 'paid')).toBe(false);
    expect(canTransitionMainnetPaymentState('paid', 'pending')).toBe(false);
    expect(() => assertMainnetPaymentStateTransition('pending', 'paid')).toThrow('Invalid mainnet payment state transition');
  });
});
