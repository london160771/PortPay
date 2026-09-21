import { xLayerMainnet } from '../config/xlayerMainnet.js';
import { xLayerTestnet } from '../config/xlayer.js';
import { OKXDEXMainnetAdapter, type MainnetAdapterOptions } from './mainnet.js';
import { createTestnetSettlementAdapter } from './testnet.js';
import type { SettlementAdapter } from './types.js';

export type SettlementNetwork = 'testnet' | 'mainnet';
export type SelectedSettlementAdapter = SettlementAdapter | OKXDEXMainnetAdapter;

export function createSettlementAdapterForChain(
  chainId: number,
  options: { mainnet?: MainnetAdapterOptions } = {},
): SelectedSettlementAdapter {
  if (chainId === xLayerTestnet.chainId) return createTestnetSettlementAdapter();
  if (chainId === xLayerMainnet.chainId) return new OKXDEXMainnetAdapter(options.mainnet);
  throw new Error(`Unsupported PortPay settlement chain ${chainId}.`);
}

export function createSettlementAdapterForNetwork(
  network: SettlementNetwork,
  options: { mainnet?: MainnetAdapterOptions } = {},
): SelectedSettlementAdapter {
  return createSettlementAdapterForChain(network === 'testnet' ? xLayerTestnet.chainId : xLayerMainnet.chainId, options);
}
