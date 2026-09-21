import { describe, expect, it } from 'vitest';
import { createSettlementAdapterForChain, createSettlementAdapterForNetwork } from './selection.js';
import { OKXDEXMainnetAdapter } from './mainnet.js';

describe('settlement network selection', () => {
  it('keeps testnet on TestnetSettlementAdapter and mainnet on OKXDEXMainnetAdapter', () => {
    const testnet = createSettlementAdapterForChain(1952);
    const mainnet = createSettlementAdapterForChain(196);
    expect(testnet.name).toBe('TestnetSettlementAdapter');
    expect(mainnet).toBeInstanceOf(OKXDEXMainnetAdapter);
    expect(mainnet.name).toBe('OKXDEXMainnetAdapter');
  });

  it('does not let a network request select the other adapter', () => {
    expect(createSettlementAdapterForNetwork('testnet').name).toBe('TestnetSettlementAdapter');
    expect(createSettlementAdapterForNetwork('mainnet').name).toBe('OKXDEXMainnetAdapter');
    expect(() => createSettlementAdapterForChain(1)).toThrow('Unsupported PortPay settlement chain');
  });
});
