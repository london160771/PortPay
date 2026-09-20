import { formatUnits, isAddress, type Address } from 'viem';
import { portPayNetworkConfig } from './network';

export const erc20BalanceAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: 'remaining', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export const portfolioAssets = {
  demoAapl: {
    key: 'demoAapl',
    label: 'DemoAAPL',
    description: 'Test asset · not an official xStock or real Apple-backed security',
    address: portPayNetworkConfig.demoAssetAddresses.demoAapl,
    referencePriceUsd: '250.00',
    decimals: 18,
  },
  demoNvda: {
    key: 'demoNvda',
    label: 'DemoNVDA',
    description: 'Test asset · not an official xStock or real NVIDIA-backed security',
    address: portPayNetworkConfig.demoAssetAddresses.demoNvda,
    referencePriceUsd: '180.00',
    decimals: 18,
  },
} as const;

export const testnetAssets = {
  ...portfolioAssets,
  usdt0: {
    key: 'usdt0',
    label: 'USD₮0',
    description: 'Official X Layer Testnet settlement stablecoin',
    address: portPayNetworkConfig.stablecoinAddress,
  },
} as const;

export function parseConfiguredAddress(value: string): Address | undefined {
  return isAddress(value) ? (value as Address) : undefined;
}

export function formatTokenBalance(
  balance: bigint | undefined,
  decimals: number | undefined,
): string | undefined {
  if (balance === undefined || decimals === undefined) return undefined;

  const [whole, fraction = ''] = formatUnits(balance, decimals).split('.');
  const trimmedFraction = fraction.replace(/0+$/, '').slice(0, 6);
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}
