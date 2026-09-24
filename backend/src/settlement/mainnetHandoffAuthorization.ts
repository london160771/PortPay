import type { MainnetPreparationEvidence } from './mainnetReconciliationRepository.js';

export function mainnetHandoffAuthorizationMessage(evidence: MainnetPreparationEvidence): string {
  return [
    'PortPay Mainnet Pay authorization',
    'Chain ID: 196',
    `Invoice ID: ${evidence.invoiceId}`,
    `Preparation ID: ${evidence.id}`,
    `Preparation hash: ${evidence.preparationHash}`,
    `Calldata hash: ${evidence.attributedSwapCalldataHash}`,
    `Buyer: ${evidence.buyer}`,
    `Expires at: ${evidence.expiresAt}`,
    'This authorizes one wallet handoff, not payment.',
  ].join('\n');
}
