import { describe, expect, it } from 'vitest';
import { getWalletNetworkState, shortenAddress } from './wallet';

describe('wallet network state', () => {
  it('distinguishes disconnected, ready, and wrong-network states', () => {
    expect(getWalletNetworkState(false, undefined)).toBe('disconnected');
    expect(getWalletNetworkState(true, 1952)).toBe('ready');
    expect(getWalletNetworkState(true, 1)).toBe('wrong-network');
  });

  it('shortens wallet addresses for display', () => {
    expect(shortenAddress('0x1234567890123456789012345678901234567890')).toBe('0x1234…7890');
  });
});
