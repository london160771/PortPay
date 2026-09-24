import { defineChain } from 'viem';

const DEFAULT_RPC_URL = 'https://testrpc.xlayer.tech/terigon';
const DEFAULT_EXPLORER_URL = 'https://www.okx.com/web3/explorer/xlayer-test';
const DEFAULT_MAINNET_RPC_URL = 'https://rpc.xlayer.tech';
const DEFAULT_MAINNET_EXPLORER_URL = 'https://www.okx.com/web3/explorer/xlayer';
export const VERIFIED_TESTNET_USDT0_ADDRESS =
  '0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c' as const;
export const VERIFIED_MAINNET_WNVDA_ADDRESS = '0xa8ddb5cd96b5222afe198316e9a57caa642850d5' as const;
export const VERIFIED_MAINNET_WAAPL_ADDRESS = '0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f' as const;
export const VERIFIED_MAINNET_USDT0_ADDRESS = '0x779ded0c9e1022225f8e0630b35a9b54be713736' as const;

export const xLayerTestnet = defineChain({
  id: 1952,
  name: 'X Layer Testnet',
  nativeCurrency: {
    name: 'OKB',
    symbol: 'OKB',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [import.meta.env.VITE_X_LAYER_TESTNET_RPC_URL || DEFAULT_RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: 'OKX Explorer',
      url: import.meta.env.VITE_X_LAYER_TESTNET_EXPLORER_URL || DEFAULT_EXPLORER_URL,
    },
  },
});

export const internalTestnetNetworkConfig = {
  chainId: xLayerTestnet.id,
  rpcUrl: xLayerTestnet.rpcUrls.default.http[0],
  explorerUrl: xLayerTestnet.blockExplorers.default.url,
  stablecoinAddress:
    import.meta.env.VITE_TESTNET_USDT0_ADDRESS || VERIFIED_TESTNET_USDT0_ADDRESS,
  demoAssetAddresses: {
    demoAapl: import.meta.env.VITE_DEMO_AAPL_ADDRESS || '',
    demoNvda: import.meta.env.VITE_DEMO_NVDA_ADDRESS || '',
  },
  settlementAddress: import.meta.env.VITE_PORTPAY_SETTLEMENT_ADDRESS || '',
  builderCode: import.meta.env.VITE_PORTPAY_BUILDER_CODE || '',
} as const;

export const xLayerMainnet = defineChain({
  id: 196,
  name: 'X Layer Mainnet',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_X_LAYER_MAINNET_RPC_URL || DEFAULT_MAINNET_RPC_URL] },
  },
  blockExplorers: {
    default: { name: 'OKX Explorer', url: import.meta.env.VITE_X_LAYER_MAINNET_EXPLORER_URL || DEFAULT_MAINNET_EXPLORER_URL },
  },
});

export const mainnetNetworkConfig = {
  chainId: xLayerMainnet.id,
  rpcUrl: xLayerMainnet.rpcUrls.default.http[0],
  explorerUrl: xLayerMainnet.blockExplorers.default.url,
  wNvdaAddress: import.meta.env.VITE_MAINNET_WNVDA_ADDRESS || VERIFIED_MAINNET_WNVDA_ADDRESS,
  wAaplAddress: import.meta.env.VITE_MAINNET_WAAPL_ADDRESS || VERIFIED_MAINNET_WAAPL_ADDRESS,
  usdt0Address: import.meta.env.VITE_MAINNET_USDT0_ADDRESS || VERIFIED_MAINNET_USDT0_ADDRESS,
} as const;

/** The unqualified PortPay network is the user-facing product network. */
export const portPayNetworkConfig = mainnetNetworkConfig;
export const portPayProductNetworkConfig = mainnetNetworkConfig;
