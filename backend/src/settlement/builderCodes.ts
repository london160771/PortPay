import { Attribution } from 'ox/erc8021';
import type { Hex } from 'viem';

export function toMainnetBuilderCodeDataSuffix(code: string | undefined): Hex | undefined {
  const normalized = code?.trim();
  return normalized && /^[a-z0-9]{16}$/.test(normalized)
    ? Attribution.toDataSuffix({ codes: [normalized] })
    : undefined;
}

export function appendBuilderCodeSuffix(data: Hex, dataSuffix: Hex): Hex {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(data) || !/^0x(?:[0-9a-fA-F]{2})+$/.test(dataSuffix)) {
    throw new Error('Builder Code calldata must be hex encoded.');
  }
  return `0x${data.slice(2)}${dataSuffix.slice(2)}` as Hex;
}
