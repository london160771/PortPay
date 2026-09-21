import { describe, expect, it } from 'vitest';
import {
  mainnetAddressConfig,
  mainnetOkxConfig,
  OFFICIAL_OKX_DEX_API_BASE_URL,
  VERIFIED_MAINNET_USDT0_ADDRESS,
  VERIFIED_MAINNET_BUILDER_CODE_REGISTRY_ADDRESS,
  VERIFIED_MAINNET_WAAPL_ADDRESS,
  VERIFIED_MAINNET_WNVDA_ADDRESS,
  VERIFIED_TESTNET_BUILDER_CODE,
  xLayerMainnet,
} from './xlayerMainnet.js';

describe('X Layer Mainnet preparation config', () => {
  it('keeps chain 196 and official mainnet addresses isolated', () => {
    expect(xLayerMainnet.chainId).toBe(196);
    expect(xLayerMainnet.nativeCurrency).toBe('OKB');
    expect(mainnetAddressConfig.wNvda).toBe(VERIFIED_MAINNET_WNVDA_ADDRESS);
    expect(mainnetAddressConfig.wAapl).toBe(VERIFIED_MAINNET_WAAPL_ADDRESS);
    expect(mainnetAddressConfig.usdt0).toBe(VERIFIED_MAINNET_USDT0_ADDRESS);
    expect(VERIFIED_MAINNET_BUILDER_CODE_REGISTRY_ADDRESS).toBe('0xd6c426f9c077358735622ae5a83468dc0510823b');
    expect(mainnetAddressConfig.usdt0).not.toBe('0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c');
    expect(mainnetOkxConfig.apiBaseUrl).toBe(OFFICIAL_OKX_DEX_API_BASE_URL);
    expect(VERIFIED_TESTNET_BUILDER_CODE).toBe('kob1lkgsg6infkg3');
  });
});
