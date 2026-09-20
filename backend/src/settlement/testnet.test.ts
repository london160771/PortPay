import { encodeAbiParameters, getAddress, keccak256, recoverTypedDataAddress, stringToBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import type { Invoice } from '../invoices/types.js';
import {
  calculateAssetAmount,
  hashInvoiceId,
  settlementQuoteTypes,
  TestnetSettlementAdapter,
} from './testnet.js';

const ASSET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const STABLECOIN = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SETTLEMENT = '0xcccccccccccccccccccccccccccccccccccccccc';
const MERCHANT = '0x1111111111111111111111111111111111111111';
const SIGNER_KEY = '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`;

const invoice: Invoice = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Test invoice',
  amountUsdt0: '20',
  merchantAddress: MERCHANT,
  paymentUrl: `http://localhost:5173/invoice/00000000-0000-4000-8000-000000000001`,
  status: 'pending',
  createdAt: '2026-09-17T00:00:00.000Z',
  updatedAt: '2026-09-17T00:00:00.000Z',
};

function createAdapter() {
  return new TestnetSettlementAdapter({
    quoteSignerPrivateKey: SIGNER_KEY,
    demoAaplDecimals: 18,
    stablecoinDecimals: 6,
    addressConfig: { testnetUsdt0: STABLECOIN, demoAapl: ASSET, settlement: SETTLEMENT },
    publicClient: {
      getChainId: async () => 1952,
      readContract: async () => 18,
      getTransactionReceipt: async () => ({
        status: 'success' as const,
        to: SETTLEMENT,
        from: MERCHANT,
        blockNumber: 1n,
        blockHash: `0x${'1'.repeat(64)}` as Hex,
        logs: [],
      }),
      getBlockNumber: async () => 2n,
      getBlock: async () => ({ hash: `0x${'1'.repeat(64)}` as Hex }),
    },
  });
}

describe('TestnetSettlementAdapter', () => {
  it('converts the invoice amount using exact token decimals and signs a bound quote', async () => {
    const quote = await createAdapter().createQuote(invoice, '0x2222222222222222222222222222222222222222');

    expect(quote.assetAmount).toBe('0.08');
    expect(quote.stablecoinAmount).toBe('20');
    expect(quote.referencePriceUsd).toBe('250.00');
    expect(quote.assetDecimals).toBe(18);
    expect(quote.stablecoinDecimals).toBe(6);
    expect(quote.quote.chainId).toBe(1952);
    expect(quote.quote.settlementContract.toLowerCase()).toBe(SETTLEMENT);
    expect(quote.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(quote.quoteId).toMatch(/^0x[0-9a-f]{64}$/);
    const signedMessage = {
      ...quote.quote,
      assetAmount: BigInt(quote.quote.assetAmount),
      stablecoinAmount: BigInt(quote.quote.stablecoinAmount),
      chainId: BigInt(quote.quote.chainId),
      expiry: BigInt(quote.quote.expiry),
    };
    const domain = { name: 'PortPaySettlement', version: '1', chainId: 1952, verifyingContract: quote.quote.settlementContract } as const;
    const signer = privateKeyToAccount(SIGNER_KEY).address;
    expect(await recoverTypedDataAddress({ domain, types: settlementQuoteTypes, primaryType: 'SettlementQuote', message: signedMessage, signature: quote.signature })).toBe(signer);
    expect(await recoverTypedDataAddress({ domain, types: settlementQuoteTypes, primaryType: 'SettlementQuote', message: { ...signedMessage, merchant: getAddress('0x3333333333333333333333333333333333333333') }, signature: quote.signature })).not.toBe(signer);
    expect(await recoverTypedDataAddress({ domain: { ...domain, verifyingContract: getAddress('0xdddddddddddddddddddddddddddddddddddddddd') }, types: settlementQuoteTypes, primaryType: 'SettlementQuote', message: signedMessage, signature: quote.signature })).not.toBe(signer);
  });

  it('rounds the required asset amount upward so the quoted invoice is fully covered', () => {
    expect(calculateAssetAmount(20_000_000n, '249.99', 6, 18)).toBe(80_003_200_128_005_121n);
  });

  it('quotes DemoNVDA with its own asset address, price, and decimals', async () => {
    const nvda = '0xdddddddddddddddddddddddddddddddddddddddd';
    const adapter = new TestnetSettlementAdapter({
      quoteSignerPrivateKey: SIGNER_KEY,
      demoAaplDecimals: 18,
      demoNvdaDecimals: 18,
      stablecoinDecimals: 6,
      referencePrices: { demoAapl: '250.00', demoNvda: '180.00' },
      addressConfig: { testnetUsdt0: STABLECOIN, demoAapl: ASSET, demoNvda: nvda, settlement: SETTLEMENT },
      publicClient: {
        getChainId: async () => 1952,
        readContract: async () => 18,
        getTransactionReceipt: async () => ({
          status: 'success' as const,
          to: SETTLEMENT,
          from: MERCHANT,
          blockNumber: 1n,
          blockHash: `0x${'1'.repeat(64)}` as Hex,
          logs: [],
        }),
        getBlockNumber: async () => 2n,
        getBlock: async () => ({ hash: `0x${'1'.repeat(64)}` as Hex }),
      },
    });

    const quote = await adapter.createQuote(invoice, '0x2222222222222222222222222222222222222222', 'demoNvda');
    expect(quote.assetKey).toBe('demoNvda');
    expect(quote.quote.asset.toLowerCase()).toBe(nvda);
    expect(quote.referencePriceUsd).toBe('180.00');
    expect(quote.assetAmount).toBe('0.111111111111111112');
  });

  it('rejects quotes for already paid invoices', async () => {
    await expect(createAdapter().createQuote({ ...invoice, status: 'paid' }, MERCHANT)).rejects.toThrow(/already paid/);
  });

  it('rejects quote lifetimes longer than the short testnet maximum', () => {
    expect(() => new TestnetSettlementAdapter({ quoteTtlSeconds: 301 })).toThrow(/between 1 and 300/);
    expect(() => new TestnetSettlementAdapter({ quoteTtlSeconds: 0 })).toThrow(/between 1 and 300/);
  });

  it('consumes a matching confirmed SettlementExecuted event into payment evidence', async () => {
    const buyer = getAddress('0x2222222222222222222222222222222222222222');
    const merchant = getAddress(MERCHANT);
    const asset = getAddress(ASSET);
    const stablecoin = getAddress(STABLECOIN);
    const settlement = getAddress(SETTLEMENT);
    const buyerQuote = await createAdapter().createQuote(invoice, buyer);
    const eventLog = {
      topics: [
        keccak256(stringToBytes('SettlementExecuted(bytes32,address,address,address,uint256,address,uint256,uint256,bytes32)')),
        hashInvoiceId(invoice.id),
        encodeAbiParameters([{ type: 'address' }], [buyer]),
        encodeAbiParameters([{ type: 'address' }], [merchant]),
      ],
      data: encodeAbiParameters(
        [
          { type: 'address' },
          { type: 'uint256' },
          { type: 'address' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'bytes32' },
        ],
        [asset, 80_000_000_000_000_000n, stablecoin, 20_000_000n, BigInt(buyerQuote.quote.expiry), buyerQuote.quoteId],
      ),
    };
    let receiptFrom = merchant;
    const adapter = new TestnetSettlementAdapter({
      quoteSignerPrivateKey: SIGNER_KEY,
      referencePriceUsd: '200.00',
      demoAaplDecimals: 18,
      stablecoinDecimals: 6,
      addressConfig: { testnetUsdt0: STABLECOIN, demoAapl: ASSET, settlement: SETTLEMENT },
      publicClient: {
        getChainId: async () => 1952,
        readContract: async () => 18,
        getTransactionReceipt: async () => ({
          status: 'success' as const,
          to: settlement,
          from: receiptFrom,
          blockNumber: 42n,
          blockHash: `0x${'2'.repeat(64)}` as Hex,
          logs: [{ address: settlement, ...eventLog }],
        }),
        getBlockNumber: async () => 43n,
        getBlock: async () => ({ hash: `0x${'2'.repeat(64)}` as Hex }),
      },
    });

    await expect(adapter.reconcilePayment(invoice, {
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex,
      buyerAddress: buyer,
    })).rejects.toThrow(/sender/);
    receiptFrom = buyer;

    const evidence = await adapter.reconcilePayment(invoice, {
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex,
      buyerAddress: buyer,
      smartSpendUsed: true,
      smartSpendRecommendedAsset: 'demoAapl',
      smartSpendReason: 'Recommended DemoAAPL because it is above target.',
    });

    expect(evidence.buyerAddress).toBe(buyer.toLowerCase());
    expect(evidence.spentAmount).toBe('80000000000000000');
    expect(evidence.stablecoinReceived).toBe('20');
    expect(evidence.quoteId).toBe(buyerQuote.quoteId);
    expect(evidence.settlementBlockNumber).toBe('42');
    expect(evidence.smartSpendUsed).toBe(true);
    expect(evidence.smartSpendRecommendedAsset).toBe('demoAapl');
    expect(evidence.smartSpendReason).toContain('above target');

    await expect(adapter.reconcilePayment(invoice, {
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex,
      buyerAddress: buyer,
      smartSpendUsed: true,
      smartSpendRecommendedAsset: 'demoNvda',
      smartSpendReason: 'Mismatched metadata',
    })).rejects.toThrow(/does not match/);
  });

  it('rejects a matching event emitted by a different contract in the same successful transaction', async () => {
    const buyer = getAddress('0x2222222222222222222222222222222222222222');
    const quote = await createAdapter().createQuote(invoice, buyer);
    const log = {
      address: getAddress(ASSET),
      topics: [
        keccak256(stringToBytes('SettlementExecuted(bytes32,address,address,address,uint256,address,uint256,uint256,bytes32)')),
        hashInvoiceId(invoice.id),
        encodeAbiParameters([{ type: 'address' }], [buyer]),
        encodeAbiParameters([{ type: 'address' }], [getAddress(MERCHANT)]),
      ],
      data: encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
        [getAddress(ASSET), 80_000_000_000_000_000n, getAddress(STABLECOIN), 20_000_000n, BigInt(quote.quote.expiry), quote.quoteId],
      ),
    };
    const adapter = new TestnetSettlementAdapter({
      demoAaplDecimals: 18,
      stablecoinDecimals: 6,
      addressConfig: { testnetUsdt0: STABLECOIN, demoAapl: ASSET, settlement: SETTLEMENT },
      publicClient: {
        getChainId: async () => 1952,
        readContract: async () => 18,
        getTransactionReceipt: async () => ({ status: 'success' as const, to: getAddress(SETTLEMENT), from: buyer, blockNumber: 42n, blockHash: `0x${'3'.repeat(64)}` as Hex, logs: [log] }),
        getBlockNumber: async () => 43n,
        getBlock: async () => ({ hash: `0x${'3'.repeat(64)}` as Hex }),
      },
    });
    await expect(adapter.reconcilePayment(invoice, { txHash: `0x${'1'.repeat(64)}`, buyerAddress: buyer })).rejects.toThrow(/exactly one/);
  });

  it('rejects an RPC configured for the wrong chain before signing a quote', async () => {
    const adapter = new TestnetSettlementAdapter({
      quoteSignerPrivateKey: SIGNER_KEY,
      demoAaplDecimals: 18,
      stablecoinDecimals: 6,
      addressConfig: { testnetUsdt0: STABLECOIN, demoAapl: ASSET, settlement: SETTLEMENT },
      publicClient: {
        getChainId: async () => 196,
        readContract: async () => 18,
        getTransactionReceipt: async () => ({ status: 'success' as const, to: getAddress(SETTLEMENT), from: getAddress(MERCHANT), blockNumber: 42n, blockHash: `0x${'4'.repeat(64)}` as Hex, logs: [] }),
        getBlockNumber: async () => 43n,
        getBlock: async () => ({ hash: `0x${'4'.repeat(64)}` as Hex }),
      },
    });
    await expect(adapter.createQuote(invoice, MERCHANT)).rejects.toThrow(/not X Layer Testnet/);
  });

  it('requires a canonical receipt and a second confirmation before reconciliation', async () => {
    const buyer = getAddress('0x2222222222222222222222222222222222222222');
    const receiptHash = `0x${'5'.repeat(64)}` as Hex;
    let canonicalHash = `0x${'6'.repeat(64)}` as Hex;
    let latestBlock = 42n;
    const adapter = new TestnetSettlementAdapter({
      confirmationDepth: 2,
      demoAaplDecimals: 18,
      stablecoinDecimals: 6,
      addressConfig: { testnetUsdt0: STABLECOIN, demoAapl: ASSET, settlement: SETTLEMENT },
      publicClient: {
        getChainId: async () => 1952,
        readContract: async () => 18,
        getTransactionReceipt: async () => ({
          status: 'success' as const,
          to: getAddress(SETTLEMENT),
          from: buyer,
          blockNumber: 42n,
          blockHash: receiptHash,
          logs: [],
        }),
        getBlockNumber: async () => latestBlock,
        getBlock: async () => ({ hash: canonicalHash }),
      },
    });
    const input = { txHash: `0x${'7'.repeat(64)}` as Hex, buyerAddress: buyer };

    await expect(adapter.reconcilePayment(invoice, input)).rejects.toThrow(/canonical/);
    canonicalHash = receiptHash;
    await expect(adapter.reconcilePayment(invoice, input)).rejects.toThrow(/requires 2 confirmations/);
    latestBlock = 43n;
    await expect(adapter.reconcilePayment(invoice, input)).rejects.toThrow(/exactly one PortPay settlement event/);
  });
});
