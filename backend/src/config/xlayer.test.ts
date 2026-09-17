import { describe, expect, it } from 'vitest';
import {
  portPayAddressConfig,
  VERIFIED_TESTNET_USDT0_ADDRESS,
  xLayerTestnet,
} from './xlayer.js';

describe('X Layer Testnet backend config', () => {
  it('uses chain ID 1952 and OKB gas', () => {
    expect(xLayerTestnet.chainId).toBe(1952);
    expect(xLayerTestnet.nativeCurrency).toBe('OKB');
  });

  it('has a testnet RPC and explorer default', () => {
    expect(xLayerTestnet.rpcUrl).toMatch(/^https:\/\//);
    expect(xLayerTestnet.explorerUrl).toContain('xlayer-test');
  });

  it('uses the verified official testnet USD₮0 address by default', () => {
    expect(portPayAddressConfig.testnetUsdt0).toBe(VERIFIED_TESTNET_USDT0_ADDRESS);
  });
});
