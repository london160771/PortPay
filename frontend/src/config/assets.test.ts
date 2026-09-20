import { describe, expect, it } from 'vitest';
import { formatTokenBalance, parseConfiguredAddress, testnetAssets } from './assets';

describe('Phase 1 asset configuration', () => {
  it('labels DemoAAPL as a test asset', () => {
    expect(testnetAssets.demoAapl.description).toContain('not an official xStock');
  });

  it('labels DemoNVDA as a separate test asset', () => {
    expect(testnetAssets.demoNvda.description).toContain('not an official xStock');
    expect(testnetAssets.demoNvda.description).toContain('real NVIDIA-backed');
  });

  it('formats balances using the token-reported decimal precision', () => {
    expect(formatTokenBalance(1234567n, 6)).toBe('1.234567');
    expect(formatTokenBalance(1500000000000000000n, 18)).toBe('1.5');
  });

  it('rejects an unset or malformed contract address', () => {
    expect(parseConfiguredAddress('')).toBeUndefined();
    expect(parseConfiguredAddress('not-an-address')).toBeUndefined();
  });
});
