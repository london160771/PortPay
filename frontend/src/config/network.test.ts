import { describe, expect, it } from 'vitest';
import {
  portPayNetworkConfig,
  internalTestnetNetworkConfig,
  mainnetNetworkConfig,
  VERIFIED_TESTNET_USDT0_ADDRESS,
  VERIFIED_MAINNET_WNVDA_ADDRESS,
  VERIFIED_MAINNET_USDT0_ADDRESS,
  xLayerMainnet,
  xLayerTestnet,
} from './network';

describe('PortPay product and internal network config', () => {
  it('uses X Layer Mainnet as the unqualified product network', () => {
    expect(portPayNetworkConfig.chainId).toBe(196);
    expect(portPayNetworkConfig.explorerUrl).toBe(mainnetNetworkConfig.explorerUrl);
    expect(portPayNetworkConfig.usdt0Address).toBe(VERIFIED_MAINNET_USDT0_ADDRESS);
  });

  it('retains the canonical testnet chain identity only in internal configuration', () => {
    expect(xLayerTestnet.id).toBe(1952);
    expect(xLayerTestnet.nativeCurrency.symbol).toBe('OKB');
  });

  it('keeps internal testnet explorer and RPC settings explicitly isolated', () => {
    expect(internalTestnetNetworkConfig.rpcUrl).toMatch(/^https:\/\//);
    expect(internalTestnetNetworkConfig.explorerUrl).toContain('xlayer-test');
  });

  it('uses the officially documented X Layer Testnet USD₮0 address', () => {
    expect(internalTestnetNetworkConfig.stablecoinAddress).toBe(VERIFIED_TESTNET_USDT0_ADDRESS);
  });

  it('keeps mainnet assets distinct from all internal testnet token addresses', () => {
    expect(xLayerMainnet.id).toBe(196);
    expect(mainnetNetworkConfig.chainId).toBe(196);
    expect(mainnetNetworkConfig.wNvdaAddress).toBe(VERIFIED_MAINNET_WNVDA_ADDRESS);
    expect(mainnetNetworkConfig.usdt0Address).toBe(VERIFIED_MAINNET_USDT0_ADDRESS);
    expect(mainnetNetworkConfig.wNvdaAddress).not.toBe(internalTestnetNetworkConfig.demoAssetAddresses.demoNvda);
    expect(mainnetNetworkConfig.usdt0Address).not.toBe(internalTestnetNetworkConfig.stablecoinAddress);
  });
});
