import { describe, expect, it } from 'vitest';
import {
  portPayNetworkConfig,
  mainnetNetworkConfig,
  VERIFIED_TESTNET_USDT0_ADDRESS,
  VERIFIED_MAINNET_WNVDA_ADDRESS,
  VERIFIED_MAINNET_USDT0_ADDRESS,
  xLayerMainnet,
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

  it('keeps opt-in mainnet approval configuration isolated on chain 196', () => {
    expect(xLayerMainnet.id).toBe(196);
    expect(mainnetNetworkConfig.chainId).toBe(196);
    expect(mainnetNetworkConfig.wNvdaAddress).toBe(VERIFIED_MAINNET_WNVDA_ADDRESS);
    expect(mainnetNetworkConfig.usdt0Address).toBe(VERIFIED_MAINNET_USDT0_ADDRESS);
    expect(mainnetNetworkConfig.wNvdaAddress).not.toBe(portPayNetworkConfig.demoAssetAddresses.demoNvda);
    expect(mainnetNetworkConfig.usdt0Address).not.toBe(portPayNetworkConfig.stablecoinAddress);
  });
});
