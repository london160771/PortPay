import { xLayerTestnet } from './network';

export type WalletNetworkState = 'disconnected' | 'ready' | 'wrong-network';

export function getWalletNetworkState(
  isConnected: boolean,
  chainId: number | undefined,
): WalletNetworkState {
  if (!isConnected) return 'disconnected';
  return chainId === xLayerTestnet.id ? 'ready' : 'wrong-network';
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
