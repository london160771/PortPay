import { describe, expect, it } from 'vitest';
import { LOCAL_MAINNET_PREFLIGHT_INPUT_BASE_UNITS, localMainnetPreflightParticipants } from './mainnetPreflightLocal.js';

describe('local mainnet preflight defaults', () => {
  it('pins the requested fixed input and established proof participants', () => {
    expect(LOCAL_MAINNET_PREFLIGHT_INPUT_BASE_UNITS).toBe('4800000000000000');
    expect(localMainnetPreflightParticipants).toEqual({
      buyer: '0xbabdfef588cf57efcc7c8857960e3ccdd9167589',
      merchant: '0x815c2fb8178f0bf80ada8c5b97ff44ece90e6e25',
    });
  });
});
