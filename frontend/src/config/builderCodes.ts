import { Attribution } from 'ox/erc8021';
import { createPublicClient, http, stringToHex, type Address, type Hex } from 'viem';
import { internalTestnetNetworkConfig, xLayerTestnet } from './network';

export const portPayBuilderCode = internalTestnetNetworkConfig.builderCode.trim();
export const VERIFIED_TESTNET_BUILDER_CODE = 'kob1lkgsg6infkg3' as const;
export const BUILDER_CODE_REGISTRY_ADDRESS = '0x33907e98d7392d95212b05ab03f091e02d7815bf' as const;
export const EXPECTED_BUILDER_PAYOUT_ADDRESS = '0xbabdfef588cf57efcc7c8857960e3ccdd9167589' as const;
export const builderCodeRegistryAbi = [{
  type: 'function',
  name: 'payoutAddress',
  stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const;

const builderCodePublicClient = createPublicClient({
  chain: xLayerTestnet,
  transport: http(internalTestnetNetworkConfig.rpcUrl),
});

export type BuilderCodeVerificationDiagnostics = {
  code: string;
  rpcUrl: string;
  chainId?: number;
  registryAddress: typeof BUILDER_CODE_REGISTRY_ADDRESS;
  getter: 'payoutAddress(uint256)';
  tokenIdHex: Hex;
  tokenIdDecimal: string;
  rawPayoutAddress?: Address;
  error?: { name: string; message: string };
};

export class BuilderCodeVerificationError extends Error {
  constructor(
    message: string,
    readonly diagnostics: BuilderCodeVerificationDiagnostics,
  ) {
    super(message);
    this.name = 'BuilderCodeVerificationError';
  }
}

export function toBuilderCodeDataSuffix(code: string): Hex | undefined {
  return /^[a-z0-9]{16}$/.test(code) ? Attribution.toDataSuffix({ codes: [code] }) : undefined;
}

export const portPayBuilderCodeDataSuffix = toBuilderCodeDataSuffix(portPayBuilderCode);

export function builderCodeRegistryTokenId(code: string): bigint {
  if (!toBuilderCodeDataSuffix(code)) {
    throw new Error('PortPay Builder Code is missing or malformed. Check VITE_PORTPAY_BUILDER_CODE.');
  }
  return BigInt(stringToHex(code));
}

export async function readBuilderCodePayoutAddress(code: string): Promise<Address> {
  const tokenIdHex = stringToHex(code);
  const tokenId = builderCodeRegistryTokenId(code);
  const diagnostics: BuilderCodeVerificationDiagnostics = {
    code,
    rpcUrl: internalTestnetNetworkConfig.rpcUrl,
    registryAddress: BUILDER_CODE_REGISTRY_ADDRESS,
    getter: 'payoutAddress(uint256)',
    tokenIdHex,
    tokenIdDecimal: tokenId.toString(),
  };

  try {
    diagnostics.chainId = await builderCodePublicClient.getChainId();
    if (diagnostics.chainId !== xLayerTestnet.id) {
      throw new Error(`Builder Code registry RPC returned chain ${diagnostics.chainId}; expected X Layer Testnet ${xLayerTestnet.id}.`);
    }

    diagnostics.rawPayoutAddress = await builderCodePublicClient.readContract({
      address: BUILDER_CODE_REGISTRY_ADDRESS,
      abi: builderCodeRegistryAbi,
      functionName: 'payoutAddress',
      args: [tokenId],
    });
    if (import.meta.env.DEV) console.debug('[PortPay Builder Code verification]', diagnostics);
    return diagnostics.rawPayoutAddress;
  } catch (error) {
    diagnostics.error = {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    };
    if (import.meta.env.DEV) console.error('[PortPay Builder Code verification failed]', diagnostics, error);
    throw new BuilderCodeVerificationError(
      `PortPay could not verify Builder Code ${code} on X Layer Testnet. Check registration and RPC access.`,
      diagnostics,
    );
  }
}

export async function assertRegisteredBuilderCode(
  code: string,
  readPayoutAddress: (tokenId: bigint) => Promise<Address>,
): Promise<void> {
  if (!toBuilderCodeDataSuffix(code)) {
    throw new Error('PortPay Builder Code is missing or malformed. Check VITE_PORTPAY_BUILDER_CODE.');
  }
  let payoutAddress: Address;
  try {
    payoutAddress = await readPayoutAddress(builderCodeRegistryTokenId(code));
  } catch (error) {
    if (error instanceof BuilderCodeVerificationError) throw error;
    throw new BuilderCodeVerificationError(
      `PortPay could not verify Builder Code ${code} on X Layer Testnet. Check registration and RPC access.`,
      {
        code,
        rpcUrl: internalTestnetNetworkConfig.rpcUrl,
        registryAddress: BUILDER_CODE_REGISTRY_ADDRESS,
        getter: 'payoutAddress(uint256)',
        tokenIdHex: stringToHex(code),
        tokenIdDecimal: builderCodeRegistryTokenId(code).toString(),
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
        },
      },
    );
  }
  if (payoutAddress.toLowerCase() !== EXPECTED_BUILDER_PAYOUT_ADDRESS.toLowerCase()) {
    const diagnostics: BuilderCodeVerificationDiagnostics = {
      code,
      rpcUrl: internalTestnetNetworkConfig.rpcUrl,
      registryAddress: BUILDER_CODE_REGISTRY_ADDRESS,
      getter: 'payoutAddress(uint256)',
      tokenIdHex: stringToHex(code),
      tokenIdDecimal: builderCodeRegistryTokenId(code).toString(),
      rawPayoutAddress: payoutAddress,
    };
    if (import.meta.env.DEV) console.error('[PortPay Builder Code payout mismatch]', diagnostics);
    throw new BuilderCodeVerificationError(
      `PortPay Builder Code ${code} has an unexpected payout address.`,
      diagnostics,
    );
  }
}

export function builderCodeTransactionData<T extends Record<string, unknown>>(request: T, code = portPayBuilderCode): T & { dataSuffix: Hex } {
  const dataSuffix = toBuilderCodeDataSuffix(code);
  if (!dataSuffix) throw new Error('PortPay Builder Code is missing or malformed. Check VITE_PORTPAY_BUILDER_CODE.');
  return { ...request, dataSuffix };
}
