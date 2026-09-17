/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_X_LAYER_TESTNET_RPC_URL?: string;
  readonly VITE_X_LAYER_TESTNET_EXPLORER_URL?: string;
  readonly VITE_TESTNET_USDT0_ADDRESS?: string;
  readonly VITE_DEMO_AAPL_ADDRESS?: string;
  readonly VITE_DEMO_NVDA_ADDRESS?: string;
  readonly VITE_PORTPAY_SETTLEMENT_ADDRESS?: string;
  readonly VITE_PORTPAY_BUILDER_CODE?: string;
  readonly VITE_DEMO_PRICE_SOURCE?: string;
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
