import { createPublicClient, getAddress, http, isAddress, stringToHex, type Address } from 'viem';
import {
  mainnetAddressConfig,
  VERIFIED_MAINNET_BUILDER_CODE_REGISTRY_ADDRESS,
  VERIFIED_TESTNET_BUILDER_CODE,
  xLayerMainnetChain,
} from '../config/xlayerMainnet.js';

export const mainnetBuilderCodeRegistryAbi = [{
  type: 'function',
  name: 'payoutAddress',
  stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export type MainnetBuilderCodeStatus =
  | 'MISSING'
  | 'INVALID'
  | 'PAYOUT_NOT_CONFIGURED'
  | 'UNREGISTERED'
  | 'PAYOUT_MISMATCH'
  | 'RPC_ERROR'
  | 'VERIFIED';

export type MainnetBuilderCodeCheck = {
  status: MainnetBuilderCodeStatus;
  code?: string;
  expectedPayoutAddress?: Address;
  payoutAddress?: Address;
  registryAddress: Address;
  tokenId?: bigint;
  tokenIdHex?: `0x${string}`;
  chainId?: number;
  error?: string;
};

export type MainnetBuilderCodeReadClient = {
  getChainId(): Promise<number>;
  readContract(args: {
    address: Address;
    abi: typeof mainnetBuilderCodeRegistryAbi;
    functionName: 'payoutAddress';
    args: readonly [bigint];
  }): Promise<unknown>;
};

export type MainnetBuilderCodeVerificationOptions = {
  code?: string;
  expectedPayoutAddress?: string;
  client?: MainnetBuilderCodeReadClient;
};

function defaultClient(): MainnetBuilderCodeReadClient {
  return createPublicClient({
    chain: xLayerMainnetChain,
    transport: http(xLayerMainnetChain.rpcUrls.default.http[0]),
  }) as unknown as MainnetBuilderCodeReadClient;
}

function registryAddress(): Address {
  return getAddress(VERIFIED_MAINNET_BUILDER_CODE_REGISTRY_ADDRESS);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRegistrationRevert(error: unknown): boolean {
  return /unregistered|not registered|unknown token|nonexistent|revert/i.test(errorText(error));
}

export function isValidMainnetBuilderCode(code: string): boolean {
  return /^[a-z0-9]{16}$/.test(code);
}

export function mainnetBuilderCodeTokenId(code: string): bigint {
  if (!isValidMainnetBuilderCode(code)) {
    throw new Error('Mainnet Builder Code must be exactly 16 lowercase letters or digits.');
  }
  return BigInt(stringToHex(code));
}

export async function verifyMainnetBuilderCode(
  options: MainnetBuilderCodeVerificationOptions = {},
): Promise<MainnetBuilderCodeCheck> {
  const code = (options.code ?? mainnetAddressConfig.builderCode).trim();
  const base = { registryAddress: registryAddress(), ...(code ? { code } : {}) };
  if (!code) return { ...base, status: 'MISSING' };
  if (code === VERIFIED_TESTNET_BUILDER_CODE) {
    return { ...base, status: 'INVALID', error: 'The registered testnet Builder Code is prohibited on X Layer Mainnet.' };
  }
  if (!isValidMainnetBuilderCode(code)) return { ...base, status: 'INVALID' };

  const configuredPayout = (options.expectedPayoutAddress ?? mainnetAddressConfig.builderPayoutAddress).trim();
  if (!configuredPayout || !isAddress(configuredPayout)) {
    return { ...base, status: 'PAYOUT_NOT_CONFIGURED', tokenId: mainnetBuilderCodeTokenId(code), tokenIdHex: stringToHex(code) };
  }

  const expectedPayoutAddress = getAddress(configuredPayout);
  const tokenId = mainnetBuilderCodeTokenId(code);
  const tokenIdHex = stringToHex(code);
  const client = options.client ?? defaultClient();
  try {
    const chainId = await client.getChainId();
    if (chainId !== 196) {
      return {
        ...base,
        status: 'RPC_ERROR',
        chainId,
        expectedPayoutAddress,
        tokenId,
        tokenIdHex,
        error: `Registry RPC returned chain ${chainId}; expected X Layer Mainnet 196.`,
      };
    }
    const value = await client.readContract({
      address: registryAddress(),
      abi: mainnetBuilderCodeRegistryAbi,
      functionName: 'payoutAddress',
      args: [tokenId],
    });
    if (typeof value !== 'string' || !isAddress(value)) {
      return { ...base, status: 'RPC_ERROR', chainId, expectedPayoutAddress, tokenId, tokenIdHex, error: 'Registry returned an invalid payout address.' };
    }
    const payoutAddress = getAddress(value);
    if (payoutAddress.toLowerCase() === ZERO_ADDRESS) {
      return { ...base, status: 'UNREGISTERED', chainId, expectedPayoutAddress, payoutAddress, tokenId, tokenIdHex };
    }
    if (payoutAddress.toLowerCase() !== expectedPayoutAddress.toLowerCase()) {
      return { ...base, status: 'PAYOUT_MISMATCH', chainId, expectedPayoutAddress, payoutAddress, tokenId, tokenIdHex };
    }
    return { ...base, status: 'VERIFIED', chainId, expectedPayoutAddress, payoutAddress, tokenId, tokenIdHex };
  } catch (error) {
    return {
      ...base,
      status: isRegistrationRevert(error) ? 'UNREGISTERED' : 'RPC_ERROR',
      expectedPayoutAddress,
      tokenId,
      tokenIdHex,
      error: errorText(error),
    };
  }
}
