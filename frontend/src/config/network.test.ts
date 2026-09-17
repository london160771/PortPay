import { describe, expect, it } from 'vitest';
import {
  portPayNetworkConfig,
  VERIFIED_TESTNET_USDT0_ADDRESS,
  xLayerTestnet,
} from './network';

describe('X Layer Testnet foundation config', () => {
  it('uses the canonical testnet chain identity', () => {
    expect(xLayerTestnet.id).toBe(1952);
    expect(xLayerTestnet.nativeCurrency.symbol).toBe('OKB');
  });

  it('exposes reusable explorer and RPC settings', () => {
    expect(portPayNetworkConfig.rpcUrl).toMatch(/^https:\/\//);
    expect(portPayNetworkConfig.explorerUrl).toContain('xlayer-test');
  });

  it('uses the officially documented X Layer Testnet USD₮0 address', () => {
    expect(portPayNetworkConfig.stablecoinAddress).toBe(VERIFIED_TESTNET_USDT0_ADDRESS);
  });
});
