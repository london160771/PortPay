export const portPaySettlementAbi = [
  {
    type: 'function',
    name: 'settle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'quote',
        type: 'tuple',
        components: [
          { name: 'invoiceId', type: 'bytes32' },
          { name: 'buyer', type: 'address' },
          { name: 'merchant', type: 'address' },
          { name: 'asset', type: 'address' },
          { name: 'assetAmount', type: 'uint256' },
          { name: 'stablecoin', type: 'address' },
          { name: 'stablecoinAmount', type: 'uint256' },
          { name: 'chainId', type: 'uint256' },
          { name: 'settlementContract', type: 'address' },
          { name: 'expiry', type: 'uint256' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'quoteId', type: 'bytes32' }],
  },
] as const;

export type SettlementWriteQuote = {
  invoiceId: `0x${string}`;
  buyer: `0x${string}`;
  merchant: `0x${string}`;
  asset: `0x${string}`;
  assetAmount: bigint;
  stablecoin: `0x${string}`;
  stablecoinAmount: bigint;
  chainId: bigint;
  settlementContract: `0x${string}`;
  expiry: bigint;
};
