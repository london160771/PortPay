const DEFAULT_RPC_URL = 'https://testrpc.xlayer.tech/terigon';
const DEFAULT_EXPLORER_URL = 'https://www.okx.com/web3/explorer/xlayer-test';

const envValue = (name: string, fallback = '') => process.env[name]?.trim() || fallback;

export const xLayerTestnet = {
  name: 'X Layer Testnet',
  chainId: 1952,
  nativeCurrency: 'OKB',
  rpcUrl: envValue('X_LAYER_TESTNET_RPC_URL', DEFAULT_RPC_URL),
  explorerUrl: envValue('X_LAYER_TESTNET_EXPLORER_URL', DEFAULT_EXPLORER_URL),
} as const;

export const portPayAddressConfig = {
  testnetUsdt0: envValue('TESTNET_USDT0_ADDRESS'),
  demoAapl: envValue('DEMO_AAPL_ADDRESS'),
  demoNvda: envValue('DEMO_NVDA_ADDRESS'),
  settlement: envValue('PORTPAY_SETTLEMENT_ADDRESS'),
  builderCode: envValue('PORTPAY_BUILDER_CODE'),
} as const;
