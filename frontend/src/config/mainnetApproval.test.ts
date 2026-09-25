import { encodeFunctionData, type Address, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import type { Invoice, MainnetApprovalPreparation } from './api';
import { toBuilderCodeDataSuffix, VERIFIED_TESTNET_BUILDER_CODE } from './builderCodes';
import { mainnetNetworkConfig, VERIFIED_MAINNET_WAAPL_ADDRESS } from './network';
import { hasExactMainnetAllowance, isSamePersistedMainnetPreparation, validatePreparedMainnetApproval } from './mainnetApproval';

const buyer = '0xbabdfef588cf57efcc7c8857960e3ccdd9167589' as Address;
const merchant = '0x815c2fb8178f0bf80ada8c5b97ff44ece90e6e25' as Address;
const spender = '0x8b773d83bc66be128c60e07e17c8901f7a64f000' as Address;
const amount = '4800000000000000';
const code = '5fc2j7wx6trof4eu';
const abi = [{
  type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }],
}] as const;
const invoice: Invoice = {
  id: '00000000-0000-4000-8000-000000000001', title: 'Proof invoice', amountUsdt0: '1', merchantAddress: merchant,
  paymentUrl: 'http://localhost:5173/pay/00000000-0000-4000-8000-000000000001', status: 'pending',
  createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z',
};

function prepared(overrides: Partial<MainnetApprovalPreparation> = {}): MainnetApprovalPreparation {
  const approvalCalldata = encodeFunctionData({ abi, functionName: 'approve', args: [spender, BigInt(amount)] });
  const dataSuffix = toBuilderCodeDataSuffix(code)!;
  return {
    preparationId: '00000000-0000-4000-8000-000000000002', preparationHash: `0x${'a'.repeat(64)}` as Hex,
    invoiceId: invoice.id, buyer, merchant, chainId: 196, token: mainnetNetworkConfig.wNvdaAddress as Address,
    outputToken: mainnetNetworkConfig.usdt0Address as Address, spender, amount, minimumReceive: '1000000', nativeValue: '0',
    approvalCalldata, attributedApprovalCalldata: `${approvalCalldata}${dataSuffix.slice(2)}` as Hex, dataSuffix,
    builderCode: code, expiresAt: '2026-09-23T01:00:00.000Z', preparationBlockNumber: '12345', snapshotAllowance: '0',
    ...overrides,
  };
}

describe('Mainnet buyer approval preparation guard', () => {
  it('accepts the exact backend-prepared mainnet approval for the bound buyer and invoice', () => {
    expect(validatePreparedMainnetApproval(prepared(), invoice, buyer, 196, Date.parse('2026-09-23T00:30:00.000Z'))).toBeNull();
  });

  it('accepts either configured Mainnet xStock and requires an exact allowance value', () => {
    const value = prepared({ token: VERIFIED_MAINNET_WAAPL_ADDRESS as Address });
    expect(validatePreparedMainnetApproval(value, invoice, buyer, 196, Date.parse('2026-09-23T00:30:00.000Z'))).toBeNull();
    expect(hasExactMainnetAllowance(BigInt(amount), amount)).toBe(true);
    expect(hasExactMainnetAllowance(BigInt(amount) - 1n, amount)).toBe(false);
    expect(hasExactMainnetAllowance(BigInt(amount) + 1n, amount)).toBe(false);
    expect(hasExactMainnetAllowance(((1n << 256n) - 1n), amount)).toBe(false);
  });

  it('recognizes only the identical immutable approval preparation after the allowance step', () => {
    const original = prepared();
    expect(isSamePersistedMainnetPreparation(original, prepared())).toBe(true);
    expect(isSamePersistedMainnetPreparation(original, prepared({ preparationId: '00000000-0000-4000-8000-000000000003' }))).toBe(false);
    expect(isSamePersistedMainnetPreparation(original, prepared({ amount: '5000000000000000' }))).toBe(false);
    expect(isSamePersistedMainnetPreparation(original, prepared({ minimumReceive: '1100000' }))).toBe(false);
    expect(isSamePersistedMainnetPreparation(original, prepared({ spender: '0x1111111111111111111111111111111111111111' as Address }))).toBe(false);
    expect(isSamePersistedMainnetPreparation(original, prepared({ preparationHash: `0x${'b'.repeat(64)}` as Hex }))).toBe(false);
    expect(isSamePersistedMainnetPreparation(original, prepared({ attributedApprovalCalldata: `${original.approvalCalldata}00` as Hex }))).toBe(false);
  });

  it.each([
    ['wrong chain', prepared(), buyer, 1952],
    ['wrong buyer', prepared(), '0x1111111111111111111111111111111111111111' as Address, 196],
    ['testnet token', prepared({ token: '0x756546fce7d7ca3bb4be127904b002baf13b432e' as Address }), buyer, 196],
    ['wrong spender binding', prepared({ spender: '0x1111111111111111111111111111111111111111' as Address }), buyer, 196],
    ['unlimited approval', prepared({ amount: ((1n << 256n) - 1n).toString() }), buyer, 196],
    ['testnet Builder Code', prepared({ builderCode: VERIFIED_TESTNET_BUILDER_CODE }), buyer, 196],
    ['expired preparation', prepared({ expiresAt: '2026-09-23T00:00:00.000Z' }), buyer, 196],
    ['wrong merchant binding', prepared({ merchant: '0x1111111111111111111111111111111111111111' as Address }), buyer, 196],
  ])('rejects %s', (_label, value, connectedBuyer, chainId) => {
    expect(validatePreparedMainnetApproval(value, invoice, connectedBuyer, chainId, Date.parse('2026-09-23T00:30:00.000Z'))).not.toBeNull();
  });

  it('rejects altered exact approval calldata and Builder Code suffix bytes', () => {
    const value = prepared();
    expect(validatePreparedMainnetApproval({ ...value, attributedApprovalCalldata: `${value.approvalCalldata}00` as Hex }, invoice, buyer, 196, Date.parse('2026-09-23T00:30:00.000Z'))).toMatch(/attributed approval calldata/);
    expect(validatePreparedMainnetApproval({ ...value, dataSuffix: `0x${'00'.repeat(16)}` as Hex }, invoice, buyer, 196, Date.parse('2026-09-23T00:30:00.000Z'))).toMatch(/Builder Code suffix/);
  });
});
