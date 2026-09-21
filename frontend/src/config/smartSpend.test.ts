import { describe, expect, it } from 'vitest';
import {
  calculateRequiredAssetAmount,
  formatAllocationPercent,
  recommendSmartSpend,
  snapshotSmartSpendChoice,
} from './smartSpend';

const invoice = { amountUsdt0: '1' } as const;

describe('deterministic Smart Spend', () => {
  it('prefers the eligible overweight asset and explains the deviation', () => {
    const result = recommendSmartSpend(
      [
        { key: 'demoAapl', balance: 1n * 10n ** 18n, decimals: 18 },
        { key: 'demoNvda', balance: 2n * 10n ** 18n, decimals: 18 },
      ],
      invoice,
      6,
    );

    expect(result.assetKey).toBe('demoNvda');
    expect(result.reason).toContain('Recommended DemoNVDA');
    expect(result.reason).toContain('above your target allocation');
    expect(formatAllocationPercent(result.allocations[1].currentAllocationBps)).toBe('59%');
  });

  it('does not choose an underweight asset when an overweight asset can cover', () => {
    const result = recommendSmartSpend(
      [
        { key: 'demoAapl', balance: 1n * 10n ** 18n, decimals: 18 },
        { key: 'demoNvda', balance: 2n * 10n ** 18n, decimals: 18 },
      ],
      invoice,
      6,
      { demoAapl: 2_000, demoNvda: 8_000 },
    );

    expect(result.assetKey).toBe('demoAapl');
  });

  it('handles insufficient balances and rounds the required asset amount up', () => {
    const result = recommendSmartSpend(
      [
        { key: 'demoAapl', balance: 1n, decimals: 18 },
        { key: 'demoNvda', balance: 1n, decimals: 18 },
      ],
      invoice,
      6,
    );

    expect(result.assetKey).toBeUndefined();
    expect(result.reason).toContain('enough balance');
    expect(calculateRequiredAssetAmount('1', '180.00', 6, 18)).toBe(5_555_555_555_555_556n);
  });

  it('retains the applied choice and reason when a later balance read changes the recommendation', () => {
    const initial = recommendSmartSpend(
      [
        { key: 'demoAapl', balance: 1n * 10n ** 18n, decimals: 18 },
        { key: 'demoNvda', balance: 2n * 10n ** 18n, decimals: 18 },
      ], invoice, 6,
    );
    const applied = snapshotSmartSpendChoice(initial);
    const refreshed = recommendSmartSpend(
      [
        { key: 'demoAapl', balance: 1n * 10n ** 18n, decimals: 18 },
        { key: 'demoNvda', balance: 0n, decimals: 18 },
      ], invoice, 6,
    );

    expect(initial.assetKey).toBe('demoNvda');
    expect(refreshed.assetKey).toBe('demoAapl');
    expect(applied).toEqual({ assetKey: 'demoNvda', reason: initial.reason });
    expect(snapshotSmartSpendChoice({ ...refreshed, assetKey: undefined })).toBeUndefined();
  });
});
