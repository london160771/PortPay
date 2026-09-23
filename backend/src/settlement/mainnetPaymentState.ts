export const mainnetPaymentStates = [
  'pending',
  'prepared',
  'ready',
  'submitted',
  'confirming',
  'paid',
  'failed',
  'expired',
] as const;

export type MainnetPaymentState = (typeof mainnetPaymentStates)[number];

const transitions: Record<MainnetPaymentState, readonly MainnetPaymentState[]> = {
  pending: ['prepared', 'failed', 'expired'],
  prepared: ['ready', 'failed', 'expired'],
  ready: ['submitted', 'failed', 'expired'],
  submitted: ['confirming', 'failed'],
  confirming: ['paid', 'failed'],
  paid: [],
  failed: [],
  expired: [],
};

export function canTransitionMainnetPaymentState(
  from: MainnetPaymentState,
  to: MainnetPaymentState,
): boolean {
  return transitions[from].includes(to);
}

export function assertMainnetPaymentStateTransition(
  from: MainnetPaymentState,
  to: MainnetPaymentState,
): void {
  if (!canTransitionMainnetPaymentState(from, to)) {
    throw new Error(`Invalid mainnet payment state transition: ${from} -> ${to}.`);
  }
}
