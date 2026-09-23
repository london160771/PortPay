import { stringToHex, type Address } from 'viem';
import { describe, expect, it } from 'vitest';
import { VERIFIED_MAINNET_BUILDER_CODE_REGISTRY_ADDRESS } from '../config/xlayerMainnet.js';
import {
  mainnetBuilderCodeTokenId,
  mainnetBuilderCodeRegistryAbi,
  verifyMainnetBuilderCode,
} from './mainnetBuilderCodes.js';

const code = 'mainnetcode12345';
const payout = '0xbabdfef588cf57efcc7c8857960e3ccdd9167589' as Address;

function client(payoutAddress: Address | Error = payout, chainId = 196) {
  return {
    async getChainId() { return chainId; },
    async readContract(args: { address: Address; abi: typeof mainnetBuilderCodeRegistryAbi; functionName: 'payoutAddress'; args: readonly [bigint] }) {
      expect(args.address.toLowerCase()).toBe(VERIFIED_MAINNET_BUILDER_CODE_REGISTRY_ADDRESS.toLowerCase());
      expect(args.functionName).toBe('payoutAddress');
      expect(args.args[0]).toBe(mainnetBuilderCodeTokenId(code));
      if (payoutAddress instanceof Error) throw payoutAddress;
      return payoutAddress;
    },
  };
}

describe('mainnet Builder Code registry verification', () => {
  it('uses the ERC-8021 code string as the registry token ID and verifies payout', async () => {
    const result = await verifyMainnetBuilderCode({
      code,
      expectedPayoutAddress: payout,
      client: client(),
    });
    expect(result.status).toBe('VERIFIED');
    expect(result.tokenIdHex).toBe(stringToHex(code));
    expect(result.payoutAddress?.toLowerCase()).toBe(payout.toLowerCase());
  });

  it('fails closed for missing configuration, malformed codes, payout mismatch, and wrong RPC chain', async () => {
    await expect(verifyMainnetBuilderCode({ client: client() })).resolves.toMatchObject({ status: 'MISSING' });
    await expect(verifyMainnetBuilderCode({ code: 'kob1lkgsg6infkg3x', expectedPayoutAddress: payout, client: client() })).resolves.toMatchObject({ status: 'INVALID' });
    await expect(verifyMainnetBuilderCode({ code, expectedPayoutAddress: '0x1111111111111111111111111111111111111111', client: client() })).resolves.toMatchObject({ status: 'PAYOUT_MISMATCH' });
    await expect(verifyMainnetBuilderCode({ code, expectedPayoutAddress: payout, client: client(payout, 1952) })).resolves.toMatchObject({ status: 'RPC_ERROR', chainId: 1952 });
  });

  it('classifies an unregistered registry revert without treating it as verified', async () => {
    await expect(verifyMainnetBuilderCode({
      code,
      expectedPayoutAddress: payout,
      client: client(new Error('Unregistered token ID')),
    })).resolves.toMatchObject({ status: 'UNREGISTERED' });
  });

  it('rejects the testnet Builder Code at the shared registry-verification boundary', async () => {
    await expect(verifyMainnetBuilderCode({
      code: 'kob1lkgsg6infkg3',
      expectedPayoutAddress: payout,
      client: client(),
    })).resolves.toMatchObject({ status: 'INVALID', error: expect.stringContaining('testnet') });
  });
});
