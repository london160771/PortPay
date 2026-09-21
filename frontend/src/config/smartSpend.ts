import { formatUnits, parseUnits } from 'viem';
import type { Invoice } from './api';
import { portfolioAssets } from './assets';

export type SmartSpendAssetKey = keyof typeof portfolioAssets;
export type TargetAllocationBps = Record<SmartSpendAssetKey, number>;

export const DEFAULT_TARGET_ALLOCATION_BPS: TargetAllocationBps = {
  demoAapl: 5_000,
  demoNvda: 5_000,
};

export type PortfolioBalanceInput = {
  key: SmartSpendAssetKey;
  balance: bigint | undefined;
  decimals: number | undefined;
};

export type PortfolioAllocation = {
  key: SmartSpendAssetKey;
  balance: bigint | undefined;
  decimals: number | undefined;
  valueUsdMicro: bigint;
  currentAllocationBps: number;
  targetAllocationBps: number;
  requiredAssetAmount: bigint | undefined;
  canCoverInvoice: boolean;
};

export type SmartSpendRecommendation = {
  assetKey: SmartSpendAssetKey | undefined;
  reason: string;
  allocations: PortfolioAllocation[];
};

export function snapshotSmartSpendChoice(
  recommendation: SmartSpendRecommendation,
): { assetKey: SmartSpendAssetKey; reason: string } | undefined {
  return recommendation.assetKey
    ? { assetKey: recommendation.assetKey, reason: recommendation.reason }
    : undefined;
}

const USD_PRICE_DECIMALS = 6;
const BPS = 10_000n;

function parsePriceMicro(price: string): bigint {
  return parseUnits(price, USD_PRICE_DECIMALS);
}

export function calculateRequiredAssetAmount(
  invoiceAmountUsdt0: string,
  referencePriceUsd: string,
  stablecoinDecimals: number,
  assetDecimals: number,
): bigint | undefined {
  try {
    const stablecoinAmount = parseUnits(invoiceAmountUsdt0, stablecoinDecimals);
    const priceBase = parseUnits(referencePriceUsd, stablecoinDecimals);
    if (stablecoinAmount <= 0n || priceBase <= 0n) return undefined;
    const numerator = stablecoinAmount * 10n ** BigInt(assetDecimals);
    return (numerator + priceBase - 1n) / priceBase;
  } catch {
    return undefined;
  }
}

export function calculatePortfolioAllocations(
  balances: PortfolioBalanceInput[],
  invoiceAmountUsdt0: string,
  stablecoinDecimals: number,
  targets: TargetAllocationBps = DEFAULT_TARGET_ALLOCATION_BPS,
): PortfolioAllocation[] {
  const values = balances.map((asset) => {
    const config = portfolioAssets[asset.key];
    let valueUsdMicro = 0n;
    try {
      if (asset.balance !== undefined && asset.decimals !== undefined) {
        const priceMicro = parsePriceMicro(config.referencePriceUsd);
        valueUsdMicro = (asset.balance * priceMicro) / 10n ** BigInt(asset.decimals);
      }
    } catch {
      valueUsdMicro = 0n;
    }
    return { asset, valueUsdMicro };
  });
  const totalValue = values.reduce((total, item) => total + item.valueUsdMicro, 0n);

  return values.map(({ asset, valueUsdMicro }) => {
    const config = portfolioAssets[asset.key];
    const requiredAssetAmount = asset.decimals === undefined
      ? undefined
      : calculateRequiredAssetAmount(
        invoiceAmountUsdt0,
        config.referencePriceUsd,
        stablecoinDecimals,
        asset.decimals,
      );
    return {
      key: asset.key,
      balance: asset.balance,
      decimals: asset.decimals,
      valueUsdMicro,
      currentAllocationBps: totalValue > 0n ? Number((valueUsdMicro * BPS) / totalValue) : 0,
      targetAllocationBps: targets[asset.key],
      requiredAssetAmount,
      canCoverInvoice: asset.balance !== undefined
        && requiredAssetAmount !== undefined
        && asset.balance >= requiredAssetAmount,
    };
  });
}

function allocationDeltaLabel(bps: number): string {
  const percentagePoints = Math.round(Math.abs(bps) / 100);
  return `${percentagePoints}%`;
}

export function recommendSmartSpend(
  balances: PortfolioBalanceInput[],
  invoice: Pick<Invoice, 'amountUsdt0'>,
  stablecoinDecimals: number | undefined,
  targets: TargetAllocationBps = DEFAULT_TARGET_ALLOCATION_BPS,
): SmartSpendRecommendation {
  if (stablecoinDecimals === undefined) {
    return { assetKey: undefined, reason: 'Waiting for token decimals before calculating Smart Spend.', allocations: [] };
  }

  const targetTotal = targets.demoAapl + targets.demoNvda;
  if (targetTotal !== 10_000) {
    return { assetKey: undefined, reason: 'Target allocations must add up to 100%.', allocations: [] };
  }

  const allocations = calculatePortfolioAllocations(balances, invoice.amountUsdt0, stablecoinDecimals, targets);
  const eligible = allocations.filter((allocation) => allocation.canCoverInvoice);
  const overweight = eligible
    .filter((allocation) => allocation.currentAllocationBps > allocation.targetAllocationBps)
    .sort((left, right) => {
      const delta = (right.currentAllocationBps - right.targetAllocationBps)
        - (left.currentAllocationBps - left.targetAllocationBps);
      return delta || left.key.localeCompare(right.key);
    });
  const selected = overweight[0] ?? [...eligible].sort((left, right) => {
    const leftDistance = Math.abs(left.currentAllocationBps - left.targetAllocationBps);
    const rightDistance = Math.abs(right.currentAllocationBps - right.targetAllocationBps);
    return leftDistance - rightDistance || left.key.localeCompare(right.key);
  })[0];

  if (!selected) {
    return {
      assetKey: undefined,
      reason: 'Neither supported demo asset has enough balance to cover this invoice.',
      allocations,
    };
  }

  const label = portfolioAssets[selected.key].label;
  const delta = selected.currentAllocationBps - selected.targetAllocationBps;
  if (delta > 0) {
    return {
      assetKey: selected.key,
      reason: `Recommended ${label} because it is ${allocationDeltaLabel(delta)} above your target allocation.`,
      allocations,
    };
  }
  if (delta === 0) {
    return {
      assetKey: selected.key,
      reason: `Recommended ${label} because it is at your target allocation and can cover this invoice.`,
      allocations,
    };
  }
  return {
    assetKey: selected.key,
    reason: `Recommended ${label} because no eligible overweight asset can cover this invoice.`,
    allocations,
  };
}

export function formatAllocationPercent(bps: number): string {
  return `${(bps / 100).toFixed(1).replace(/\.0$/, '')}%`;
}

export function formatPortfolioValue(valueUsdMicro: bigint): string {
  return `${formatUnits(valueUsdMicro, USD_PRICE_DECIMALS)} USD`;
}
