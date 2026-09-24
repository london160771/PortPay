import { http, createConfig } from 'wagmi';
import { injected } from 'wagmi/connectors';
import type { EIP1193Provider } from 'viem';
import { xLayerMainnet, xLayerTestnet } from './network';

type OkxProvider = EIP1193Provider & {
  isOkxWallet?: true;
  isOKExWallet?: true;
  providers?: OkxProvider[];
};

type OkxInjectedWindow = {
  okxwallet?: OkxProvider;
  ethereum?: OkxProvider;
};

function getOkxProvider(browserWindow?: unknown): OkxProvider | undefined {
  const okxWindow = browserWindow as OkxInjectedWindow | undefined;
  if (okxWindow?.okxwallet) return okxWindow.okxwallet;

  const ethereum = okxWindow?.ethereum;
  if (ethereum?.isOkxWallet || ethereum?.isOKExWallet) return ethereum;

  const providers = ethereum?.providers;
  return providers?.find((provider: OkxProvider) => provider.isOkxWallet || provider.isOKExWallet);
}

// OKX documents its EVM extension provider at window.okxwallet. The ethereum
// provider fallback supports browsers that expose the same provider through
// EIP-6963's window.ethereum.providers list.
export const okxWalletConnector = injected({
  target: {
    id: 'okxWallet',
    name: 'OKX Wallet',
    provider: getOkxProvider,
  },
});

export const wagmiConfig = createConfig({
  // Mainnet is first so ordinary wallet connection and routing use chain 196.
  // Testnet remains registered solely for explicit internal development/regression.
  chains: [xLayerMainnet, xLayerTestnet],
  connectors: [okxWalletConnector],
  transports: {
    [xLayerTestnet.id]: http(xLayerTestnet.rpcUrls.default.http[0]),
    [xLayerMainnet.id]: http(xLayerMainnet.rpcUrls.default.http[0]),
  },
});
