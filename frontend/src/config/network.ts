import { defineChain } from 'viem';

const DEFAULT_RPC_URL = 'https://testrpc.xlayer.tech/terigon';
const DEFAULT_EXPLORER_URL = 'https://www.okx.com/web3/explorer/xlayer-test';
export const VERIFIED_TESTNET_USDT0_ADDRESS =
  '0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c' as const;

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

export const portPayNetworkConfig = {
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
