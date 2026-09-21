import { describe, expect, it } from 'vitest';
import { Attribution } from 'ox/erc8021';
import { createWalletClient, custom, encodeFunctionData, stringToHex, type Address, type Hex } from 'viem';
import { erc20BalanceAbi } from './assets';
import {
  assertRegisteredBuilderCode,
  builderCodeTransactionData,
  builderCodeRegistryTokenId,
  EXPECTED_BUILDER_PAYOUT_ADDRESS,
  toBuilderCodeDataSuffix,
} from './builderCodes';
import { xLayerTestnet } from './network';
import { portPaySettlementAbi } from './settlement';

const code = 'kob1lkgsg6infkg3';
const buyer = '0x0000000000000000000000000000000000000001' as Address;
const merchant = '0x0000000000000000000000000000000000000002' as Address;
const asset = '0x0000000000000000000000000000000000000003' as Address;
const stablecoin = '0x0000000000000000000000000000000000000004' as Address;
const settlement = '0x0000000000000000000000000000000000000005' as Address;

describe('Builder Code transaction attribution', () => {
  it('encodes an ERC-8021 suffix that decodes back to the configured code', () => {
    const suffix = toBuilderCodeDataSuffix(code);
    expect(suffix).toBeDefined();
    expect(Attribution.fromData(`0x1234${suffix!.slice(2)}`)?.codes).toEqual([code]);
  });

  it('fails closed for missing and malformed configuration', () => {
    expect(toBuilderCodeDataSuffix('not-a-builder-code')).toBeUndefined();
    expect(() => builderCodeTransactionData({ to: asset }, '')).toThrow('Builder Code is missing');
    expect(() => builderCodeTransactionData({ to: asset }, '2j3pbm1a4djso11j!')).toThrow('Builder Code is missing');
  });

  it('regresses the registered lk code to the expected buyer payout before a wallet request', async () => {
    const tokenId = builderCodeRegistryTokenId(code);
    expect(tokenId).toBe(BigInt(stringToHex('kob1lkgsg6infkg3')));
    let resolvedTokenId: bigint | undefined;
    await expect(assertRegisteredBuilderCode(code, async (id) => {
      resolvedTokenId = id;
      return EXPECTED_BUILDER_PAYOUT_ADDRESS;
    })).resolves.toBeUndefined();
    expect(resolvedTokenId).toBe(tokenId);
    await expect(assertRegisteredBuilderCode(code, async () => { throw new Error('Unregistered'); }))
      .rejects.toThrow('could not verify Builder Code');
    await expect(assertRegisteredBuilderCode(code, async () => buyer))
      .rejects.toThrow('unexpected payout');
    await expect(assertRegisteredBuilderCode('', async () => EXPECTED_BUILDER_PAYOUT_ADDRESS))
      .rejects.toThrow('missing or malformed');
  });

  it('preserves ABI-encoded approval and settlement inputs through viem writeContract', async () => {
    const sent: Array<{ data: Hex; to: Address }> = [];
    const wallet = createWalletClient({
      account: buyer,
      chain: xLayerTestnet,
      transport: custom({
        request: async ({ method, params }) => {
          if (method === 'eth_chainId') return '0x7a0';
          if (method === 'eth_sendTransaction') {
            sent.push((params as [{ data: Hex; to: Address }])[0]);
            return `0x${'ab'.repeat(32)}`;
          }
          throw new Error(`Unexpected RPC method: ${method}`);
        },
      }),
    });
    const approvalArgs = [settlement, 80_000_000_000_000_000n] as const;
    await wallet.writeContract(builderCodeTransactionData({
      address: asset,
      abi: erc20BalanceAbi,
      functionName: 'approve',
      args: approvalArgs,
    }, code));
    const quote = {
      invoiceId: `0x${'11'.repeat(32)}` as Hex,
      buyer,
      merchant,
      asset,
      assetAmount: approvalArgs[1],
      stablecoin,
      stablecoinAmount: 20_000_000n,
      chainId: 1952n,
      settlementContract: settlement,
      expiry: 2_000_000_000n,
    };
    const signature = `0x${'22'.repeat(65)}` as Hex;
    await wallet.writeContract(builderCodeTransactionData({
      address: settlement,
      abi: portPaySettlementAbi,
      functionName: 'settle',
      args: [quote, signature],
    }, code));

    const expectedInputs = [
      encodeFunctionData({ abi: erc20BalanceAbi, functionName: 'approve', args: approvalArgs }),
      encodeFunctionData({ abi: portPaySettlementAbi, functionName: 'settle', args: [quote, signature] }),
    ];
    expect(sent).toHaveLength(2);
    expect(sent.map(({ to }) => to)).toEqual([asset, settlement]);
    for (const [index, transaction] of sent.entries()) {
      expect(transaction.data.startsWith(expectedInputs[index])).toBe(true);
      expect(transaction.data).toBe(`${expectedInputs[index]}${toBuilderCodeDataSuffix(code)!.slice(2)}`);
      expect(Attribution.fromData(transaction.data)?.codes).toEqual([code]);
    }
  });
});
