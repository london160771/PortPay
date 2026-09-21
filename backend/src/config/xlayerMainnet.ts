import { defineChain } from 'viem';

const DEFAULT_RPC_URL = 'https://rpc.xlayer.tech';
const DEFAULT_EXPLORER_URL = 'https://www.okx.com/web3/explorer/xlayer';

const envValue = (name: string, fallback = '') => process.env[name]?.trim() || fallback;

export const VERIFIED_MAINNET_USDT0_ADDRESS =
  '0x779Ded0c9e1022225f8E0630b35a9b54bE713736' as const;
export const VERIFIED_MAINNET_WNVDA_ADDRESS =
  '0xa8ddb5cd96b5222afe198316e9a57caa642850d5' as const;
export const VERIFIED_MAINNET_WAAPL_ADDRESS =
  '0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f' as const;
export const VERIFIED_MAINNET_BUILDER_CODE_REGISTRY_ADDRESS =
  '0xd6c426f9c077358735622ae5a83468dc0510823b' as const;
export const VERIFIED_TESTNET_BUILDER_CODE = 'kob1lkgsg6infkg3' as const;
export const OFFICIAL_OKX_DEX_API_BASE_URL = 'https://web3.okx.com' as const;

export const xLayerMainnet = {
  name: 'X Layer Mainnet',
  chainId: 196,
  nativeCurrency: 'OKB',
  rpcUrl: envValue('X_LAYER_MAINNET_RPC_URL', DEFAULT_RPC_URL),
  explorerUrl: envValue('X_LAYER_MAINNET_EXPLORER_URL', DEFAULT_EXPLORER_URL),
} as const;

export const mainnetAddressConfig = {
  wNvda: envValue('MAINNET_WNVDA_ADDRESS', VERIFIED_MAINNET_WNVDA_ADDRESS),
  wAapl: envValue('MAINNET_WAAPL_ADDRESS', VERIFIED_MAINNET_WAAPL_ADDRESS),
  usdt0: envValue('MAINNET_USDT0_ADDRESS', VERIFIED_MAINNET_USDT0_ADDRESS),
  builderCode: envValue('PORTPAY_MAINNET_BUILDER_CODE'),
} as const;

export const mainnetOkxConfig = {
  apiBaseUrl: OFFICIAL_OKX_DEX_API_BASE_URL,
  apiVersion: 'v6',
} as const;

export const xLayerMainnetChain = defineChain({
  id: xLayerMainnet.chainId,
  name: xLayerMainnet.name,
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: [xLayerMainnet.rpcUrl] } },
  blockExplorers: { default: { name: 'OKX Explorer', url: xLayerMainnet.explorerUrl } },
});

export type MainnetAssetKey = 'wNvda' | 'wAapl';

export type MainnetSupportedAsset = {
  key: MainnetAssetKey;
  symbol: 'wNVDAx' | 'wAAPLx';
  address: string;
  decimals: 18;
};

export const mainnetSupportedAssets: readonly MainnetSupportedAsset[] = [
  { key: 'wNvda', symbol: 'wNVDAx', address: mainnetAddressConfig.wNvda, decimals: 18 },
  { key: 'wAapl', symbol: 'wAAPLx', address: mainnetAddressConfig.wAapl, decimals: 18 },
] as const;
