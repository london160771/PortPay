import { xLayerMainnet, xLayerTestnet } from './network';

export type WalletNetworkState = 'disconnected' | 'ready' | 'wrong-network';

export function getWalletNetworkState(
  isConnected: boolean,
  chainId: number | undefined,
): WalletNetworkState {
  if (!isConnected) return 'disconnected';
  return getWalletNetworkStateForChain(isConnected, chainId, xLayerMainnet.id);
}

/** Internal regression-only chain gate; never use this for normal product routes. */
export function getInternalTestnetWalletNetworkState(
  isConnected: boolean,
  chainId: number | undefined,
): WalletNetworkState {
  return getWalletNetworkStateForChain(isConnected, chainId, xLayerTestnet.id);
}

function getWalletNetworkStateForChain(
  isConnected: boolean,
  chainId: number | undefined,
  requiredChainId: number,
): WalletNetworkState {
  if (!isConnected) return 'disconnected';
  return chainId === requiredChainId ? 'ready' : 'wrong-network';
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
