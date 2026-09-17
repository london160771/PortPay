import { http, createConfig } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { xLayerTestnet } from './network';

// OKX Wallet exposes an injected EVM provider in the browser.
export const okxWalletConnector = injected({ target: 'okxWallet' });

export const wagmiConfig = createConfig({
  chains: [xLayerTestnet],
  connectors: [okxWalletConnector],
  transports: {
    [xLayerTestnet.id]: http(xLayerTestnet.rpcUrls.default.http[0]),
  },
});
