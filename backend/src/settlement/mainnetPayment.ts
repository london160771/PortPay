import { Attribution } from 'ox/erc8021';
import { createPublicClient, http, verifyMessage, type Address, type Hex } from 'viem';
import type { Invoice } from '../invoices/types.js';
import { mainnetAddressConfig, xLayerMainnetChain } from '../config/xlayerMainnet.js';
import { verifyMainnetBuilderCode, type MainnetBuilderCodeCheck } from './mainnetBuilderCodes.js';
import { mainnetHandoffAuthorizationMessage } from './mainnetHandoffAuthorization.js';
import {
  estimateBufferedGas,
  readMainnetBalances,
  type MainnetReadOnlyClient,
} from './mainnetPreflight.js';
import {
  createMainnetReconciliationRepository,
  type MainnetPreparationEvidence,
  type MainnetReconciliationRepository,
} from './mainnetReconciliationRepository.js';
import {
  validatePersistedMainnetPreparation,
  verifyMainnetReceipt,
  type MainnetReceiptClient,
  type MainnetReceiptVerification,
} from './mainnetReceipt.js';

export type MainnetReadinessRecheck = {
  status: 'READY' | 'SUBMITTED' | 'HANDOFF_UNRESOLVED' | 'BLOCKED' | 'EXPIRED' | 'WRONG_CHAIN' | 'WRONG_RECIPIENT'
    | 'INVALID_ATTRIBUTION' | 'INSUFFICIENT_BALANCE' | 'INSUFFICIENT_ALLOWANCE' | 'INSUFFICIENT_GAS';
  ready: boolean;
  reason: string;
  preparationId: string;
  preparationHash?: Hex;
  expiresAt?: string;
  snapshotBlockNumber?: string;
  handoffId?: string;
  handoffStartedAt?: string;
  transactionHash?: Hex;
  walletTransaction?: {
    from: Address;
    to: Address;
    data: Hex;
    value: string;
    chainId: 196;
  };
  checkedAt: string;
};

export type MainnetPaymentService = {
  getAttemptStatus(invoice: Invoice): Promise<'none' | 'unresolved' | 'submitted'>;
  recheck(invoice: Invoice, preparationId: string, buyerAddress: Address, buyerSignature: Hex): Promise<MainnetReadinessRecheck>;
  recordSubmission(invoice: Invoice, preparationId: string, handoffId: string, transactionHash: Hex): Promise<{ status: 'submitted'; preparationId: string; handoffId: string; transactionHash: Hex; submittedAt: string; expiresAt: string }>;
  recoverSubmission(invoice: Invoice, preparationId: string, buyerAddress: Address): Promise<{ status: 'submitted'; preparationId: string; handoffId: string; transactionHash: Hex; submittedAt: string; expiresAt: string } | null>;
  reconcile(invoice: Invoice, preparationId: string, transactionHash: Hex): Promise<{ verification: MainnetReceiptVerification; preparation: MainnetPreparationEvidence }>;
};

export type MainnetPaymentServiceDependencies = {
  createRepository?: () => MainnetReconciliationRepository;
  publicClient?: MainnetReadOnlyClient & MainnetReceiptClient;
  now?: () => Date;
  verifyBuilderCode?: (options: { code: string; expectedPayoutAddress?: string }) => Promise<MainnetBuilderCodeCheck>;
  confirmationDepth?: number;
  mainnetBuilderCode?: string;
  mainnetBuilderPayoutAddress?: string;
  verifyBuyerHandoffSignature?: (options: { buyer: Address; message: string; signature: Hex }) => Promise<boolean>;
};

function defaultPublicClient(): MainnetReadOnlyClient & MainnetReceiptClient {
  return createPublicClient({
    chain: xLayerMainnetChain,
    transport: http(xLayerMainnetChain.rpcUrls.default.http[0]),
  }) as unknown as MainnetReadOnlyClient & MainnetReceiptClient;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Mainnet verification failed.';
}

function assertExactObservedTransaction(evidence: MainnetPreparationEvidence, transaction: Awaited<ReturnType<MainnetReceiptClient['getTransaction']>>): void {
  if (!transaction.to || transaction.from.toLowerCase() !== evidence.buyer.toLowerCase()) {
    throw new Error('Observed mainnet transaction sender or target does not match the persisted preparation.');
  }
  if (transaction.to.toLowerCase() !== evidence.router.toLowerCase()
    || transaction.value !== 0n
    || transaction.input !== evidence.attributedSwapCalldata) {
    throw new Error('Observed mainnet transaction is not byte-for-byte identical to the persisted attributed swap.');
  }
  let codes: readonly string[];
  try { codes = Attribution.fromData(transaction.input)?.codes ?? []; }
  catch { throw new Error('Observed mainnet transaction has malformed Builder Code attribution.'); }
  if (codes.length !== 1 || codes[0] !== evidence.builderCode) {
    throw new Error('Observed mainnet transaction Builder Code does not match the persisted preparation.');
  }
}

function verifyConfiguredBuilderCode(
  evidence: MainnetPreparationEvidence,
  verify: NonNullable<MainnetPaymentServiceDependencies['verifyBuilderCode']>,
  configuredCode: string | undefined,
  payout: string | undefined,
): Promise<MainnetBuilderCodeCheck> {
  if (!configuredCode || configuredCode !== evidence.builderCode || !payout
    || payout.toLowerCase() !== evidence.builderPayout.toLowerCase()) {
    throw new Error('Configured mainnet Builder Code and payout do not match immutable preparation evidence.');
  }
  return verify({ code: configuredCode, expectedPayoutAddress: payout });
}

function handoffMatchesPreparation(
  handoff: NonNullable<Awaited<ReturnType<MainnetReconciliationRepository['getHandoffForInvoice']>>>,
  invoice: Invoice,
  evidence: MainnetPreparationEvidence,
): boolean {
  const handoffTime = Date.parse(handoff.handoffStartedAt);
  return handoff.invoiceId === invoice.id && handoff.preparationId === evidence.id
    && handoff.chainId === 196 && handoff.buyer.toLowerCase() === evidence.buyer.toLowerCase()
    && handoff.preparationHash === evidence.preparationHash
    && handoff.calldataHash === evidence.attributedSwapCalldataHash
    && Number.isFinite(handoffTime) && handoffTime >= Date.parse(evidence.preparedAt)
    && handoffTime < Date.parse(evidence.expiresAt);
}

function submissionMatchesHandoff(
  submission: NonNullable<Awaited<ReturnType<MainnetReconciliationRepository['getSubmissionForPreparation']>>>,
  handoff: NonNullable<Awaited<ReturnType<MainnetReconciliationRepository['getHandoffForInvoice']>>>,
  invoice: Invoice,
  evidence: MainnetPreparationEvidence,
): boolean {
  return submission.preparationId === evidence.id && submission.invoiceId === invoice.id
    && submission.handoffId === handoff.id && submission.chainId === 196
    && /^0x[0-9a-fA-F]{64}$/.test(submission.transactionHash);
}

export function createMainnetPaymentService(dependencies: MainnetPaymentServiceDependencies = {}): MainnetPaymentService {
  const repositoryFactory = dependencies.createRepository ?? createMainnetReconciliationRepository;
  const publicClient = dependencies.publicClient ?? defaultPublicClient();
  const now = dependencies.now ?? (() => new Date());
  const verifyBuilder = dependencies.verifyBuilderCode ?? verifyMainnetBuilderCode;
  const configuredBuilderCode = dependencies.mainnetBuilderCode ?? mainnetAddressConfig.builderCode;
  const configuredBuilderPayout = dependencies.mainnetBuilderPayoutAddress ?? mainnetAddressConfig.builderPayoutAddress;
  const verifyBuyerHandoffSignature = dependencies.verifyBuyerHandoffSignature
    ?? (({ buyer, message, signature }) => verifyMessage({ address: buyer, message, signature }));

  return {
    async getAttemptStatus(invoice) {
      if (invoice.paymentNetwork !== 'x-layer-mainnet') return 'none';
      const repository = repositoryFactory();
      const handoff = await repository.getHandoffForInvoice(invoice.id);
      if (!handoff) return 'none';
      const evidence = await repository.getPreparation(handoff.preparationId);
      if (!evidence || !handoffMatchesPreparation(handoff, invoice, evidence)) {
        throw new Error('Existing Mainnet handoff does not match immutable invoice preparation.');
      }
      const submission = await repository.getSubmissionForPreparation(evidence.id);
      if (!submission) return 'unresolved';
      if (!submissionMatchesHandoff(submission, handoff, invoice, evidence)) {
        throw new Error('Existing Mainnet submission does not match immutable invoice handoff.');
      }
      return 'submitted';
    },
    async recheck(invoice, preparationId, buyerAddress, buyerSignature) {
      const checkedAt = now().toISOString();
      const blocked = (status: MainnetReadinessRecheck['status'], reason: string, evidence?: MainnetPreparationEvidence): MainnetReadinessRecheck => ({
        status, ready: false, reason, preparationId, checkedAt,
        ...(evidence ? { preparationHash: evidence.preparationHash, expiresAt: evidence.expiresAt } : {}),
      });
      try {
        if (invoice.paymentNetwork !== 'x-layer-mainnet') return blocked('BLOCKED', 'Mainnet readiness requires a mainnet-bound invoice.');
        if (invoice.status !== 'pending') return blocked('BLOCKED', 'Only a pending invoice can be rechecked.');
        const repository = repositoryFactory();
        const evidence = await repository.getPreparation(preparationId);
        if (!evidence) return blocked('BLOCKED', 'Persisted mainnet preparation was not found.');
        const binding = validatePersistedMainnetPreparation(evidence, invoice);
        if (evidence.buyer.toLowerCase() !== buyerAddress.toLowerCase()) return blocked('BLOCKED', 'Connected buyer does not match the persisted preparation.', evidence);
        if (!/^0x[0-9a-fA-F]{130}$/.test(buyerSignature)
          || !await verifyBuyerHandoffSignature({
            buyer: evidence.buyer, message: mainnetHandoffAuthorizationMessage(evidence), signature: buyerSignature,
          })) {
          return blocked('BLOCKED', 'A valid buyer wallet signature for this exact invoice and preparation is required.', evidence);
        }
        let handoff = await repository.getHandoffForInvoice(invoice.id);
        if (handoff && !handoffMatchesPreparation(handoff, invoice, evidence)) {
          return blocked('BLOCKED', 'The invoice handoff belongs to a different buyer, preparation, or calldata.', evidence);
        }
        if (handoff) {
          const submission = await repository.getSubmissionForPreparation(evidence.id);
          if (submission) {
            if (!submissionMatchesHandoff(submission, handoff, invoice, evidence)) {
              return blocked('BLOCKED', 'Existing submission evidence does not match the invoice handoff.', evidence);
            }
            return {
              status: 'SUBMITTED', ready: false,
              reason: 'A transaction hash is already recorded for this handoff. Resume that transaction only; no second wallet prompt is available.',
              preparationId, preparationHash: evidence.preparationHash, expiresAt: evidence.expiresAt,
              handoffId: handoff.id, handoffStartedAt: handoff.handoffStartedAt,
              transactionHash: submission.transactionHash, checkedAt: now().toISOString(),
            };
          }
          return {
            status: 'HANDOFF_UNRESOLVED', ready: false,
            reason: 'Payment status unresolved. This invoice already used its one Mainnet handoff; another swap wallet prompt is prohibited.',
            preparationId, preparationHash: evidence.preparationHash, expiresAt: evidence.expiresAt,
            handoffId: handoff.id, handoffStartedAt: handoff.handoffStartedAt,
            checkedAt: now().toISOString(),
          };
        }
        if (await publicClient.getChainId() !== 196) return blocked('WRONG_CHAIN', 'Read-only RPC is not X Layer Mainnet.', evidence);
        const currentTime = now().getTime();
        const expiresAt = Date.parse(evidence.expiresAt);
        if (!Number.isFinite(expiresAt) || currentTime >= expiresAt) {
          return blocked('EXPIRED', 'Preparation has expired and cannot authorize a new wallet handoff.', evidence);
        }
        const codeCheck = await verifyConfiguredBuilderCode(evidence, verifyBuilder, configuredBuilderCode, configuredBuilderPayout);
        if (codeCheck.status !== 'VERIFIED' || codeCheck.chainId !== 196
          || codeCheck.code !== evidence.builderCode
          || codeCheck.payoutAddress?.toLowerCase() !== evidence.builderPayout.toLowerCase()) {
          return blocked('INVALID_ATTRIBUTION', 'Mainnet Builder Code registration or payout no longer verifies.', evidence);
        }
        const balances = await readMainnetBalances(publicClient, evidence.quote, evidence.approval);
        if (balances.buyerAddress.toLowerCase() !== buyerAddress.toLowerCase()
          || balances.merchantAddress.toLowerCase() !== invoice.merchantAddress.toLowerCase()
          || balances.assetAddress.toLowerCase() !== binding.asset.toLowerCase()
          || balances.stablecoinAddress.toLowerCase() !== binding.stablecoin.toLowerCase()
          || balances.approvalSpender.toLowerCase() !== evidence.spender.toLowerCase()) {
          return blocked('BLOCKED', 'Fresh pinned balances do not match the persisted buyer, merchant, token, or spender.', evidence);
        }
        if (BigInt(balances.allowance) !== binding.input) return blocked('INSUFFICIENT_ALLOWANCE', 'Onchain allowance is no longer exactly equal to the prepared input amount.', evidence);
        if (BigInt(balances.assetBalance) < binding.input) return blocked('INSUFFICIENT_BALANCE', 'Buyer input-token balance no longer covers the exact prepared amount.', evidence);

        // Both estimates and the simulation consume only the byte-identical persisted attributed calls.
        const gas = await estimateBufferedGas(publicClient, evidence.approval, evidence.swap);
        balances.requiredGasWei = gas.requiredGasWei;
        balances.approvalGasEstimate = gas.approvalGasEstimate;
        balances.swapGasEstimate = gas.swapGasEstimate;
        balances.gasPriceWei = gas.gasPriceWei;
        await publicClient.call({
          account: evidence.swap.from,
          to: evidence.swap.to,
          data: evidence.attributedSwapCalldata,
          value: evidence.swap.value,
        });
        if (BigInt(balances.buyerOkbBalance) < BigInt(gas.requiredGasWei!)) return blocked('INSUFFICIENT_GAS', 'Buyer OKB balance is below the buffered requirement for the exact persisted calls.', evidence);
        if (now().getTime() >= Date.parse(evidence.expiresAt)) {
          return blocked('EXPIRED', 'Preparation expired before the server could authorize wallet handoff.', evidence);
        }
        handoff = await repository.createHandoff({
          preparationId: evidence.id,
          invoiceId: invoice.id,
          buyer: evidence.buyer,
          chainId: 196,
          preparationHash: evidence.preparationHash,
          calldataHash: evidence.attributedSwapCalldataHash,
        });
        if (!handoff) {
          const existing = await repository.getHandoffForInvoice(invoice.id);
          return blocked(existing ? 'HANDOFF_UNRESOLVED' : 'EXPIRED', existing
            ? 'This invoice already has a Mainnet handoff. No second swap wallet prompt is permitted.'
            : 'Preparation expired before the server could authorize wallet handoff.', evidence);
        }
        if (!handoffMatchesPreparation(handoff, invoice, evidence)) {
          return blocked('BLOCKED', 'The existing invoice handoff does not match this exact persisted preparation.', evidence);
        }
        const submitted = await repository.getSubmissionForPreparation(evidence.id);
        if (submitted) {
          if (!submissionMatchesHandoff(submitted, handoff, invoice, evidence)) {
            return blocked('BLOCKED', 'Existing submission evidence does not match the invoice handoff.', evidence);
          }
          return {
            status: 'SUBMITTED', ready: false,
            reason: 'A transaction hash is already recorded for this handoff. Resume that transaction only; no second wallet prompt is available.',
            preparationId, preparationHash: evidence.preparationHash, expiresAt: evidence.expiresAt,
            handoffId: handoff.id, handoffStartedAt: handoff.handoffStartedAt,
            transactionHash: submitted.transactionHash, checkedAt: now().toISOString(),
          };
        }
        return {
          status: 'READY', ready: true,
          reason: 'The persisted preparation hash, buyer, chain, invoice, exact allowance, balances, Builder Code, exact attributed gas estimates, and exact swap simulation passed. No replacement swap was requested.',
          preparationId, preparationHash: evidence.preparationHash, expiresAt: evidence.expiresAt,
          snapshotBlockNumber: balances.snapshotBlockNumber, handoffId: handoff.id,
          handoffStartedAt: handoff.handoffStartedAt,
          // These fields are copied from immutable persisted evidence after the handoff claim.
          // This response is the only wallet transaction source; no new OKX response is fetched.
          walletTransaction: {
            from: evidence.swap.from,
            to: evidence.swap.to,
            data: evidence.attributedSwapCalldata,
            value: evidence.swap.value.toString(),
            chainId: 196,
          },
          checkedAt: now().toISOString(),
        };
      } catch (error) {
        return blocked('BLOCKED', errorMessage(error));
      }
    },

    async recordSubmission(invoice, preparationId, handoffId, transactionHash) {
      if (invoice.paymentNetwork !== 'x-layer-mainnet') throw new Error('Mainnet submission requires a mainnet-bound invoice.');
      if (invoice.status !== 'pending') throw new Error('Only a pending invoice can accept a mainnet submission.');
      const repository = repositoryFactory();
      const evidence = await repository.getPreparation(preparationId);
      if (!evidence) throw new Error('Persisted mainnet preparation was not found.');
      validatePersistedMainnetPreparation(evidence, invoice);
      const handoff = await repository.getHandoff(handoffId);
      if (!handoff || handoff.preparationId !== preparationId || handoff.invoiceId !== invoice.id
        || handoff.chainId !== 196 || handoff.buyer.toLowerCase() !== evidence.buyer.toLowerCase()
        || handoff.preparationHash !== evidence.preparationHash || handoff.calldataHash !== evidence.attributedSwapCalldataHash
        || Date.parse(handoff.handoffStartedAt) < Date.parse(evidence.preparedAt)
        || Date.parse(handoff.handoffStartedAt) >= Date.parse(evidence.expiresAt)) {
        throw new Error('A matching server-recorded pre-expiry wallet handoff is required.');
      }
      if (await publicClient.getChainId() !== 196) throw new Error('Submission observation RPC is not X Layer Mainnet.');
      const [transaction, codeCheck] = await Promise.all([
        publicClient.getTransaction({ hash: transactionHash }),
        verifyConfiguredBuilderCode(evidence, verifyBuilder, configuredBuilderCode, configuredBuilderPayout),
      ]);
      if (codeCheck.status !== 'VERIFIED' || codeCheck.chainId !== 196
        || codeCheck.code !== evidence.builderCode
        || codeCheck.payoutAddress?.toLowerCase() !== evidence.builderPayout.toLowerCase()) {
        throw new Error('Mainnet Builder Code registration or payout does not verify.');
      }
      assertExactObservedTransaction(evidence, transaction);
      const recorded = await repository.recordSubmission({ preparationId, handoffId, invoiceId: invoice.id, chainId: 196, transactionHash });
      if (!recorded) throw new Error('A different transaction or preparation is already recorded for this invoice.');
      return { status: 'submitted', preparationId, handoffId, transactionHash, submittedAt: recorded.submittedAt, expiresAt: evidence.expiresAt };
    },

    async recoverSubmission(invoice, preparationId, buyerAddress) {
      if (invoice.paymentNetwork !== 'x-layer-mainnet' || invoice.status !== 'pending') {
        throw new Error('Submission recovery requires a pending Mainnet invoice.');
      }
      const repository = repositoryFactory();
      const evidence = await repository.getPreparation(preparationId);
      if (!evidence) throw new Error('Persisted mainnet preparation was not found.');
      validatePersistedMainnetPreparation(evidence, invoice);
      if (evidence.buyer.toLowerCase() !== buyerAddress.toLowerCase()) {
        throw new Error('Submission recovery buyer does not match the persisted preparation.');
      }
      const submission = await repository.getSubmissionForPreparation(preparationId);
      if (!submission) return null;
      const handoff = await repository.getHandoff(submission.handoffId);
      if (!handoff || submission.preparationId !== evidence.id || submission.invoiceId !== invoice.id
        || submission.chainId !== 196 || !/^0x[0-9a-fA-F]{64}$/.test(submission.transactionHash)
        || handoff.id !== submission.handoffId || handoff.preparationId !== evidence.id
        || handoff.invoiceId !== invoice.id || handoff.chainId !== 196
        || handoff.buyer.toLowerCase() !== evidence.buyer.toLowerCase()
        || handoff.preparationHash !== evidence.preparationHash
        || handoff.calldataHash !== evidence.attributedSwapCalldataHash
        || Date.parse(submission.submittedAt) < Date.parse(handoff.handoffStartedAt)
        || Date.parse(handoff.handoffStartedAt) < Date.parse(evidence.preparedAt)
        || Date.parse(handoff.handoffStartedAt) >= Date.parse(evidence.expiresAt)) {
        throw new Error('Persisted submission does not match its immutable preparation and handoff.');
      }
      return {
        status: 'submitted', preparationId, handoffId: handoff.id,
        transactionHash: submission.transactionHash, submittedAt: submission.submittedAt, expiresAt: evidence.expiresAt,
      };
    },

    async reconcile(invoice, preparationId, transactionHash) {
      const exactPaidRetry = invoice.status === 'paid'
        && invoice.paymentNetwork === 'x-layer-mainnet'
        && invoice.paymentTxHash?.toLowerCase() === transactionHash.toLowerCase();
      if (invoice.status !== 'pending' && !exactPaidRetry) {
        throw new Error('Only a pending invoice or an exact verified mainnet retry can be reconciled through the mainnet path.');
      }
      if (invoice.paymentNetwork !== 'x-layer-mainnet') {
        throw new Error('A mainnet-bound invoice is required for mainnet reconciliation.');
      }
      const repository = repositoryFactory();
      const evidence = await repository.getPreparation(preparationId);
      if (!evidence) throw new Error('Persisted mainnet preparation was not found.');
      const verification = await verifyMainnetReceipt({
        publicClient,
        repository,
        preparationId,
        invoice,
        txHash: transactionHash,
        configuredMainnetBuilderCode: configuredBuilderCode,
        expectedBuilderPayoutAddress: configuredBuilderPayout,
        confirmationDepth: dependencies.confirmationDepth,
        verifyBuilderCode: verifyBuilder,
      });
      return { verification, preparation: evidence };
    },
  };
}
