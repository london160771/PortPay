import { describe, expect, it } from 'vitest';
import { xLayerTestnet } from './xlayer.js';

describe('X Layer Testnet backend config', () => {
  it('uses chain ID 1952 and OKB gas', () => {
    expect(xLayerTestnet.chainId).toBe(1952);
    expect(xLayerTestnet.nativeCurrency).toBe('OKB');
  });

  it('has a testnet RPC and explorer default', () => {
    expect(xLayerTestnet.rpcUrl).toMatch(/^https:\/\//);
    expect(xLayerTestnet.explorerUrl).toContain('xlayer-test');
  });
});
