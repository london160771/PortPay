import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Address } from 'viem';
import { formatUnits } from 'viem';
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useSendTransaction,
  useSignMessage,
  useWriteContract,
} from 'wagmi';
import {
  ApiError,
  createInvoice as createInvoiceRequest,
  createSettlementQuote,
  getBuyerPaymentHistory,
  getInvoice,
  getMerchantInvoices,
  getMerchantPaymentHistory,
  reconcileInvoicePayment,
  prepareMainnetApproval,
  preflightMainnetReadiness,
  recheckMainnetReadiness,
  recordMainnetSubmission,
  recoverMainnetSubmission,
  reconcileMainnetPayment,
  type Invoice,
  type MainnetApprovalPreparation,
  type MainnetApprovalPreparationResponse,
  type MainnetAssetKey,
  type MainnetSubmissionResponse,
  type SettlementQuote,
} from './config/api';
import { erc20BalanceAbi, formatTokenBalance, mainnetAssets, parseConfiguredAddress, portfolioAssets, testnetAssets } from './config/assets';
import { internalTestnetNetworkConfig, mainnetNetworkConfig, xLayerMainnet, xLayerTestnet } from './config/network';
import { invoiceStatusLabel, paymentStatusLabel, paymentSuccessLabel, readInvoiceRoute, showBuyerSelectionDetails, type InvoiceRoute } from './config/invoice';
import {
  formatPaymentTimestamp,
  formatReceivedAmount,
  formatSpentAmount,
  getInvoicePaymentNetwork,
  getExplorerTransactionUrl,
  hasVerifiedPaymentEvidence,
  isOfficialSettlementAsset,
  paymentNetworkLabel,
} from './config/history';
import { needsApproval, validatePaymentQuote } from './config/payment';
import {
  DEFAULT_TARGET_ALLOCATION_BPS,
  formatAllocationPercent,
  recommendSmartSpend,
  snapshotSmartSpendChoice,
  type SmartSpendAssetKey,
  type TargetAllocationBps,
} from './config/smartSpend';
import { portPaySettlementAbi, type SettlementWriteQuote } from './config/settlement';
import { getInternalTestnetWalletNetworkState, getWalletNetworkState, shortenAddress } from './config/wallet';
import { okxWalletConnector } from './config/wagmi';
import {
  assertRegisteredBuilderCode,
  BuilderCodeVerificationError,
  builderCodeTransactionData,
  portPayBuilderCode,
  readBuilderCodePayoutAddress,
} from './config/builderCodes';
import { hasExactMainnetAllowance, isSamePersistedMainnetPreparation, validatePreparedMainnetApproval } from './config/mainnetApproval';
import { createMainnetPreparationRequestCoordinator } from './config/mainnetPreparationRequests';
import {
  canOfferMainnetPay,
  clearMainnetSubmissionRecovery,
  mainnetPreparationNeedsRefresh,
  readyMainnetPreparationNeedsRefresh,
  MAINNET_PRE_PROMPT_MIN_REMAINING_MS,
  readMainnetSubmissionRecovery,
  saveMainnetSubmissionRecovery,
  validateMainnetPrePromptReadiness,
  validateReadyMainnetHandoff,
  type MainnetSubmissionRecovery,
} from './config/mainnetPayment';


type TokenBalanceCardProps = {
  asset: (typeof mainnetAssets)[keyof typeof mainnetAssets];
  account: Address | undefined;
  canRead: boolean;
};

function TokenBalanceCard({ asset, account, canRead }: TokenBalanceCardProps) {
  const address = parseConfiguredAddress(asset.address);
  const queryEnabled = canRead && Boolean(address && account);
  const { data: balance, isError: balanceError, isLoading: balanceLoading } = useReadContract({
    address,
    abi: erc20BalanceAbi,
    functionName: 'balanceOf',
    args: account ? [account] : undefined,
    chainId: xLayerMainnet.id,
    query: { enabled: queryEnabled },
  });
  const { data: decimals, isError: decimalsError, isLoading: decimalsLoading } = useReadContract({
    address,
    abi: erc20BalanceAbi,
    functionName: 'decimals',
    chainId: xLayerMainnet.id,
    query: { enabled: queryEnabled },
  });

  const formattedBalance = formatTokenBalance(balance, decimals);
  const isLoading = balanceLoading || decimalsLoading;
  const readFailed = balanceError || decimalsError;

  let detail = 'Connect OKX Wallet on X Layer Mainnet to read this balance.';
  if (!address) {
    detail = `Address not configured yet. Deploy ${asset.label}, then set its VITE_* address variable.`;
  } else if (canRead && isLoading) {
    detail = 'Reading token balance and decimals…';
  } else if (canRead && readFailed) {
    detail = 'Unable to read this token at the configured address.';
  } else if (canRead && formattedBalance !== undefined) {
    detail = 'Read from the token contract on X Layer Mainnet.';
  }

  return (
    <article className="wallet-balance-card portpay-appear rounded-2xl border border-ink/10 bg-paper p-4 text-ink shadow-panel transition hover:-translate-y-0.5 hover:shadow-soft">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/45">Wallet balance</p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight">{asset.label}</h3>
        </div>
        <span className="rounded-full bg-mint/75 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-ink">Mainnet</span>
      </div>
      <p className="mt-3 min-h-12 text-sm leading-6 text-ink/55">{asset.description}</p>
      <p className="mt-6 text-3xl font-semibold tracking-tight">
        {formattedBalance ?? '—'} <span className="text-base font-medium text-ink/50">{asset.label}</span>
      </p>
      <p className="mt-2 text-xs leading-5 text-ink/45">{detail}</p>
    </article>
  );
}

function WalletPanel() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, error: connectError, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { error: switchError, isPending: isSwitching, switchChain } = useSwitchChain();
  const networkState = getWalletNetworkState(isConnected, chainId);
  const canReadBalances = networkState === 'ready' && Boolean(address);

  return (
    <section className="wallet-panel portpay-appear relative overflow-hidden rounded-[1.75rem] border border-ink/10 bg-paper p-5 text-ink shadow-panel sm:p-6">
      <div className="portpay-grid pointer-events-none absolute inset-0 opacity-30" />
      <div className="relative">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Merchant wallet</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Ready to collect</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-ink/60">
            Connect OKX Wallet to create invoices and payment links for X Layer Mainnet.
          </p>
        </div>
        <span
          className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${
            networkState === 'ready'
              ? 'bg-mint text-ink'
              : networkState === 'wrong-network'
                ? 'bg-amber-300 text-amber-950'
                : 'bg-cloud text-ink/60'
          }`}
        >
          {networkState === 'ready'
            ? 'X LAYER MAINNET'
            : networkState === 'wrong-network'
              ? 'WRONG NETWORK'
              : 'NOT CONNECTED'}
        </span>
      </div>

      {!isConnected ? (
        <div className="mt-7">
          <button
            type="button"
            className="portpay-button portpay-button--primary rounded-xl bg-mint px-5 py-3 text-sm font-bold text-ink transition hover:bg-white disabled:cursor-wait disabled:opacity-60"
            onClick={() => connect({ connector: okxWalletConnector })}
            disabled={isConnecting}
          >
            {isConnecting ? 'Opening OKX Wallet…' : 'Connect OKX Wallet'}
          </button>
          <p className="mt-3 text-xs text-ink/50">OKX Wallet must be installed and unlocked in this browser.</p>
          {connectError ? <p className="mt-3 text-sm text-rose-700">{connectError.message}</p> : null}
      </div>
      ) : networkState === 'wrong-network' ? (
        <div className="mt-7 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-950">Switch to X Layer Mainnet to create invoices.</p>
          <p className="mt-1 text-xs text-amber-900/75">
            This wallet is connected on chain {chainId ?? 'unknown'}; PortPay merchant actions require chain 196.
          </p>
          <button
            type="button"
            className="portpay-button portpay-button--network mt-4 rounded-xl bg-amber-200 px-4 py-2.5 text-sm font-bold text-amber-950 transition hover:bg-white disabled:cursor-wait disabled:opacity-60"
            onClick={() => switchChain({ chainId: xLayerMainnet.id })}
            disabled={isSwitching}
          >
            {isSwitching ? 'Switching network…' : 'Switch to X Layer Mainnet'}
          </button>
          {switchError ? <p className="mt-3 text-sm text-rose-700">{switchError.message}</p> : null}
        </div>
      ) : (
        <div className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
          <p className="text-sm font-semibold text-emerald-700">Wallet connected to X Layer Mainnet</p>
            <p className="mt-1 font-mono text-sm text-ink/60">{shortenAddress(address!)}</p>
          </div>
          <button
            type="button"
            className="rounded-xl border border-ink/15 px-4 py-2.5 text-sm font-semibold text-ink/65 transition hover:border-ink/30 hover:text-ink"
            onClick={() => disconnect()}
          >
            Disconnect
          </button>
        </div>
      )}

      <div className="mt-7 grid gap-3 border-t border-ink/10 pt-5 text-xs text-ink/50 sm:grid-cols-2">
        <span>Network: {xLayerMainnet.name}</span>
        <span>Chain ID: {mainnetNetworkConfig.chainId}</span>
        <span>Gas: {xLayerMainnet.nativeCurrency.symbol}</span>
        <span>Invoices: Supabase/Postgres</span>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <TokenBalanceCard asset={mainnetAssets.wNvda} account={address} canRead={canReadBalances} />
        <TokenBalanceCard asset={mainnetAssets.wAapl} account={address} canRead={canReadBalances} />
        <TokenBalanceCard asset={mainnetAssets.usdt0} account={address} canRead={canReadBalances} />
      </div>
      </div>
    </section>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      aria-label="Copy payment link"
      className="portpay-button copy-link-button rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-ink/80"
      onClick={copyValue}
    >
      {copied ? 'Copied' : 'Copy link'}
    </button>
  );
}

function InvoiceForm({
  merchantAddress,
  canCreate,
  onCreated,
}: {
  merchantAddress: Address | undefined;
  canCreate: boolean;
  onCreated: (invoice: Invoice) => void;
}) {
  const [title, setTitle] = useState('');
  const [amountUsdt0, setAmountUsdt0] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submitInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!canCreate || !merchantAddress) {
      setError('Connect the merchant wallet on X Layer Mainnet first.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createInvoiceRequest({ title, amountUsdt0, merchantAddress });
      onCreated(result.invoice);
      setTitle('');
      setAmountUsdt0('');
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Unable to create this invoice.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section id="create-invoice" className="merchant-form-card portpay-appear rounded-3xl border border-ink/10 bg-paper p-6 shadow-panel sm:p-7">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/45">Step 1 · Create</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">Create a payment request</h2>
        <p className="mt-2 text-sm leading-6 text-ink/55">
          Set the amount your business receives in real USD₮0. PortPay creates a hosted payment link for your customer.
        </p>
      </div>

      <form className="mt-5 space-y-4" onSubmit={submitInvoice}>
        <label className="block">
          <span className="text-sm font-semibold">Product or service name</span>
          <input
            className="portpay-input mt-2 w-full rounded-xl border border-ink/15 bg-cloud px-4 py-3 text-sm outline-none transition focus:border-electric/70 focus:bg-white"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Harbor design consultation"
            maxLength={120}
            required
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold">Amount due in USD₮0</span>
            <div className="portpay-input-group mt-2 flex items-center rounded-xl border border-ink/15 bg-cloud focus-within:border-electric/70 focus-within:bg-white">
            <input
              className="portpay-input min-w-0 flex-1 bg-transparent px-4 py-3 text-sm outline-none"
              value={amountUsdt0}
              onChange={(event) => setAmountUsdt0(event.target.value)}
              placeholder="20.00"
              inputMode="decimal"
              required
            />
            <span className="px-4 text-sm font-semibold text-ink/50">USD₮0</span>
          </div>
          <span className="mt-2 block text-xs text-ink/45">Positive amount, up to 6 decimal places.</span>
        </label>

        {error ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

        <button
          type="submit"
          className="portpay-button portpay-button--primary w-full rounded-xl bg-ink px-5 py-3.5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-ink/85 hover:shadow-panel disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canCreate || isSubmitting}
        >
          {isSubmitting ? 'Saving invoice…' : 'Create invoice and payment link'}
        </button>
        {!canCreate ? (
          <p className="text-center text-xs text-ink/45">Connect and switch to X Layer Mainnet to enable invoice creation.</p>
        ) : null}
      </form>
    </section>
  );
}

function InvoiceStatusPill({ status, label }: { status: Invoice['status']; label?: string }) {
  return (
    <span
      aria-label={`Invoice status: ${label ?? invoiceStatusLabel(status)}`}
      className={`invoice-status-pill rounded-full px-3 py-1 text-xs font-bold ${
        status === 'paid' ? 'bg-mint text-ink' : 'bg-amber-100 text-amber-900'
      }`}
    >
      {label ?? invoiceStatusLabel(status)}
    </span>
  );
}

function PaymentHistoryPanel({
  address,
  canRead,
  onOpenInvoice,
  view,
}: {
  address: Address | undefined;
  canRead: boolean;
  onOpenInvoice: (invoiceId: string) => void;
  view: 'buyer' | 'merchant';
}) {
  const [payments, setPayments] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;
    if (!canRead || !address) {
      setPayments([]);
      setLoadError('');
      return () => {
        active = false;
      };
    }

    setIsLoading(true);
    setLoadError('');
    const loadHistory = view === 'merchant' ? getMerchantPaymentHistory(address) : getBuyerPaymentHistory(address);
    loadHistory
      .then((result) => {
        if (active) setPayments(result.payments.filter((payment) => payment.status === 'paid'));
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof ApiError ? error.message : 'Unable to load payment history.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [address, canRead, view]);

  return (
    <section id="history" className="payment-history-panel portpay-appear rounded-2xl border border-ink/10 bg-paper p-5 shadow-panel sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/45">Step 3 · History</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            {view === 'merchant' ? 'What this wallet received' : 'What this wallet spent'}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/55">
          Confirmed payments only. Each row is backed by persisted evidence and links to its transaction on the correct X Layer explorer.
          </p>
        </div>
        <span className="rounded-full bg-cloud px-3 py-2 text-xs font-semibold text-ink/55">
          {view === 'merchant' ? 'Merchant history' : 'Buyer history'}
        </span>
      </div>

      {isLoading ? <p className="mt-7 rounded-2xl bg-cloud p-5 text-sm text-ink/55">Loading confirmed payment history…</p> : null}
      {loadError ? <p className="mt-7 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</p> : null}
      {!canRead || !address ? (
        <p className="mt-7 rounded-2xl bg-cloud p-5 text-sm leading-6 text-ink/55">
          Connect a wallet on X Layer Mainnet to load its payment history.
        </p>
      ) : null}
      {canRead && address && !isLoading && !loadError && payments.length === 0 ? (
        <p className="mt-7 rounded-2xl bg-cloud p-5 text-sm leading-6 text-ink/55">
          No confirmed payments for this wallet yet.
        </p>
      ) : null}

      {payments.length > 0 ? (
        <div className="mt-7 space-y-3">
          {payments.map((payment) => {
            const paymentNetwork = getInvoicePaymentNetwork(payment);
            const explorerUrl = getExplorerTransactionUrl(payment.paymentTxHash, paymentNetwork);
            const evidenceComplete = hasVerifiedPaymentEvidence(payment);
            return (
              <article key={payment.id} className="payment-history-row group rounded-2xl border border-ink/10 bg-cloud/60 p-4 transition hover:border-ink/20 hover:bg-white sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <button type="button" className="text-left" onClick={() => onOpenInvoice(payment.id)}>
                    <p className="font-semibold group-hover:underline group-hover:underline-offset-4">{payment.title}</p>
                    <p className="mt-1 text-xs text-ink/45">
                      Paid {formatPaymentTimestamp(payment.paidAt)} · {paymentNetworkLabel(paymentNetwork)} · Invoice {payment.id.slice(0, 8)}…
                    </p>
                  </button>
                  <InvoiceStatusPill status={payment.status} label={view === 'buyer' ? 'Payment confirmed' : undefined} />
                </div>
                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.12em] text-ink/40">{view === 'buyer' ? 'You spent' : 'Buyer spent'}</p>
                    <p className="mt-1 font-semibold">{formatSpentAmount(payment)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.12em] text-ink/40">{view === 'merchant' ? 'You received' : 'Merchant received'}</p>
                    <p className="mt-1 font-semibold">{formatReceivedAmount(payment)}</p>
                  </div>
                </div>
                {showBuyerSelectionDetails(view) ? (
                  <div className="mt-4 rounded-xl border border-ink/10 bg-white/70 p-3 text-xs leading-5 text-ink/60">
                    {payment.smartSpendUsed ? (
                      <>
                        <span className="font-semibold text-ink">Smart Spend selected in checkout</span>
                        {payment.smartSpendRecommendedAsset ? ` · ${portfolioAssets[payment.smartSpendRecommendedAsset].label}` : ''}
                        {payment.smartSpendReason ? <span className="block">{payment.smartSpendReason}</span> : null}
                      </>
                    ) : (
                      <span><span className="font-semibold text-ink">Manual asset selection in checkout</span> · Smart Spend was not used.</span>
                    )}
                    <span className="mt-1 block">Choice and reason are checkout-reported; the settlement receipt verifies the asset and amounts.</span>
                  </div>
                ) : null}
                <div className="mt-4 flex flex-col gap-2 border-t border-ink/10 pt-3 text-xs text-ink/50 sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-mono">{payment.paymentTxHash ? `${payment.paymentTxHash.slice(0, 10)}…${payment.paymentTxHash.slice(-8)}` : 'Transaction evidence unavailable'}</span>
                  {explorerUrl ? (
                    <a className="font-semibold text-ink underline underline-offset-4" href={explorerUrl} target="_blank" rel="noreferrer">
                      Open receipt ↗
                    </a>
                  ) : (
                    <span>{evidenceComplete ? 'Explorer link unavailable' : 'Onchain evidence incomplete'}</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function DemoJourney() {
  const steps = [
    { number: '01', title: 'Request', detail: 'Merchant sets a real USD₮0 amount and shares one hosted link.' },
    { number: '02', title: 'Prepare', detail: 'Buyer reviews a supported tokenized asset and exact approval details.' },
    { number: '03', title: 'Confirm & verify', detail: 'Buyer confirms the prepared payment in their wallet; PortPay verifies canonical evidence before marking the invoice paid.' },
  ];

  return (
    <aside id="two-tab-demo" className="demo-journey-card portpay-appear rounded-[1.75rem] border border-ink/10 bg-paper p-5 text-ink shadow-panel sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Merchant + buyer flow</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">One invoice link. A clear payment path.</h2>
        </div>
        <span className="demo-journey-icon grid h-9 w-9 place-items-center rounded-xl bg-mint text-base font-semibold text-ink">↗</span>
      </div>
      <div className="demo-journey-steps mt-7 space-y-5">
        {steps.map((step, index) => (
          <div key={step.number} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span className="demo-journey-step-number grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cloud font-mono text-[10px] font-semibold text-ink/65">{step.number}</span>
              {index < steps.length - 1 ? <span className="mt-2 h-full w-px bg-ink/10" /> : null}
            </div>
            <div className={index < steps.length - 1 ? 'pb-1' : ''}>
              <p className="demo-journey-step-title font-semibold">{step.title}</p>
              <p className="demo-journey-step-detail mt-1 text-sm leading-6 text-ink/55">{step.detail}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="demo-journey-note mt-6 rounded-xl border border-emerald-900/10 bg-emerald-50 p-3 text-xs leading-5 text-ink/65">
        <span className="font-semibold text-emerald-800">Mainnet Pay.</span> Buyer-signed payment is implemented and requires explicit OKX Wallet confirmation. The backend never signs or broadcasts; paid status follows canonical verification. Real use remains subject to final review and authorization.
      </div>
    </aside>
  );
}

function MerchantDashboard({ onOpenMerchantInvoice }: { onOpenMerchantInvoice: (invoiceId: string) => void }) {
  const { address, chainId, isConnected } = useAccount();
  const networkState = getWalletNetworkState(isConnected, chainId);
  const canCreate = networkState === 'ready' && Boolean(address);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [createdInvoice, setCreatedInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    let active = true;
    if (!canCreate || !address) {
      setInvoices([]);
      setLoadError('');
      return () => {
        active = false;
      };
    }

    setIsLoading(true);
    setLoadError('');
    getMerchantInvoices(address)
      .then((result) => {
        if (active) setInvoices(result.invoices);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof ApiError ? error.message : 'Unable to load invoices.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [address, canCreate]);

  function handleCreated(invoice: Invoice) {
    setCreatedInvoice(invoice);
    setInvoices((current) => [invoice, ...current.filter((item) => item.id !== invoice.id)]);
  }

  const paidCount = invoices.filter((invoice) => invoice.status === 'paid').length;
  const pendingCount = invoices.filter((invoice) => invoice.status === 'pending').length;

  return (
    <>
      <section className="merchant-hero relative grid gap-8 overflow-hidden py-8 sm:py-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:py-12">
        <div className="portpay-grid pointer-events-none absolute inset-x-0 top-0 h-full opacity-50" />
        <div className="relative">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-ink/10 bg-white/75 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-ink/60 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
            Merchant workspace · X Layer Mainnet
          </div>
          <h1 className="merchant-hero__title max-w-3xl text-4xl font-semibold leading-[1] tracking-[-0.055em] sm:text-6xl">
            Spend portfolios.<br /><span className="text-ink/45">Receive stablecoins.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-ink/65">
            PortPay lets customers spend their tokenized stock portfolio while merchants receive stablecoins. Request payment in real USD₮0 and share one hosted link.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a href="#create-invoice" className="inline-flex items-center justify-center rounded-xl bg-ink px-5 py-3.5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-ink/85 hover:shadow-panel">
              Create an invoice <span className="ml-2 text-mint">↓</span>
            </a>
            <a href="#two-tab-demo" className="inline-flex items-center justify-center rounded-xl border border-ink/15 bg-white/60 px-5 py-3.5 text-sm font-semibold text-ink/70 transition hover:border-ink/35 hover:bg-white hover:text-ink">
              See the demo path <span className="ml-2">↘</span>
            </a>
          </div>
        </div>
        <DemoJourney />
      </section>

      <WalletPanel />

      <section className="merchant-metrics grid gap-4 py-6 sm:grid-cols-3">
        <div className="merchant-metric portpay-appear rounded-3xl border border-ink/10 bg-paper p-5 shadow-panel">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/45">All invoices</p>
          <p className="mt-3 text-4xl font-semibold tracking-tight">{invoices.length}</p>
          <p className="mt-2 text-sm text-ink/55">Stored for this merchant wallet.</p>
        </div>
        <div className="merchant-metric portpay-appear rounded-3xl border border-ink/10 bg-paper p-5 shadow-panel">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/45">Awaiting payment</p>
          <p className="mt-3 text-4xl font-semibold tracking-tight">{pendingCount}</p>
          <p className="mt-2 text-sm text-ink/55">Open requests waiting for a buyer.</p>
        </div>
        <div className="merchant-metric merchant-metric--paid portpay-appear rounded-3xl border border-ink/10 bg-ink p-5 text-white shadow-panel">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-mint/70">Payment received</p>
          <p className="mt-3 text-4xl font-semibold tracking-tight">{paidCount}</p>
          <p className="mt-2 text-sm text-white/55">Confirmed from settlement evidence.</p>
        </div>
      </section>

      <section className="grid gap-5 pb-6 lg:grid-cols-[0.9fr_1.1fr]">
        <InvoiceForm merchantAddress={address} canCreate={canCreate} onCreated={handleCreated} />

        <section className="merchant-invoice-list portpay-appear rounded-3xl border border-ink/10 bg-paper p-6 shadow-panel sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/45">Step 2 · Monitor</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Your payment requests</h2>
            </div>
            {isLoading ? <span className="text-xs text-ink/45">Loading…</span> : null}
          </div>

          {createdInvoice ? (
              <div className="payment-link-ready mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-800">Payment link ready</p>
              <p className="mt-2 font-semibold text-emerald-950">{createdInvoice.title}</p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 break-all rounded-xl bg-white px-3 py-2 text-xs text-emerald-950">
                  {createdInvoice.paymentUrl}
                </code>
                <CopyButton value={createdInvoice.paymentUrl} />
              </div>
              <button
                type="button"
                className="mt-3 text-sm font-semibold text-emerald-800 underline underline-offset-4"
                onClick={() => onOpenMerchantInvoice(createdInvoice.id)}
              >
                Open merchant invoice ↗
              </button>
            </div>
          ) : null}

          {loadError ? <p className="mt-6 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</p> : null}

          {!isConnected ? (
            <p className="mt-8 rounded-2xl bg-cloud p-5 text-sm leading-6 text-ink/55">
              Connect the merchant wallet to load its persisted invoices.
            </p>
          ) : invoices.length === 0 && !isLoading ? (
            <p className="mt-8 rounded-2xl bg-cloud p-5 text-sm leading-6 text-ink/55">
              No invoices yet. Once the wallet is connected to X Layer Mainnet, create the first payment request.
            </p>
          ) : (
            <div className="mt-6 divide-y divide-ink/10">
              {invoices.map((invoice) => (
                <button
                  key={invoice.id}
                  type="button"
                  className="merchant-invoice-row flex w-full items-center justify-between gap-4 py-4 text-left transition hover:bg-cloud/60"
                  onClick={() => onOpenMerchantInvoice(invoice.id)}
                >
                  <span className="merchant-invoice-row__main min-w-0">
                    <span className="merchant-invoice-row__title block truncate font-semibold">{invoice.title}</span>
                    <span className="merchant-invoice-row__meta mt-1 block text-xs text-ink/45">
                      {new Date(invoice.createdAt).toLocaleString()} · {shortenAddress(invoice.merchantAddress)}
                    </span>
                  </span>
                  <span className="merchant-invoice-row__amount flex shrink-0 flex-col items-end gap-2">
                    <span className="font-semibold">{invoice.amountUsdt0} USD₮0</span>
                    <InvoiceStatusPill status={invoice.status} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </section>

      <PaymentHistoryPanel address={address} canRead={canCreate} view="merchant" onOpenInvoice={onOpenMerchantInvoice} />
    </>
  );
}

type PaymentStep =
  | 'idle'
  | 'loading-quote'
  | 'awaiting-approval'
  | 'confirming-approval'
  | 'awaiting-payment-signature'
  | 'confirming-payment'
  | 'reconciling'
  | 'paid'
  | 'error';

function displayAmount(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

function paymentErrorMessage(error: unknown): string {
  if (error instanceof BuilderCodeVerificationError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  if (/reject|denied|user rejected|cancel/i.test(message)) return 'The wallet signature was rejected. No payment was completed.';
  if (/insufficient|balance/i.test(message)) return 'This wallet does not have enough selected demo asset or test OKB for the requested payment.';
  if (/revert|execution reverted|failed/i.test(message)) return 'The X Layer Testnet transaction was rejected. Check the balance, allowance, quote expiry, and settlement liquidity.';
  return message || 'The payment could not be completed.';
}

function BuyerWalletPanel({
  invoice,
  onPaid,
}: {
  invoice: Invoice;
  onPaid: (updatedInvoice: Invoice) => void;
}) {
  const { address, chainId, isConnected } = useAccount();
  const { connect, error: connectError, isPending: isConnecting } = useConnect();
  const { switchChain, error: switchError, isPending: isSwitching } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: xLayerTestnet.id });
  const networkState = getInternalTestnetWalletNetworkState(isConnected, chainId);
  const [selectedAssetKey, setSelectedAssetKey] = useState<SmartSpendAssetKey>('demoAapl');
  const [appliedSmartSpend, setAppliedSmartSpend] = useState<ReturnType<typeof snapshotSmartSpendChoice>>(undefined);
  const smartSpendApplied = Boolean(appliedSmartSpend);
  const [targetAllocation, setTargetAllocation] = useState<TargetAllocationBps>(DEFAULT_TARGET_ALLOCATION_BPS);
  const assetAddress = parseConfiguredAddress(portfolioAssets[selectedAssetKey].address);
  const demoAaplAddress = parseConfiguredAddress(portfolioAssets.demoAapl.address);
  const demoNvdaAddress = parseConfiguredAddress(portfolioAssets.demoNvda.address);
  const stablecoinAddress = parseConfiguredAddress(testnetAssets.usdt0.address);
  const settlementAddress = parseConfiguredAddress(internalTestnetNetworkConfig.settlementAddress);
  const balancesEnabled = networkState === 'ready' && Boolean(address);
  const { data: demoAaplBalance, isLoading: isAaplBalanceLoading, isError: isAaplBalanceError } = useReadContract({
    address: demoAaplAddress,
    abi: erc20BalanceAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: xLayerTestnet.id,
    query: { enabled: balancesEnabled && Boolean(demoAaplAddress) },
  });
  const { data: demoAaplDecimals, isLoading: isAaplDecimalsLoading } = useReadContract({
    address: demoAaplAddress,
    abi: erc20BalanceAbi,
    functionName: 'decimals',
    chainId: xLayerTestnet.id,
    query: { enabled: balancesEnabled && Boolean(demoAaplAddress) },
  });
  const { data: demoNvdaBalance, isLoading: isNvdaBalanceLoading, isError: isNvdaBalanceError } = useReadContract({
    address: demoNvdaAddress,
    abi: erc20BalanceAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: xLayerTestnet.id,
    query: { enabled: balancesEnabled && Boolean(demoNvdaAddress) },
  });
  const { data: demoNvdaDecimals, isLoading: isNvdaDecimalsLoading } = useReadContract({
    address: demoNvdaAddress,
    abi: erc20BalanceAbi,
    functionName: 'decimals',
    chainId: xLayerTestnet.id,
    query: { enabled: balancesEnabled && Boolean(demoNvdaAddress) },
  });
  const { data: stablecoinDecimals, isLoading: isStablecoinDecimalsLoading } = useReadContract({
    address: stablecoinAddress,
    abi: erc20BalanceAbi,
    functionName: 'decimals',
    chainId: xLayerTestnet.id,
    query: { enabled: balancesEnabled && Boolean(stablecoinAddress) },
  });
  const isBalanceLoading = isAaplBalanceLoading || isAaplDecimalsLoading || isNvdaBalanceLoading
    || isNvdaDecimalsLoading || isStablecoinDecimalsLoading;
  const isBalanceError = isAaplBalanceError || isNvdaBalanceError;
  const selectedAssetBalance = selectedAssetKey === 'demoAapl' ? demoAaplBalance : demoNvdaBalance;
  const smartSpendRecommendation = useMemo(
    () => recommendSmartSpend(
      [
        { key: 'demoAapl', balance: demoAaplBalance, decimals: demoAaplDecimals },
        { key: 'demoNvda', balance: demoNvdaBalance, decimals: demoNvdaDecimals },
      ],
      invoice,
      stablecoinDecimals,
      targetAllocation,
    ),
    [demoAaplBalance, demoAaplDecimals, demoNvdaBalance, demoNvdaDecimals, invoice, stablecoinDecimals, targetAllocation],
  );
  const [quote, setQuote] = useState<SettlementQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [paymentStep, setPaymentStep] = useState<PaymentStep>('idle');
  const [paymentError, setPaymentError] = useState('');
  const [confirmedPaymentHash, setConfirmedPaymentHash] = useState('');
  const isBusy = ['loading-quote', 'awaiting-approval', 'confirming-approval', 'awaiting-payment-signature', 'confirming-payment', 'reconciling'].includes(paymentStep);

  async function refreshQuote() {
    if (!address || networkState !== 'ready') return;
    setQuoteLoading(true);
    setQuoteError('');
    setPaymentError('');
    setPaymentStep('loading-quote');
    try {
      const result = await createSettlementQuote(invoice.id, address, selectedAssetKey);
      if (result.quote.assetKey !== selectedAssetKey) throw new Error('The backend returned a quote for a different asset.');
      setQuote(result.quote);
      setPaymentStep('idle');
    } catch (error) {
      setQuote(null);
      setPaymentStep('error');
      setQuoteError(error instanceof ApiError ? error.message : 'Unable to prepare a settlement quote.');
    } finally {
      setQuoteLoading(false);
    }
  }

  useEffect(() => {
    if (invoice.status !== 'pending' || !address || networkState !== 'ready') {
      setQuote(null);
      setQuoteError('');
      return;
    }

    let active = true;
    setQuoteLoading(true);
    setQuoteError('');
    setPaymentError('');
    setPaymentStep('loading-quote');
    createSettlementQuote(invoice.id, address, selectedAssetKey)
      .then((result) => {
        if (active) {
          if (result.quote.assetKey !== selectedAssetKey) throw new Error('The backend returned a quote for a different asset.');
          setQuote(result.quote);
          setPaymentStep('idle');
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setQuote(null);
          setPaymentStep('error');
          setQuoteError(error instanceof ApiError ? error.message : 'Unable to prepare a settlement quote.');
        }
      })
      .finally(() => {
        if (active) setQuoteLoading(false);
      });

    return () => {
      active = false;
    };
  }, [address, invoice.id, invoice.status, networkState, selectedAssetKey]);

  function selectManualAsset(assetKey: SmartSpendAssetKey) {
    setSelectedAssetKey(assetKey);
    setAppliedSmartSpend(undefined);
    setQuote(null);
    setQuoteError('');
  }

  function applySmartSpend() {
    const choice = snapshotSmartSpendChoice(smartSpendRecommendation);
    if (!choice) return;
    setSelectedAssetKey(choice.assetKey);
    setAppliedSmartSpend(choice);
    setQuote(null);
    setQuoteError('');
  }

  function updateTargetAllocation(assetKey: SmartSpendAssetKey, value: string) {
    const percentage = Number(value);
    if (!Number.isFinite(percentage)) return;
    setTargetAllocation((current) => ({ ...current, [assetKey]: Math.max(0, Math.min(10_000, Math.round(percentage * 100))) }));
  }

  async function reconcileConfirmed(txHash: `0x${string}`) {
    if (!address) return false;
    setPaymentStep('reconciling');
    try {
      const result = await reconcileInvoicePayment(invoice.id, {
        txHash,
        buyerAddress: address,
        smartSpendUsed: Boolean(appliedSmartSpend),
        ...(appliedSmartSpend
          ? {
              smartSpendRecommendedAsset: appliedSmartSpend.assetKey,
              smartSpendReason: appliedSmartSpend.reason,
            }
          : {}),
      });
      onPaid(result.invoice);
      setPaymentStep('paid');
      setPaymentError('');
      return true;
    } catch (error) {
      setPaymentStep('error');
      setPaymentError(
        error instanceof ApiError
          ? `The transaction is confirmed, but invoice reconciliation is pending: ${error.message}`
          : 'The transaction is confirmed, but the backend could not reconcile the invoice yet.',
      );
      return false;
    }
  }

  async function payInvoice() {
    if (!address || !publicClient || !quote || !assetAddress || !stablecoinAddress || !settlementAddress) {
      setPaymentError('Connect the buyer wallet, configure the deployed contracts, and prepare a quote first.');
      return;
    }
    if (networkState !== 'ready') {
      setPaymentError('Switch the buyer wallet to X Layer Testnet before signing.');
      return;
    }
    if (confirmedPaymentHash) {
      setPaymentError('A settlement was already submitted. Check that transaction before trying another payment.');
      return;
    }
    const quoteError = validatePaymentQuote(quote, address, assetAddress, stablecoinAddress, settlementAddress);
    if (quoteError) {
      setPaymentError(quoteError);
      return;
    }
    if (selectedAssetBalance === undefined) {
      setPaymentError(`${portfolioAssets[selectedAssetKey].label} balance is still loading. Try again when the balance is available.`);
      return;
    }

    const requiredAssetAmount = BigInt(quote.quote.assetAmount);
    if (selectedAssetBalance < requiredAssetAmount) {
      setPaymentError(`Insufficient ${portfolioAssets[selectedAssetKey].label} balance. This payment needs ${displayAmount(quote.assetAmount)} ${portfolioAssets[selectedAssetKey].label}.`);
      return;
    }

    setPaymentError('');
    try {
      const verifyBuilderCode = () => assertRegisteredBuilderCode(
        portPayBuilderCode,
        () => readBuilderCodePayoutAddress(portPayBuilderCode),
      );
      await verifyBuilderCode();
      const allowance = await publicClient.readContract({
        address: assetAddress,
        abi: erc20BalanceAbi,
        functionName: 'allowance',
        args: [address, settlementAddress],
      });
      if (needsApproval(allowance, requiredAssetAmount)) {
        setPaymentStep('awaiting-approval');
        const approvalHash = await writeContractAsync(builderCodeTransactionData({
          account: address,
          address: assetAddress,
          abi: erc20BalanceAbi,
          functionName: 'approve',
          args: [settlementAddress, requiredAssetAmount],
          chainId: xLayerTestnet.id,
        }));
        setPaymentStep('confirming-approval');
        const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
        if (approvalReceipt.status !== 'success') throw new Error(`The ${portfolioAssets[selectedAssetKey].label} approval transaction failed.`);
      }
      if (validatePaymentQuote(quote, address, assetAddress, stablecoinAddress, settlementAddress)) {
        setPaymentStep('error');
        setPaymentError('The quote is no longer valid after approval. Refresh it before paying.');
        return;
      }
      await verifyBuilderCode();

      setPaymentStep('awaiting-payment-signature');
      const writeQuote: SettlementWriteQuote = {
        invoiceId: quote.quote.invoiceId,
        buyer: quote.quote.buyer,
        merchant: quote.quote.merchant,
        asset: quote.quote.asset,
        assetAmount: BigInt(quote.quote.assetAmount),
        stablecoin: quote.quote.stablecoin,
        stablecoinAmount: BigInt(quote.quote.stablecoinAmount),
        chainId: BigInt(quote.quote.chainId),
        settlementContract: quote.quote.settlementContract,
        expiry: BigInt(quote.quote.expiry),
      };
      const settlementHash = await writeContractAsync(builderCodeTransactionData({
        account: address,
        address: settlementAddress,
        abi: portPaySettlementAbi,
        functionName: 'settle',
        args: [writeQuote, quote.signature],
        chainId: xLayerTestnet.id,
      }));
      setConfirmedPaymentHash(settlementHash);
      setPaymentStep('confirming-payment');
      const settlementReceipt = await publicClient.waitForTransactionReceipt({ hash: settlementHash });
      if (settlementReceipt.status !== 'success') {
        setConfirmedPaymentHash('');
        throw new Error('The PortPay settlement transaction failed.');
      }
      await reconcileConfirmed(settlementHash);
    } catch (error) {
      setPaymentStep('error');
      setPaymentError(paymentErrorMessage(error));
    }
  }

  async function retrySubmittedPayment() {
    if (!publicClient || !confirmedPaymentHash) return;
    setPaymentStep('confirming-payment');
    setPaymentError('');
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: confirmedPaymentHash as `0x${string}` });
      if (receipt.status !== 'success') {
        setConfirmedPaymentHash('');
        throw new Error('The PortPay settlement transaction failed.');
      }
      await reconcileConfirmed(confirmedPaymentHash as `0x${string}`);
    } catch (error) {
      setPaymentStep('error');
      setPaymentError(paymentErrorMessage(error));
    }
  }

  const hasEnoughSelectedAsset = quote && selectedAssetBalance !== undefined && selectedAssetBalance >= BigInt(quote.quote.assetAmount);
  const formattedAaplBalance = formatTokenBalance(demoAaplBalance, demoAaplDecimals);
  const formattedNvdaBalance = formatTokenBalance(demoNvdaBalance, demoNvdaDecimals);

  return (
    <section className="mt-10 border-t border-ink/10 pt-8">
      <div className="relative overflow-hidden rounded-[1.75rem] bg-ink p-5 text-white shadow-soft sm:p-6">
        <div className="portpay-grid pointer-events-none absolute inset-0 opacity-25" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-mint/75">Buyer checkout</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">Choose how to pay</p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/55">Review the quote, select a demo portfolio asset, and confirm both wallet steps when you are ready.</p>
        </div>
        <span className="w-fit shrink-0 rounded-full bg-mint px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink">Chain 1952</span>
        </div>
        <div className="relative mt-6 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">
          <span className="text-mint">1 · Connect</span><span>2 · Review</span><span>3 · Confirm</span>
        </div>
      </div>

      {!isConnected ? (
        <div className="mt-5 rounded-2xl border border-ink/10 bg-paper p-6 shadow-panel">
          <p className="text-sm font-semibold">Connect to see your payment quote</p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-ink/55">PortPay will read your DemoAAPL and DemoNVDA balances, then show the exact asset amount required for this invoice.</p>
          <button
            type="button"
            className="mt-5 rounded-xl bg-ink px-5 py-3.5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-ink/85 hover:shadow-panel disabled:cursor-wait disabled:opacity-60"
            onClick={() => connect({ connector: okxWalletConnector })}
            disabled={isConnecting}
          >
            {isConnecting ? 'Opening OKX Wallet…' : 'Connect OKX Wallet'}
          </button>
          {connectError ? <p className="mt-3 text-sm text-rose-700">{connectError.message}</p> : null}
        </div>
      ) : networkState === 'wrong-network' ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-semibold text-amber-950">Switch networks before paying.</p>
          <p className="mt-1 text-xs leading-5 text-amber-900/70">Connected chain: {chainId ?? 'unknown'} · required chain: 1952.</p>
          <button
            type="button"
            className="mt-4 rounded-xl bg-amber-200 px-4 py-2.5 text-sm font-bold text-amber-950 transition hover:bg-white disabled:cursor-wait disabled:opacity-60"
            onClick={() => switchChain({ chainId: xLayerTestnet.id })}
            disabled={isSwitching}
          >
            {isSwitching ? 'Switching network…' : 'Switch to X Layer Testnet'}
          </button>
          {switchError ? <p className="mt-3 text-sm text-rose-700">{switchError.message}</p> : null}
        </div>
      ) : (
        <>
        <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-ink/10 bg-paper p-5 shadow-panel sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Wallet connected</p>
              <p className="mt-1 text-sm font-semibold text-ink">Buyer wallet ready</p>
              <p className="mt-1 font-mono text-xs text-ink/55">{shortenAddress(address!)}</p>
            </div>
            <div className="grid gap-1 text-sm text-ink/55 sm:text-right">
              <span><strong className="text-ink">DemoAAPL</strong> {formattedAaplBalance ?? (isBalanceLoading ? 'reading…' : '—')}</span>
              <span><strong className="text-ink">DemoNVDA</strong> {formattedNvdaBalance ?? (isBalanceLoading ? 'reading…' : '—')}</span>
            </div>
          </div>

          <section className="mt-5 rounded-2xl border border-[#ead9b8] bg-[#fff9eb] p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8a642b]">Smart Spend · optional</p>
                <h3 className="mt-2 text-xl font-semibold tracking-tight text-[#3d2c15]">A clearer way to choose your asset</h3>
                <p className="mt-2 text-sm leading-6 text-[#6d5837]">A deterministic demo allocation aid — never financial advice and never an automatic payment.</p>
              </div>
              <span className="w-fit rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#8a642b]">Demo rules</span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {(['demoAapl', 'demoNvda'] as const).map((assetKey) => {
                const allocation = smartSpendRecommendation.allocations.find((item) => item.key === assetKey);
                return (
                  <div key={assetKey} className="rounded-xl border border-[#ead9b8] bg-white/75 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-[#3d2c15]">{portfolioAssets[assetKey].label}</span>
                      <label className="text-xs text-[#6d5837]">
                        Target %
                        <input
                          className="ml-2 w-16 rounded-lg border border-[#ead9b8] bg-white px-2 py-1 text-right text-xs text-[#3d2c15] outline-none focus:border-[#8a642b]"
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          value={targetAllocation[assetKey] / 100}
                          onChange={(event) => updateTargetAllocation(assetKey, event.target.value)}
                          disabled={isBusy}
                        />
                      </label>
                    </div>
                    <p className="mt-3 text-xs text-[#6d5837]">
                      Current: {allocation ? formatAllocationPercent(allocation.currentAllocationBps) : '—'} · Target: {targetAllocation[assetKey] / 100}%
                    </p>
                  </div>
                );
              })}
            </div>
            {targetAllocation.demoAapl + targetAllocation.demoNvda !== 10_000 ? (
              <p className="mt-4 rounded-xl bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900">Target allocations must add up to 100%.</p>
            ) : null}
            <div className="mt-4 rounded-xl border border-[#ead9b8] bg-white/70 p-4">
              <p className="text-sm font-semibold text-[#3d2c15]">{smartSpendRecommendation.reason}</p>
              {smartSpendRecommendation.allocations.length > 0 ? (
                <p className="mt-2 text-xs leading-5 text-[#6d5837]">
                  Coverage check uses the quoted demo reference prices and token decimals; an asset is eligible only when its balance can cover the full invoice.
                </p>
              ) : null}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-xl px-3 py-2 text-xs font-bold transition ${smartSpendApplied ? 'bg-[#3d2c15] text-white' : 'bg-white text-[#6d4d1b] hover:bg-[#f8edcf]'}`}
                onClick={applySmartSpend}
                disabled={isBusy || !smartSpendRecommendation.assetKey}
              >
                {smartSpendRecommendation.assetKey ? `Use Smart Pay · ${portfolioAssets[smartSpendRecommendation.assetKey].label}` : 'Smart Pay unavailable'}
              </button>
              {(['demoAapl', 'demoNvda'] as const).map((assetKey) => (
                <button
                  key={assetKey}
                  type="button"
                  className={`rounded-xl px-3 py-2 text-xs font-bold transition ${!smartSpendApplied && selectedAssetKey === assetKey ? 'bg-ink text-white' : 'bg-white text-ink hover:bg-cloud'}`}
                  onClick={() => selectManualAsset(assetKey)}
                  disabled={isBusy}
                >
                  Pay manually with {portfolioAssets[assetKey].label}
                </button>
              ))}
            </div>
          </section>

          <div className="mt-5 rounded-2xl border border-mint/80 bg-mint/30 p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/55">Your exact payment quote</p>
              {quote ? <span className="rounded-full bg-white/75 px-3 py-1 text-xs font-semibold text-ink/55">Valid until {new Date(quote.expiresAt).toLocaleTimeString()}</span> : null}
            </div>
            {quoteLoading ? (
              <div className="mt-5 rounded-xl bg-white/70 p-4 text-sm font-semibold text-ink/55">Preparing a short-lived quote…</div>
            ) : quote ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-white/80 bg-white/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">You spend</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight">{displayAmount(quote.assetAmount)} <span className="text-sm text-ink/50">{portfolioAssets[quote.assetKey].label}</span></p>
                </div>
                <div className="rounded-xl border border-white/80 bg-white/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Merchant receives</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight">{displayAmount(quote.stablecoinAmount)} <span className="text-sm text-ink/50">USD₮0</span></p>
                </div>
                <p className="sm:col-span-2 text-xs leading-5 text-ink/55">Demo reference price: {quote.referencePriceUsd} USD per {portfolioAssets[quote.assetKey].label}. Token decimals read: {quote.assetDecimals}/{quote.stablecoinDecimals}. No oracle or live market price is used.</p>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-6 text-ink/55">A quote will appear after the backend and deployed testnet contracts are configured.</p>
            )}
          </div>

          {quoteError ? <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{quoteError}</p> : null}
          {paymentError ? <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">{paymentError}</p> : null}
          {isBalanceError ? <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">A configured demo asset balance could not be read. Manual selection remains available only for deployed assets.</p> : null}

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              className="order-1 rounded-xl bg-ink px-5 py-3.5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-ink/85 hover:shadow-panel disabled:cursor-not-allowed disabled:opacity-40 sm:order-none"
              onClick={payInvoice}
              disabled={isBusy || Boolean(confirmedPaymentHash) || !quote || !hasEnoughSelectedAsset || isBalanceLoading}
            >
              {paymentStep === 'awaiting-approval' ? `Approve ${portfolioAssets[selectedAssetKey].label} in wallet…` : paymentStep === 'confirming-approval' ? 'Confirming approval…' : paymentStep === 'awaiting-payment-signature' ? 'Confirm payment in wallet…' : paymentStep === 'confirming-payment' ? 'Confirming settlement…' : paymentStep === 'reconciling' ? 'Verifying payment…' : paymentStep === 'paid' ? paymentSuccessLabel('buyer') : `Approve and pay with ${portfolioAssets[selectedAssetKey].label}`}
            </button>
            <button
              type="button"
              className="order-2 rounded-xl border border-ink/15 px-4 py-3.5 text-sm font-semibold text-ink/70 transition hover:border-ink/40 hover:bg-white hover:text-ink disabled:cursor-wait disabled:opacity-50 sm:order-none"
              onClick={() => void refreshQuote()}
              disabled={isBusy || quoteLoading}
            >
              Refresh quote
            </button>
          </div>

          {confirmedPaymentHash && paymentStep === 'error' ? (
            <button
              type="button"
              className="mt-4 text-sm font-semibold text-ink underline underline-offset-4"
              onClick={() => void retrySubmittedPayment()}
            >
              Check submitted transaction and reconcile
            </button>
          ) : null}
          {paymentStep === 'paid' ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">✓ Confirmed on X Layer Testnet. The invoice is now paid from verified settlement evidence.</p> : null}
        </>
      )}
    </section>
  );
}

function formatMainnetPreparationCountdown(expiresAt: string, nowMs: number): string {
  const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs)) return 'Expiry unavailable';
  const remainingSeconds = Math.max(0, Math.ceil((expiryMs - nowMs) / 1000));
  if (remainingSeconds === 0) return 'Expired';
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = String(remainingSeconds % 60).padStart(2, '0');
  return `Expires in ${minutes}:${seconds}`;
}

function buyerFacingPreparationMessage(message: string): string {
  return /\bokx\b|response envelope/i.test(message)
    ? "We couldn't prepare this payment. Please try again."
    : message;
}

function MainnetApprovalPanel({ invoice, onPaid }: { invoice: Invoice; onPaid: (invoice: Invoice) => void }) {
  const { address, chainId, isConnected } = useAccount();
  const { connect, error: connectError, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, error: switchError, isPending: isSwitching } = useSwitchChain();
  const { sendTransactionAsync, isPending: isWalletPromptOpen } = useSendTransaction();
  const { signMessageAsync, isPending: isHandoffSignatureOpen } = useSignMessage();
  const publicClient = usePublicClient({ chainId: xLayerMainnet.id });
  const [submissionRecovery, setSubmissionRecovery] = useState(() => readMainnetSubmissionRecovery(invoice.id));
  const [preflight, setPreflight] = useState<MainnetApprovalPreparationResponse | null>(
    submissionRecovery ? { status: 'SUBMITTED', reason: 'Resuming the same server-validated transaction; no new payment will be prepared.' } : null,
  );
  const [preparationClockNow, setPreparationClockNow] = useState(() => Date.now());
  const [isPreparing, setIsPreparing] = useState(false);
  const [preparationError, setPreparationError] = useState('');
  const [selectedAssetKey, setSelectedAssetKey] = useState<MainnetAssetKey>('wNvda');
  const [preparationRequests] = useState(() => createMainnetPreparationRequestCoordinator<MainnetApprovalPreparationResponse>());
  const preparationContextKey = isConnected && address && chainId === xLayerMainnet.id && invoice.status === 'pending'
    ? `${invoice.id}:${invoice.amountUsdt0}:${invoice.merchantAddress.toLowerCase()}:${address.toLowerCase()}:${chainId}:${selectedAssetKey}`
    : null;
  const preparationContextKeyRef = useRef(preparationContextKey);
  preparationContextKeyRef.current = preparationContextKey;
  const [approvalTransactionHash, setApprovalTransactionHash] = useState<`0x${string}` | null>(null);
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const [payStage, setPayStage] = useState<'idle' | 'awaiting-approval' | 'confirming-approval' | 'rechecking' | 'wallet' | 'observing' | 'confirming' | 'error' | 'unresolved'>('idle');
  const [payError, setPayError] = useState('');
  const [transactionHash, setTransactionHash] = useState<`0x${string}` | null>(submissionRecovery?.transactionHash ?? null);
  const preparationReachedReady = useRef(Boolean(submissionRecovery));
  const recoveryAttempted = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setPreparationClockNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const isPaying = ['awaiting-approval', 'confirming-approval', 'rechecking', 'wallet', 'observing', 'confirming'].includes(payStage);
  const selectedAsset = selectedAssetKey === 'wNvda' ? mainnetAssets.wNvda : mainnetAssets.wAapl;

  const acceptPreparationResult = useCallback((result: MainnetApprovalPreparationResponse) => {
    setPreflight(result);
    if (result.status === 'READY' || result.existingPayment) preparationReachedReady.current = true;
    if (result.status === 'HANDOFF_UNRESOLVED') setPayStage('unresolved');
    const existing = result.existingPayment;
    if (existing?.transactionHash && address?.toLowerCase() === existing.buyer.toLowerCase()) {
      const attempt: MainnetSubmissionRecovery = {
        invoiceId: invoice.id, preparationId: existing.preparationId,
        handoffId: existing.handoffId, transactionHash: existing.transactionHash, buyerAddress: existing.buyer,
      };
      saveMainnetSubmissionRecovery(attempt);
      setSubmissionRecovery(attempt);
      setTransactionHash(attempt.transactionHash);
    }
  }, [address, invoice.id]);

  const requestMainnetPreparation = useCallback((): Promise<MainnetApprovalPreparationResponse | null> => {
    if (!isConnected || !address || chainId !== xLayerMainnet.id || invoice.status !== 'pending') return Promise.resolve(null);
    const key = `${invoice.id}:${invoice.amountUsdt0}:${invoice.merchantAddress.toLowerCase()}:${address.toLowerCase()}:${chainId}:${selectedAssetKey}`;
    const { ticket, isNew } = preparationRequests.run(
      key,
      () => prepareMainnetApproval(invoice.id, address, selectedAssetKey),
    );
    if (!isNew) return ticket.promise.catch(() => null);

    setIsPreparing(true);
    setPreparationError('');
    return ticket.promise
      .then((result) => {
        if (!preparationRequests.isLatest(ticket) || preparationContextKeyRef.current !== key) return null;
        acceptPreparationResult(result);
        return result;
      })
      .catch((error: unknown) => {
        if (preparationRequests.isLatest(ticket) && preparationContextKeyRef.current === key) {
          setPreflight(null);
          setPreparationError(error instanceof ApiError ? error.message : 'Unable to prepare the Mainnet payment.');
        }
        return null;
      })
      .finally(() => {
        if (preparationRequests.isLatest(ticket) && preparationContextKeyRef.current === key) setIsPreparing(false);
      });
  }, [acceptPreparationResult, address, chainId, invoice.amountUsdt0, invoice.id, invoice.merchantAddress, invoice.status, isConnected, preparationRequests, selectedAssetKey]);

  const observeSameMainnetTransaction = useCallback(async (attempt: MainnetSubmissionRecovery, recoverFromServer: boolean) => {
    setPayError('');
    setPayStage('observing');
    try {
      let exactAttempt = attempt;
      let submission: MainnetSubmissionResponse | null = null;
      if (recoverFromServer) {
        const { submission: persisted } = await recoverMainnetSubmission(invoice.id, attempt.preparationId, attempt.buyerAddress);
        if (persisted) {
          if (persisted.preparationId !== attempt.preparationId || persisted.handoffId !== attempt.handoffId
            || persisted.transactionHash.toLowerCase() !== attempt.transactionHash.toLowerCase()) {
            throw new Error('The server-recorded submission does not match this page’s original transaction, preparation, and handoff.');
          }
          exactAttempt = { ...attempt, transactionHash: persisted.transactionHash };
          saveMainnetSubmissionRecovery(exactAttempt);
          setSubmissionRecovery(exactAttempt);
          submission = persisted;
        }
      }

      if (!submission) submission = await recordMainnetSubmission(
        invoice.id, exactAttempt.preparationId, exactAttempt.handoffId, exactAttempt.transactionHash,
      );
      if (submission.status !== 'submitted' || submission.preparationId !== exactAttempt.preparationId
        || submission.handoffId !== exactAttempt.handoffId
        || submission.transactionHash.toLowerCase() !== exactAttempt.transactionHash.toLowerCase()) {
        throw new Error('PortPay could not bind the same transaction to its persisted preparation and handoff.');
      }

      setPayStage('confirming');
      for (let attemptNumber = 0; attemptNumber < 20; attemptNumber += 1) {
        const reconciliation = await reconcileMainnetPayment(invoice.id, exactAttempt.preparationId, exactAttempt.transactionHash);
        if (reconciliation.invoice) {
          if (reconciliation.invoice.status !== 'paid' || reconciliation.invoice.paymentNetwork !== 'x-layer-mainnet'
            || reconciliation.invoice.paymentTxHash?.toLowerCase() !== exactAttempt.transactionHash.toLowerCase()) {
            throw new Error('PortPay returned payment data that does not match the verified Mainnet transaction.');
          }
          clearMainnetSubmissionRecovery(invoice.id);
          setSubmissionRecovery(null);
          onPaid(reconciliation.invoice);
          setPayStage('idle');
          return;
        }
        if (reconciliation.code !== 'CONFIRMING') {
          throw new Error(reconciliation.error || 'PortPay could not verify the Mainnet settlement.');
        }
        if (attemptNumber < 19) await new Promise<void>((resolve) => window.setTimeout(resolve, 2500));
      }
      throw new Error('The same transaction is still awaiting canonical confirmation. Retry its status check; do not submit another payment.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PortPay could not observe the submitted transaction yet.';
      setPayError(`${message} The original transaction is retained for retry; no new preparation or wallet prompt will be created.`);
      setPayStage('error');
    }
  }, [invoice.id, onPaid]);

  useEffect(() => {
    if (!submissionRecovery || submissionRecovery.invoiceId !== invoice.id) return;
    preparationReachedReady.current = true;
    if (!isConnected || !address || chainId !== xLayerMainnet.id) return;
    if (address.toLowerCase() !== submissionRecovery.buyerAddress.toLowerCase()) {
      setPayStage('error');
      setPayError('Reconnect the buyer wallet that submitted this transaction to resume its verification.');
      return;
    }
    const attemptKey = `${submissionRecovery.preparationId}:${submissionRecovery.handoffId}:${submissionRecovery.transactionHash.toLowerCase()}`;
    if (recoveryAttempted.current === attemptKey) return;
    recoveryAttempted.current = attemptKey;
    void observeSameMainnetTransaction(submissionRecovery, true);
  }, [address, chainId, invoice.id, isConnected, observeSameMainnetTransaction, submissionRecovery]);

  async function refreshPreparation(): Promise<MainnetApprovalPreparationResponse | null> {
    if ((preparationReachedReady.current && !readyMainnetPreparationNeedsRefresh(preflight))
      || !address || chainId !== xLayerMainnet.id || invoice.status !== 'pending') return null;
    preparationReachedReady.current = false;
    setPreflight(null);
    setApprovalTransactionHash(null);
    setApprovalConfirmed(false);
    setPayError('');
    return requestMainnetPreparation();
  }

  useEffect(() => {
    if (preparationReachedReady.current) return;
    if (!isConnected || !address || chainId !== xLayerMainnet.id || invoice.status !== 'pending') {
      preparationRequests.invalidate();
      setIsPreparing(false);
      setPreflight(null);
      setPreparationError('');
      return;
    }
    void requestMainnetPreparation();
  }, [address, chainId, invoice.status, isConnected, preparationRequests, requestMainnetPreparation]);

  async function approvePreparedMainnet() {
    const preparation = preflight?.preparation;
    const validationError = preparation && address
      ? validatePreparedMainnetApproval(preparation, invoice, address, chainId)
      : 'A fresh preparation for the connected buyer is required.';
    const selectedAssetError = preparation && preparation.token.toLowerCase() !== selectedAsset.address.toLowerCase()
      ? 'The persisted preparation does not match the xStock selected for this checkout.'
      : null;
    if (!preparation || preflight.status !== 'APPROVAL_REQUIRED' || !address || !publicClient
      || chainId !== 196 || invoice.status !== 'pending' || validationError || selectedAssetError) {
      setPayError(validationError || selectedAssetError || 'A fresh exact Mainnet approval preparation is required.');
      setPayStage('error');
      return;
    }
    setPayError('');
    setPayStage('awaiting-approval');
    try {
      if (await publicClient.getChainId() !== 196) throw new Error('The X Layer Mainnet RPC must report chain 196 before approval.');
      const currentAllowance = await publicClient.readContract({
        address: preparation.token,
        abi: erc20BalanceAbi,
        functionName: 'allowance',
        args: [address, preparation.spender],
      });
      if (typeof currentAllowance !== 'bigint' || currentAllowance < 0n) throw new Error('Could not verify the current onchain allowance.');
      if (!hasExactMainnetAllowance(currentAllowance, preparation.amount)) {
        const approvalHash = await sendTransactionAsync({
          account: address,
          to: preparation.token,
          data: preparation.attributedApprovalCalldata,
          value: 0n,
          chainId: 196,
        });
        setApprovalTransactionHash(approvalHash);
        setPayStage('confirming-approval');
        const receipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
        if (receipt.status !== 'success') throw new Error('The exact Mainnet token approval did not succeed.');
      }

      const confirmedAllowance = await publicClient.readContract({
        address: preparation.token,
        abi: erc20BalanceAbi,
        functionName: 'allowance',
        args: [address, preparation.spender],
      });
      if (!hasExactMainnetAllowance(confirmedAllowance, preparation.amount)) {
        throw new Error('Onchain allowance does not exactly equal the prepared invoice input; Pay remains unavailable.');
      }
      setApprovalConfirmed(true);
      setPayStage('rechecking');
      const result = await prepareMainnetApproval(invoice.id, address, selectedAssetKey, preparation.preparationId);
      if (result.status !== 'READY' || !result.preparation
        || !isSamePersistedMainnetPreparation(preparation, result.preparation)) {
        acceptPreparationResult(result);
        throw new Error(result.reason || 'The same persisted preparation did not pass its post-approval readiness recheck.');
      }
      acceptPreparationResult(result);
      setPayStage('idle');
      setPayError('Exact approval confirmed. The same preparation is ready for a separate Pay action.');
    } catch (error) {
      setPayStage('error');
      setPayError(error instanceof Error ? error.message : 'The exact token approval could not be completed.');
    }
  }

  async function payPreparedMainnet() {
    const returnToPreparationStage = (reason: string) => {
      preparationReachedReady.current = false;
      setPreflight(null);
      setPreparationError(reason);
      setPayStage('idle');
      setPayError('');
    };

    if (readyMainnetPreparationNeedsRefresh(preflight)) {
      returnToPreparationStage('This READY preparation has less than 30 seconds remaining or has expired. Refresh it and review its exact amount and allowance before clicking Pay again. No wallet prompt or handoff was started.');
      return;
    }
    if (!preflight || !preflight.preparation) {
      setPayError('A fresh READY preparation and connected buyer wallet are required.');
      setPayStage('error');
      return;
    }
    const preparation: MainnetApprovalPreparation = preflight.preparation;
    const preparationResponse: MainnetApprovalPreparationResponse = preflight;
    if (!address || !publicClient || !preparation || preflight?.status !== 'READY'
      || preflight.existingPayment || invoice.status !== 'pending' || transactionHash) {
      setPayError('A fresh READY preparation and connected buyer wallet are required.');
      setPayStage('error');
      return;
    }

    let handoffPersisted = false;
    let submittedHash: `0x${string}` | null = null;
    setPayError('');
    setPayStage('rechecking');

    const resumeSubmitted = async (result: Awaited<ReturnType<typeof recheckMainnetReadiness>>) => {
      if (!result.transactionHash || !/^0x[0-9a-fA-F]{64}$/.test(result.transactionHash)
        || result.preparationId !== preparation.preparationId || !result.handoffId) {
        throw new Error('A submitted transaction exists, but its server recovery binding is incomplete. No new transaction will be prompted.');
      }
      const attempt: MainnetSubmissionRecovery = {
        invoiceId: invoice.id, preparationId: preparation.preparationId,
        handoffId: result.handoffId, transactionHash: result.transactionHash, buyerAddress: address,
      };
      saveMainnetSubmissionRecovery(attempt);
      setSubmissionRecovery(attempt);
      setTransactionHash(attempt.transactionHash);
      recoveryAttempted.current = `${attempt.preparationId}:${attempt.handoffId}:${attempt.transactionHash.toLowerCase()}`;
      await observeSameMainnetTransaction(attempt, true);
    };

    try {
      const rpcChainId = await publicClient.getChainId();
      if (rpcChainId !== 196 || chainId !== 196) throw new Error('The connected wallet and X Layer RPC must both report chain 196.');

      if (readyMainnetPreparationNeedsRefresh(preparationResponse)) {
        returnToPreparationStage('This READY preparation no longer has 30 seconds remaining. Refresh it and review its exact amount and allowance before clicking Pay again. No handoff was created.');
        return;
      }
      if (!canOfferMainnetPay(preparationResponse, invoice, address, chainId)) {
        throw new Error('The persisted preparation no longer matches this buyer, invoice, chain, or expiry. Refresh it before continuing.');
      }
      if (!preparation.handoffMessage) throw new Error('The server did not supply a buyer handoff authorization message.');

      // Finish the expensive, read-only validation before any wallet message prompt.
      const prePrompt = await preflightMainnetReadiness(invoice.id, preparation.preparationId, address);
      if (prePrompt.status === 'SUBMITTED') {
        await resumeSubmitted(prePrompt);
        return;
      }
      if (prePrompt.status === 'HANDOFF_UNRESOLVED') {
        preparationReachedReady.current = true;
        setPayStage('unresolved');
        setPayError(prePrompt.reason);
        return;
      }
      if (prePrompt.status === 'EXPIRED') {
        returnToPreparationStage('The READY preparation expired before handoff. Refresh it and review the new exact amount and allowance; no invoice attempt was consumed.');
        return;
      }
      const prePromptError = validateMainnetPrePromptReadiness(prePrompt, preparation, invoice, address, chainId);
      if (prePromptError) {
        if (mainnetPreparationNeedsRefresh(preparation.expiresAt, Date.now(), MAINNET_PRE_PROMPT_MIN_REMAINING_MS)) {
          returnToPreparationStage('The READY preparation no longer has 30 seconds for a safe wallet handoff. Refresh it and review the new exact amount and allowance.');
          return;
        }
        throw new Error(prePromptError);
      }

      const buyerSignature = await signMessageAsync({ account: address, message: preparation.handoffMessage });
      const recheck = await recheckMainnetReadiness(invoice.id, preparation.preparationId, address, buyerSignature);
      if (recheck.status === 'EXPIRED') {
        returnToPreparationStage('The preparation expired before a handoff was persisted. Refresh it and review the new exact amount and allowance; the invoice remains retryable.');
        return;
      }
      if (recheck.status === 'SUBMITTED') {
        await resumeSubmitted(recheck);
        return;
      }
      if (recheck.status === 'HANDOFF_UNRESOLVED') {
        preparationReachedReady.current = true;
        setPayStage('unresolved');
        setPayError(recheck.reason);
        return;
      }
      handoffPersisted = recheck.status === 'READY' && Boolean(recheck.handoffId);
      const handoffError = validateReadyMainnetHandoff(recheck, preparation, invoice, address, chainId);
      if (handoffError) throw new Error(handoffError);
      const walletTransaction = recheck.walletTransaction;
      if (!walletTransaction) throw new Error('The server did not return the persisted wallet transaction.');

      preparationReachedReady.current = true;
      setPayStage('wallet');
      const hash = await sendTransactionAsync({
        account: address,
        to: walletTransaction.to,
        data: walletTransaction.data,
        value: BigInt(walletTransaction.value),
        chainId: walletTransaction.chainId,
      });
      submittedHash = hash;
      const attempt: MainnetSubmissionRecovery = {
        invoiceId: invoice.id,
        preparationId: preparation.preparationId,
        handoffId: recheck.handoffId!,
        transactionHash: hash,
        buyerAddress: address,
      };
      preparationReachedReady.current = true;
      recoveryAttempted.current = `${attempt.preparationId}:${attempt.handoffId}:${attempt.transactionHash.toLowerCase()}`;
      saveMainnetSubmissionRecovery(attempt);
      setSubmissionRecovery(attempt);
      setTransactionHash(hash);
      await observeSameMainnetTransaction(attempt, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The Mainnet payment handoff failed.';
      const rejection = typeof error === 'object' && error !== null
        && ('code' in error && error.code === 4001 || 'name' in error && error.name === 'UserRejectedRequestError');
      if (handoffPersisted && !submittedHash) {
        preparationReachedReady.current = true;
        setPayStage('unresolved');
        setPayError(`Payment status unresolved. ${message} This invoice already has a persisted handoff; check the buyer wallet before asking the merchant for a new invoice.`);
      } else {
        setPayStage('idle');
        setPayError(rejection
          ? 'Wallet authorization was cancelled before a handoff was persisted. No invoice attempt was consumed; click Pay to retry.'
          : message);
      }
    }
  }

  const explorerUrl = transactionHash ? `${mainnetNetworkConfig.explorerUrl}/tx/${transactionHash}` : '';
  const preparedValidationError = preflight?.preparation && address
    ? validatePreparedMainnetApproval(preflight.preparation, invoice, address, chainId)
      ?? (preflight.preparation.token.toLowerCase() !== selectedAsset.address.toLowerCase()
        ? 'The persisted preparation does not match the xStock selected for this checkout.' : null)
    : 'A fresh preparation for the connected buyer is required.';
  const readyPreparationNeedsRefresh = readyMainnetPreparationNeedsRefresh(preflight);
  const preparationNeedsRefresh = preflight?.preparation
    ? mainnetPreparationNeedsRefresh(preflight.preparation.expiresAt, preparationClockNow, MAINNET_PRE_PROMPT_MIN_REMAINING_MS)
    : false;
  const preparationCountdown = preflight?.preparation
    ? formatMainnetPreparationCountdown(preflight.preparation.expiresAt, preparationClockNow)
    : null;
  const showPayButton = preflight?.status === 'READY' && Boolean(preflight.preparation) && !preflight.existingPayment
    && invoice.status === 'pending' && Boolean(address) && chainId === xLayerMainnet.id
    && !transactionHash && payStage === 'idle' && !readyPreparationNeedsRefresh;

  return (
    <section className="mainnet-payment-panel mt-5 rounded-2xl border border-ink/10 bg-cloud p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-800">Mainnet payment · manual wallet confirmation</p>
          <p className="mt-1 text-sm leading-6 text-ink/65">PortPay prepares the invoice-sized payment. Any exact approval and the separate Pay transaction require your wallet confirmation.</p>
        </div>
        <span className="payment-network-pill rounded-full bg-amber-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-950">X Layer · 196</span>
      </div>

      <label className="mt-4 block max-w-xs text-xs font-medium text-ink/65">
        Choose the xStock to spend
        <select
          className="mt-1.5 block w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink"
          value={selectedAssetKey}
          disabled={isPreparing || isPaying || Boolean(preflight?.existingPayment) || Boolean(transactionHash)}
          onChange={(event) => {
            const next = event.target.value as MainnetAssetKey;
            if (next === selectedAssetKey) return;
            preparationRequests.invalidate();
            setIsPreparing(false);
            preparationReachedReady.current = false;
            setPreflight(null);
            setPreparationError('');
            setPayError('');
            setApprovalTransactionHash(null);
            setApprovalConfirmed(false);
            setSelectedAssetKey(next);
          }}
        >
          <option value="wNvda">wNVDAx</option>
          <option value="wAapl">wAAPLx</option>
        </select>
      </label>

      {isConnected && address ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink/10 bg-white px-3.5 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/45">Connected wallet</p>
            <p className="mt-0.5 font-mono text-xs text-ink/75">{shortenAddress(address)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${chainId === xLayerMainnet.id ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
              {chainId === xLayerMainnet.id ? 'X Layer Mainnet · 196' : `Wrong network · ${chainId ?? 'unknown'}`}
            </span>
            <button type="button" className="rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink/70 transition hover:border-ink/30 hover:text-ink" onClick={() => disconnect()}>
              Disconnect
            </button>
          </div>
        </div>
      ) : null}

      {!isConnected ? (
        <button type="button" className="portpay-button portpay-button--primary mt-5 rounded-xl bg-ink px-4 py-3 text-sm font-bold text-white disabled:opacity-50" onClick={() => connect({ connector: okxWalletConnector })} disabled={isConnecting}>
          {isConnecting ? 'Opening OKX Wallet…' : 'Connect wallet'}
        </button>
      ) : chainId !== xLayerMainnet.id ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-white p-4">
          <p className="text-sm font-semibold">Switch to X Layer Mainnet (196) to continue.</p>
          <button type="button" className="mt-3 rounded-lg bg-amber-200 px-4 py-2.5 text-sm font-bold text-amber-950 disabled:opacity-50" onClick={() => switchChain({ chainId: xLayerMainnet.id })} disabled={isSwitching}>
            {isSwitching ? 'Switching network…' : 'Switch to X Layer'}
          </button>
          {switchError ? <p className="mt-2 text-xs text-rose-700">{switchError.message}</p> : null}
        </div>
      ) : (
        <div className="mt-4">
          {isPreparing ? <p className="mainnet-processing-status rounded-xl bg-white p-4 text-sm text-ink/60">Preparing and validating the Mainnet payment…</p> : null}
          {preparationError ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{buyerFacingPreparationMessage(preparationError)}</p> : null}
          {preflight && !isPreparing ? (
            <div className="mainnet-preflight-card rounded-xl border border-ink/10 bg-white p-4">
              <p className="text-sm font-semibold">{preflight.status === 'READY' ? 'Ready for final payment recheck' : preflight.status === 'HANDOFF_UNRESOLVED' ? 'Payment status unresolved' : preflight.status === 'SUBMITTED' ? 'Transaction submitted' : preflight.status === 'APPROVAL_REQUIRED' ? 'Exact approval required' : 'Payment setup failed'}</p>
              <p className="mt-1 text-sm leading-6 text-ink/60">{buyerFacingPreparationMessage(preflight.reason)}</p>
              {preflight.preparation && preparedValidationError ? <p className="mt-3 text-sm text-rose-700">{preparedValidationError}</p> : null}
              {preflight.preparation && !preparedValidationError ? (
                <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
                  <div><dt className="text-ink/45">Asset / exact amount</dt><dd className="mt-0.5 font-semibold">{selectedAsset.label} · {formatUnits(BigInt(preflight.preparation.amount), 18)}</dd></div>
                  <div><dt className="text-ink/45">Minimum merchant receive</dt><dd className="mt-0.5 font-semibold">{formatUnits(BigInt(preflight.preparation.minimumReceive), 6)} USD₮0</dd></div>
                  <div><dt className="text-ink/45">Spender from prepared quote</dt><dd className="mt-0.5 break-all font-mono">{preflight.preparation.spender}</dd></div>
                  <div>
                    <dt className="text-ink/45">Preparation expires</dt>
                    <dd className="mt-0.5">{new Date(preflight.preparation.expiresAt).toLocaleTimeString()}</dd>
                    <dd aria-live="off" className={`mt-1 font-medium ${preparationNeedsRefresh ? 'text-amber-700' : 'text-ink/70'}`}>
                      {preparationCountdown}
                      {preparationNeedsRefresh && preflight.status === 'APPROVAL_REQUIRED' ? ' · refresh before approval' : preparationNeedsRefresh && preflight.status === 'READY' ? ' · refresh before Pay' : ''}
                    </dd>
                  </div>
                  <div><dt className="text-ink/45">Preparation ID</dt><dd className="mt-0.5 break-all font-mono">{preflight.preparation.preparationId}</dd></div>
                </dl>
              ) : null}
              {preflight.status === 'APPROVAL_REQUIRED' && preflight.preparation && !preparedValidationError && !preparationNeedsRefresh ? (
                <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                  <p>The buyer wallet will be asked to approve exactly {formatUnits(BigInt(preflight.preparation.amount), 18)} {selectedAsset.label} for this invoice. No unlimited allowance is requested.</p>
                  <button type="button" className="portpay-button portpay-button--primary mt-3 rounded-lg bg-ink px-3.5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void approvePreparedMainnet()} disabled={isPaying || isWalletPromptOpen || isHandoffSignatureOpen || isPreparing}>
                    {payStage === 'awaiting-approval' ? 'Confirm exact approval in wallet…' : payStage === 'confirming-approval' ? 'Confirming approval…' : `Approve ${formatUnits(BigInt(preflight.preparation.amount), 18)} ${selectedAsset.label}`}
                  </button>
                </div>
              ) : null}
              {preflight.status === 'APPROVAL_REQUIRED' && preparationNeedsRefresh ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">This preparation is too close to expiry to approve safely. Refresh it before continuing.</p> : null}
              {approvalConfirmed ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Exact allowance confirmed. Pay is available only after the backend rechecks this same preparation.</p> : null}
              {approvalTransactionHash ? <p className="mt-2 text-xs text-ink/60">Approval transaction: <a className="font-mono underline" href={`${mainnetNetworkConfig.explorerUrl}/tx/${approvalTransactionHash}`} target="_blank" rel="noreferrer">{approvalTransactionHash}</a></p> : null}
              {showPayButton && preflight.preparation ? (
                <button type="button" className="portpay-button portpay-button--primary mt-4 rounded-xl bg-ink px-4 py-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-50" onClick={() => void payPreparedMainnet()} disabled={isPaying || isWalletPromptOpen || isHandoffSignatureOpen}>
                  {`Pay ${formatUnits(BigInt(preflight.preparation.amount), 18)} ${selectedAsset.label}`}
                </button>
              ) : null}
              {payStage === 'rechecking' ? <p className="payment-progress-note mt-3 text-sm text-ink/60">Rechecking invoice, buyer, chain, exact allowance, balances, Builder Code, expiry, and the same persisted calldata before opening the wallet.</p> : null}
              {payStage === 'wallet' ? <p className="payment-progress-note payment-progress-note--wallet mt-3 text-sm font-semibold text-ink/70">Review and confirm the exact payment in OKX Wallet. PortPay will not sign or submit it for you.</p> : null}
              {payStage === 'observing' || payStage === 'confirming' ? <p className="payment-progress-note payment-progress-note--active mt-3 text-sm font-semibold text-ink/70">Transaction submitted; waiting for exact transaction observation and canonical settlement confirmation.</p> : null}
              {payStage === 'unresolved' ? <p className="mt-3 text-sm font-semibold text-amber-900">Payment status unresolved. This invoice cannot be retried. Check the buyer wallet before the merchant creates a new invoice.</p> : null}
              {transactionHash ? <p className="mt-3 text-xs text-ink/65">Settlement transaction: <a className="font-mono font-semibold underline" href={explorerUrl} target="_blank" rel="noreferrer">{transactionHash}</a></p> : null}
              {payError ? <p className={`mt-3 rounded-xl border p-3 text-sm leading-6 ${payError.startsWith('Wallet authorization was cancelled') ? 'wallet-cancelled-note' : 'mainnet-pay-error'}`}>{payError}</p> : null}
              {transactionHash && submissionRecovery && payStage === 'error' ? (
                <button type="button" className="mt-3 rounded-lg border border-ink/15 px-3 py-2 text-sm font-semibold text-ink disabled:opacity-50" onClick={() => void observeSameMainnetTransaction(submissionRecovery, true)} disabled={isPaying || isWalletPromptOpen}>
                  Retry the same transaction check
                </button>
              ) : null}
            </div>
          ) : null}
          {(preflight?.status !== 'READY' || readyPreparationNeedsRefresh) && !preflight?.existingPayment && !transactionHash && payStage !== 'unresolved' ? <button type="button" className="mt-3 text-sm font-semibold text-ink/60 underline underline-offset-4 disabled:opacity-50" onClick={() => void refreshPreparation()} disabled={isPreparing || isPaying || isWalletPromptOpen}>
            Try again
          </button> : null}
        </div>
      )}
      {connectError ? <p className="mt-3 text-sm text-rose-700">{connectError.message}</p> : null}
      <p className="mt-4 text-xs leading-5 text-ink/45">X Layer Mainnet · wNVDAx / wAAPLx · chain 196. Approval, when needed, is exact and manual. Pay itself is approval-free and the invoice is paid only after canonical reconciliation.</p>
    </section>
  );
}

function BuyerCheckoutPage({ invoiceId, paymentNetwork, onBack, onOpenBuyerInvoice }: { invoiceId: string; paymentNetwork: 'testnet' | 'mainnet'; onBack: () => void; onOpenBuyerInvoice: (invoiceId: string) => void }) {
  const { address, chainId, isConnected } = useAccount();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(invoiceId));
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!invoiceId) {
      setIsLoading(false);
      setError('This payment link is missing its invoice ID.');
      return () => {
        active = false;
      };
    }

    setIsLoading(true);
    setError('');
    setInvoice(null);
    getInvoice(invoiceId)
      .then((result) => {
        if (active) setInvoice(result.invoice);
      })
      .catch((requestError: unknown) => {
        if (active) {
          setError(
            requestError instanceof ApiError && requestError.status === 404
              ? 'This invoice does not exist or is no longer available.'
              : requestError instanceof ApiError
                ? requestError.message
                : 'Unable to load this invoice.',
          );
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [invoiceId]);

  return (
    <section className="portpay-appear buyer-checkout flex flex-1 items-center justify-center py-8 sm:py-12">
      <div className="buyer-checkout-card w-full max-w-4xl rounded-[1.75rem] border border-ink/10 bg-paper p-5 shadow-soft sm:p-8">
        <button type="button" className="text-sm font-semibold text-ink/50 transition hover:text-ink" onClick={onBack}>
          ← Back to PortPay
        </button>

        {isLoading ? (
          <div className="py-16 text-center">
            <p className="text-sm font-semibold text-ink/50">Loading invoice…</p>
          </div>
        ) : error ? (
          <div className="py-16 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-600">Invoice link issue</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">We could not open this invoice.</h1>
            <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-ink/55">{error}</p>
          </div>
        ) : invoice ? (
          <div className="pt-8">
            {(() => {
              const persistedNetwork = getInvoicePaymentNetwork(invoice);
              const effectiveNetwork = invoice.paymentNetwork ? persistedNetwork : paymentNetwork === 'testnet' ? 'x-layer-testnet' : persistedNetwork;
              const isMainnet = effectiveNetwork === 'x-layer-mainnet';
              return (
                <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/45">{isMainnet ? 'PortPay checkout · Mainnet preparation' : 'Historical internal receipt'}</p>
              {isMainnet
                ? <span className="checkout-network-pill rounded-full bg-amber-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-950">X Layer Mainnet · 196</span>
                : <span className="checkout-network-pill rounded-full bg-cloud px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-ink/60">Legacy X Layer Testnet · 1952</span>}
            </div>
            <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <p className="text-sm font-semibold text-ink/45">You are paying</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{invoice.title}</h1>
              </div>
              <div className="amount-due-card rounded-2xl bg-ink px-5 py-4 text-white lg:min-w-56 lg:text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">Amount due</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight">{invoice.amountUsdt0} <span className="text-base text-mint">USD₮0</span></p>
              </div>
            </div>

            <div className={`checkout-status mt-8 rounded-2xl p-5 ${invoice.status === 'paid' ? 'checkout-status--paid border border-emerald-200 bg-emerald-50' : 'checkout-status--pending border border-ink/10 bg-cloud'}`}>
              <div className="flex items-center gap-3">
                <span className={`checkout-status__icon grid h-8 w-8 place-items-center rounded-full text-sm font-bold ${invoice.status === 'paid' ? 'bg-emerald-600 text-white' : 'bg-amber-200 text-amber-950'}`}>
                  {invoice.status === 'paid' ? '✓' : '…'}
                </span>
                <p className="text-sm font-semibold">{invoice.status === 'paid' ? paymentSuccessLabel('buyer') : isMainnet ? 'Mainnet payment preparation' : 'Legacy testnet invoice'}</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-ink/55">
                {invoice.status === 'paid'
                  ? 'This receipt is rendered from the persisted payment evidence for the network shown below.'
                  : isMainnet
                  ? 'Buyer-signed Mainnet Pay is available with explicit OKX Wallet confirmation. PortPay never signs or broadcasts; the invoice becomes paid only after canonical settlement evidence is verified.'
                    : 'This historical testnet invoice is available only through internal development tooling.'}
              </p>
            </div>

            {invoice.status === 'pending' && isMainnet ? <MainnetApprovalPanel invoice={invoice} onPaid={setInvoice} /> : null}
            {invoice.status === 'pending' && !isMainnet && import.meta.env.DEV && import.meta.env.VITE_ENABLE_INTERNAL_TESTNET === 'true'
              ? <BuyerWalletPanel invoice={invoice} onPaid={setInvoice} /> : null}

            {invoice.status === 'paid' ? (
              <PaymentReceipt invoice={invoice} role="buyer" />
            ) : null}

            {invoice.status === 'paid' ? (
              <PaymentHistoryPanel
                address={address}
                canRead={isConnected && chainId === (isMainnet ? xLayerMainnet.id : xLayerTestnet.id) && Boolean(address)}
                view="buyer"
                onOpenInvoice={onOpenBuyerInvoice}
              />
            ) : null}

            <dl className="mt-8 grid gap-4 border-t border-ink/10 pt-6 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-4">
                <dt className="text-ink/45">Merchant wallet</dt>
                <dd className="font-mono">{shortenAddress(invoice.merchantAddress)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink/45">Network</dt>
                <dd>{paymentNetworkLabel(effectiveNetwork)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink/45">Invoice ID</dt>
                <dd className="max-w-[16rem] break-all text-right font-mono text-xs">{invoice.id}</dd>
              </div>
            </dl>
            <p className="mt-6 text-center text-xs leading-5 text-ink/40">{isMainnet ? 'Mainnet payment · buyer-confirmed and server-verified.' : 'Legacy internal testnet record.'}</p>
                </>
              );
            })()}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function MerchantInvoicePage({ invoiceId, onBack }: { invoiceId: string; onBack: () => void }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(invoiceId));
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!invoiceId) {
      setIsLoading(false);
      setError('This merchant invoice link is missing its invoice ID.');
      return () => {
        active = false;
      };
    }

    setIsLoading(true);
    setError('');
    setInvoice(null);
    getInvoice(invoiceId)
      .then((result) => {
        if (active) setInvoice(result.invoice);
      })
      .catch((requestError: unknown) => {
        if (active) {
          setError(
            requestError instanceof ApiError && requestError.status === 404
              ? 'This invoice does not exist or is no longer available.'
              : requestError instanceof ApiError
                ? requestError.message
                : 'Unable to load this invoice.',
          );
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [invoiceId]);

  const invoiceNetwork = invoice ? getInvoicePaymentNetwork(invoice) : 'x-layer-mainnet';

  return (
    <section className="portpay-appear merchant-invoice flex flex-1 items-center justify-center py-8 sm:py-12">
      <div className="merchant-invoice-card w-full max-w-4xl rounded-[1.75rem] border border-ink/10 bg-paper p-5 shadow-soft sm:p-8">
        <button type="button" className="text-sm font-semibold text-ink/50 transition hover:text-ink" onClick={onBack}>
          ← Back to merchant workspace
        </button>

        {isLoading ? (
          <div className="py-16 text-center"><p className="text-sm font-semibold text-ink/50">Loading merchant invoice…</p></div>
        ) : error ? (
          <div className="py-16 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-600">Invoice issue</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">We could not open this invoice.</h1>
            <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-ink/55">{error}</p>
          </div>
        ) : invoice ? (
          <div className="pt-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/45">Merchant invoice</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{invoice.title}</h1>
                <p className="mt-2 text-sm text-ink/55">Track the request, share the hosted payment link, and verify the final receipt.</p>
              </div>
              <InvoiceStatusPill status={invoice.status} label={invoice.status === 'pending' && invoice.mainnetAttemptStatus === 'unresolved' ? 'Unresolved' : undefined} />
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="merchant-amount-card rounded-2xl bg-ink p-5 text-white">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">Requested stablecoin amount</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight">{invoice.amountUsdt0} <span className="text-sm text-mint">USD₮0</span></p>
              </div>
              <div className="payment-link-card rounded-2xl border border-ink/10 bg-cloud p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/45">Buyer payment link</p>
                <p className="mt-2 break-all font-mono text-xs text-ink/65">{invoice.paymentUrl}</p>
                <div className="mt-3"><CopyButton value={invoice.paymentUrl} /></div>
              </div>
            </div>

            <div className={`invoice-status-banner mt-5 rounded-2xl p-5 ${invoice.status === 'paid' ? 'invoice-status-banner--paid border border-emerald-200 bg-emerald-50' : invoice.mainnetAttemptStatus === 'unresolved' ? 'invoice-status-banner--unresolved border border-rose-200 bg-rose-50' : 'invoice-status-banner--pending border border-ink/10 bg-cloud'}`}>
               <p className="text-sm font-semibold">{invoice.status === 'paid' ? 'Payment received' : invoice.mainnetAttemptStatus === 'unresolved' ? 'Payment status unresolved' : invoice.mainnetAttemptStatus === 'submitted' ? 'Payment submitted, awaiting verification' : 'Waiting for payment'}</p>
               <p className="mt-2 text-sm leading-6 text-ink/55">
                 {invoice.status === 'paid'
                   ? 'The merchant receipt below uses the persisted, confirmed PortPay settlement evidence.'
                   : invoice.mainnetAttemptStatus === 'unresolved'
                     ? 'This invoice was not successfully completed. Its one Mainnet payment attempt cannot be retried. Check with the buyer for any wallet transaction; create a new invoice for another attempt.'
                     : invoice.mainnetAttemptStatus === 'submitted'
                       ? 'This invoice is not yet paid. The original transaction is awaiting canonical verification; do not request another payment on this invoice.'
                       : 'Share the payment link with your customer. Buyer wallet controls and Smart Spend stay on the separate hosted checkout.'}
              </p>
            </div>

            {invoice.status === 'paid' ? <PaymentReceipt invoice={invoice} role="merchant" /> : null}

            <dl className="mt-6 grid gap-4 border-t border-ink/10 pt-5 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-4"><dt className="text-ink/45">Merchant wallet</dt><dd className="font-mono">{shortenAddress(invoice.merchantAddress)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-ink/45">Network</dt><dd>{paymentNetworkLabel(invoiceNetwork)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-ink/45">Invoice ID</dt><dd className="max-w-[18rem] break-all text-right font-mono text-xs">{invoice.id}</dd></div>
            </dl>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PaymentReceipt({ invoice, role }: { invoice: Invoice; role: 'buyer' | 'merchant' }) {
  const paymentNetwork = getInvoicePaymentNetwork(invoice);
  const explorerUrl = getExplorerTransactionUrl(invoice.paymentTxHash, paymentNetwork);
  const evidenceComplete = hasVerifiedPaymentEvidence(invoice);
  const isBuyer = role === 'buyer';

  return (
    <section className={`payment-receipt ${isBuyer ? 'payment-receipt--buyer' : 'payment-receipt--merchant'} mt-6 rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-5 shadow-panel sm:p-6`}>
      <div className="payment-receipt__header flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-800">{isBuyer ? 'Buyer receipt' : 'Merchant receipt'}</p>
          <h2 className="payment-receipt__title mt-2 text-2xl font-semibold tracking-tight text-emerald-950"><span className="payment-receipt__success-mark" aria-hidden="true">✓</span>{paymentSuccessLabel(role)}</h2>
        </div>
        <InvoiceStatusPill status={invoice.status} label={isBuyer ? 'Payment confirmed' : undefined} />
      </div>

      <div className="payment-receipt__summary mt-6 flex flex-col gap-4 rounded-2xl bg-white/65 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-900/55">{isBuyer ? 'You paid' : 'You received'}</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-emerald-950">{isBuyer ? formatSpentAmount(invoice) : formatReceivedAmount(invoice)}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-900/55">{isBuyer ? 'Merchant received' : 'Buyer paid'}</p>
          <p className="mt-1 text-lg font-semibold text-emerald-950">{isBuyer ? formatReceivedAmount(invoice) : formatSpentAmount(invoice)}</p>
        </div>
      </div>

      <p className="mt-5 text-sm leading-6 text-emerald-950">
        Confirmed from PortPay's persisted, canonical settlement evidence on {paymentNetworkLabel(paymentNetwork)}.
      </p>

      <dl className="mt-6 grid gap-x-6 gap-y-4 border-t border-emerald-900/10 pt-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-emerald-900/55">Invoice</dt>
          <dd className="mt-1 font-semibold text-emerald-950">{invoice.title}</dd>
          <dd className="mt-1 break-all font-mono text-xs text-emerald-900/65">{invoice.id}</dd>
        </div>
        <div>
          <dt className="text-emerald-900/55">Status</dt>
          <dd className="mt-1 font-semibold text-emerald-950">{paymentStatusLabel(role, invoice.status)}</dd>
        </div>
        <div>
          <dt className="text-emerald-900/55">{isBuyer ? 'Merchant' : 'Buyer'}</dt>
          <dd className="mt-1 break-all font-mono text-xs text-emerald-950">{isBuyer ? invoice.merchantAddress : (invoice.buyerAddress ?? 'Unavailable')}</dd>
        </div>
        <div>
          <dt className="text-emerald-900/55">{isBuyer ? 'Your payment asset' : 'Merchant wallet'}</dt>
          <dd className="mt-1 font-semibold text-emerald-950">{isBuyer ? formatSpentAmount(invoice).replace(/^.*? /, '') : invoice.merchantAddress}</dd>
        </div>
        <div>
          <dt className="text-emerald-900/55">Asset spent</dt>
          <dd className="mt-1 font-semibold text-emerald-950">{formatSpentAmount(invoice)}</dd>
        </div>
        <div>
          <dt className="text-emerald-900/55">Settlement asset</dt>
          <dd className="mt-1 font-semibold text-emerald-950">
            USD₮0{isOfficialSettlementAsset(paymentNetwork === 'x-layer-mainnet' ? mainnetNetworkConfig.usdt0Address : internalTestnetNetworkConfig.stablecoinAddress, paymentNetwork) ? ` · verified ${paymentNetwork === 'x-layer-mainnet' ? 'Mainnet' : 'legacy testnet'} token` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-emerald-900/55">{isBuyer ? 'Merchant received' : 'You received'}</dt>
          <dd className="mt-1 font-semibold text-emerald-950">{formatReceivedAmount(invoice)}</dd>
        </div>
        <div>
          <dt className="text-emerald-900/55">Confirmed timestamp</dt>
          <dd className="mt-1 font-semibold text-emerald-950">{formatPaymentTimestamp(invoice.paidAt)}</dd>
        </div>
      </dl>

      <div className="mt-6 border-t border-emerald-900/10 pt-5 text-sm">
        <p className="text-emerald-900/55">Settlement transaction</p>
        {invoice.paymentTxHash ? (
          <p className="mt-1 break-all font-mono text-xs text-emerald-950">{invoice.paymentTxHash}</p>
        ) : (
          <p className="mt-1 text-emerald-950">Transaction evidence unavailable.</p>
        )}
        {explorerUrl ? (
          <a className="portpay-button portpay-button--receipt mt-3 inline-flex items-center rounded-xl bg-emerald-900 px-4 py-2.5 font-semibold text-white transition hover:-translate-y-0.5 hover:bg-emerald-950" href={explorerUrl} target="_blank" rel="noreferrer">
            View on X Layer Explorer <span className="ml-2 text-mint">↗</span>
          </a>
        ) : null}
        {!evidenceComplete ? (
          <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            Some canonical settlement evidence is missing from this record. PortPay will not invent the missing transaction details.
          </p>
        ) : null}
        {invoice.settlementBlockNumber ? <p className="mt-3 text-xs text-emerald-900/65">Settlement block: {invoice.settlementBlockNumber}</p> : null}
        {isBuyer ? <div className="mt-4 rounded-xl border border-emerald-900/10 bg-white/60 px-3 py-2 text-xs leading-5 text-emerald-900/70">
          {invoice.smartSpendUsed ? (
            <>
              <span className="font-semibold text-emerald-950">Smart Spend selected in checkout</span>
              {invoice.smartSpendRecommendedAsset ? ` · ${portfolioAssets[invoice.smartSpendRecommendedAsset].label}` : ''}
              {invoice.smartSpendReason ? <span className="block">{invoice.smartSpendReason}</span> : null}
            </>
          ) : (
            <span><span className="font-semibold text-emerald-950">Manual asset selection in checkout</span> · Smart Spend was not used.</span>
          )}
          <span className="mt-1 block">Choice and reason are checkout-reported; the settlement receipt verifies the asset and amounts.</span>
        </div> : null}
      </div>
    </section>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="portpay-shell min-h-screen overflow-hidden bg-cloud text-ink">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-5 sm:px-8 sm:py-7 lg:px-12">
        <header className="app-header flex items-center justify-between border-b border-ink/10 pb-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-ink text-lg font-bold text-mint shadow-sm">P</span>
            <div>
              <span className="block text-lg font-semibold tracking-tight">PortPay</span>
              <span className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/40 sm:block">Portfolio payments, simplified</span>
            </div>
          </div>
          <nav className="flex items-center gap-2 text-xs font-semibold text-ink/60 sm:gap-4">
            <a className="rounded-lg px-2 py-1.5 transition hover:bg-white hover:text-ink" href="/merchant">Merchant</a>
            <a className="rounded-lg px-2 py-1.5 transition hover:bg-white hover:text-ink" href="/docs">Docs</a>
            <span className="rounded-full border border-ink/10 bg-white/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/60">
              <span className="hidden sm:inline">X Layer Mainnet · </span>196
            </span>
          </nav>
        </header>

        {children}

        <footer className="flex flex-col gap-2 border-t border-ink/10 py-6 text-xs leading-5 text-ink/45 sm:flex-row sm:items-center sm:justify-between">
          <span>PortPay · customers spend portfolios, merchants receive stablecoins</span>
          <span>Mainnet Pay requires explicit buyer wallet confirmation; the backend never signs or broadcasts.</span>
        </footer>
      </div>
    </main>
  );
}

const docsNavigation = [
  { slug: 'index', label: 'Overview', href: '/docs' },
  { slug: 'getting-started', label: 'Getting started', href: '/docs/getting-started' },
  { slug: 'how-it-works', label: 'How it works', href: '/docs/how-it-works' },
  { slug: 'merchant-integration', label: 'Merchant integration', href: '/docs/merchant-integration' },
] as const;

function DocsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-ink/10 bg-paper p-5 shadow-panel sm:p-6">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-ink/65">{children}</div>
    </section>
  );
}

function DocumentationPage({ slug }: { slug: 'index' | 'getting-started' | 'how-it-works' | 'merchant-integration' | 'testnet' }) {
  const active = docsNavigation.find((item) => item.slug === slug) ?? docsNavigation[0];

  return (
    <section className="flex flex-1 flex-col py-8 sm:py-12">
      <div className="grid gap-8 lg:grid-cols-[13rem_1fr] lg:items-start">
        <aside className="lg:sticky lg:top-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/45">PortPay docs</p>
          <nav className="mt-3 grid gap-1">
            {docsNavigation.map((item) => (
              <a
                key={item.slug}
                className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition ${item.slug === active.slug ? 'bg-ink text-white' : 'text-ink/60 hover:bg-white hover:text-ink'}`}
                href={item.href}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="mt-5 rounded-2xl border border-mint/40 bg-mint/25 p-4 text-xs leading-5 text-ink/65">
            X Layer Mainnet is the product network. Buyer-signed Pay is implemented; the buyer confirms in OKX Wallet, and PortPay verifies before marking an invoice paid.
          </div>
        </aside>

        <div className="min-w-0">
          <div className="rounded-[1.5rem] bg-ink p-6 text-white shadow-soft sm:p-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-mint/75">{active.label}</p>
            <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
              {slug === 'index' ? 'Spend your portfolio. Merchants get stablecoins.' : active.label}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/65">
              PortPay lets customers spend their tokenized stock portfolio while merchants receive stablecoins.
            </p>
          </div>

          <div className="mt-6 grid gap-5">
            {slug === 'index' ? (
              <>
                <DocsSection title="A payment method for tokenized portfolios">
                  <p>Businesses request payment in real USD₮0. Customers choose a supported tokenized asset; when execution is authorized, both sides receive receipts backed by verified onchain evidence.</p>
                  <p>Merchants can use the dashboard for payment links or integrate PortPay into their existing checkout through the server-side invoice API and hosted buyer checkout.</p>
                </DocsSection>
                <DocsSection title="The two-sided flow">
                  <div className="grid gap-3 sm:grid-cols-3">
                    {['Merchant creates a stablecoin invoice', 'Buyer reviews a supported portfolio asset', 'Verified receipts follow an authorized settlement'].map((step, index) => (
                      <div key={step} className="rounded-xl bg-cloud p-4"><span className="font-mono text-xs text-ink/40">0{index + 1}</span><p className="mt-2 font-semibold text-ink">{step}</p></div>
                    ))}
                  </div>
                  <p>Mainnet checkout uses the persisted, server-validated preparation. The buyer manually confirms the transaction in OKX Wallet; PortPay never signs or broadcasts, and paid status follows canonical verification.</p>
                </DocsSection>
              </>
            ) : null}

            {slug === 'how-it-works' ? (
              <DocsSection title="From invoice to receipt">
                <ol className="grid gap-3">
                  {[
                    'Merchant creates a stablecoin invoice.',
                    'PortPay generates a unique hosted payment link.',
                    'Buyer opens checkout and connects OKX Wallet on X Layer Mainnet.',
                    'Buyer reviews supported wNVDAx/wAAPLx details and any allowed exact approval.',
                    'PortPay prepares a direct-to-merchant OKX DEX route; the buyer reviews and manually confirms it in OKX Wallet.',
                    'PortPay reconciles canonical mainnet evidence before the merchant invoice becomes paid.',
                    'Buyer and merchant receive role-specific receipts from the same persisted settlement evidence.',
                  ].map((step, index) => <li key={step} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-xs font-bold text-mint">{index + 1}</span><span>{step}</span></li>)}
                </ol>
                <p><strong className="text-ink">Current product configuration:</strong> X Layer Mainnet, supported wNVDAx/wAAPLx, real USD₮0, separate mainnet Builder Code, and the isolated `OKXDEXMainnetAdapter`. Buyer-signed Pay is implemented; every payment requires explicit wallet confirmation, while the backend remains read-only and never signs or broadcasts.</p>
              </DocsSection>
            ) : null}

            {slug === 'getting-started' ? (
              <>
                <DocsSection title="Open the merchant and buyer flow">
                  <ol className="space-y-2">
                    <li>1. Start the backend on `http://localhost:3001` and frontend on `http://localhost:5173`.</li>
                    <li>2. Open `/merchant`, connect the merchant OKX Wallet on X Layer Mainnet, and create an invoice denominated in real USD₮0.</li>
                    <li>3. Copy the generated `/pay/:invoiceId` link into a separate buyer tab.</li>
                    <li>4. Connect the buyer wallet, review the supported tokenized asset and any exact approval preparation.</li>
                    <li>5. Review and confirm Pay in OKX Wallet. Keep the invoice pending until PortPay verifies the canonical settlement receipt.</li>
                  </ol>
                </DocsSection>
                <DocsSection title="What you need">
                  <p>OKX Wallet on X Layer Mainnet (chain 196), mainnet OKB for gas, supported wNVDAx/wAAPLx, and real USD₮0. Each payment is initiated only after the buyer manually confirms the prepared transaction in the wallet.</p>
                  <p>Apply the Supabase migrations and configure backend secrets locally. Browser code never receives the Supabase service-role key or merchant API secrets.</p>
                </DocsSection>
              </>
            ) : null}

            {slug === 'merchant-integration' ? (
              <>
                <DocsSection title="Hosted checkout for existing businesses">
                  <p>Your business does not need to hold or manage xStocks. Price products normally in stablecoins, create an invoice from your backend, redirect the customer to the hosted PortPay checkout, and fulfill after verified status or webhook confirmation.</p>
                  <p>Merchants can use the dashboard for payment links, or integrate invoice creation and payment confirmation into their own website.</p>
                  <p><strong className="text-ink">Current limitation:</strong> Buyers must complete payment in OKX Wallet, and merchants should fulfill only after PortPay reports the verified paid status. PortPay's backend does not sign or broadcast transactions.</p>
                </DocsSection>
                <DocsSection title="1. Create an invoice from your server">
                  <p>Use a test API key in the `Authorization` header. Keep this request server-side; never put the key in browser code.</p>
                  <pre className="overflow-x-auto rounded-xl bg-ink p-4 text-xs leading-5 text-white">{`POST /api/integration/invoices\nAuthorization: Bearer <PORTPAY_TEST_API_KEY>\nContent-Type: application/json\n\n{\n  "title": "Pro plan",\n  "amountUsdt0": "20.00",\n  "externalOrderReference": "order-1001"\n}`}</pre>
                  <pre className="overflow-x-auto rounded-xl bg-cloud p-4 text-xs leading-5 text-ink">{`{\n  "invoice": {\n    "id": "<uuid>",\n    "status": "pending",\n    "paymentUrl": "https://pay.example/pay/<uuid>",\n    "amountUsdt0": "20",\n    "externalOrderReference": "order-1001"\n  }\n}`}</pre>
                </DocsSection>
                <DocsSection title="2. Redirect and verify">
                  <p>Redirect the customer to the returned `paymentUrl`. After checkout, retrieve the verified result from:</p>
                  <pre className="overflow-x-auto rounded-xl bg-ink p-4 text-xs leading-5 text-white">{`GET /api/integration/invoices/<uuid>/status\nAuthorization: Bearer <PORTPAY_TEST_API_KEY>`}</pre>
                  <p>The API returns `pending` until PortPay verifies the onchain receipt and canonical confirmation depth. Client-side claims cannot mark an invoice paid.</p>
                </DocsSection>
                <DocsSection title="3. Optional signed webhook">
                  <p>Configure `PORTPAY_TEST_WEBHOOK_URL` and `PORTPAY_TEST_WEBHOOK_SECRET` on the backend. After verified reconciliation, PortPay sends `payment.confirmed` with the invoice ID, external order reference, requested amount, paid status, settlement transaction hash, and timestamp.</p>
                  <p>Verify the `x-portpay-signature` header as `sha256=HMAC-SHA256(secret, raw JSON body)`. Use `x-portpay-event-id` / `idempotency-key` for deduplication. PortPay retries a failed callback in-process up to three times; payment remains paid if delivery fails.</p>
                </DocsSection>
                <DocsSection title="Useful business models">
                  <p>Ecommerce checkout, SaaS invoices, digital products, freelance services, and shareable merchant payment links all use the same hosted flow.</p>
                </DocsSection>
              </>
            ) : null}

            {slug === 'testnet' ? (
              <>
                <DocsSection title="Internal X Layer Testnet regression boundary">
                  <p>Network: X Layer Testnet, chain ID `1952`, native gas token OKB. The demo assets are ordinary ERC-20 test assets used to safely demonstrate the xStock payment experience. They are not real shares or backed securities.</p>
                  <p>DemoAAPL: `0x756546fce7d7ca3bb4be127904b002baf13b432e` · DemoNVDA: `0xa0c469d4419446c21a1d992c0a1c3cdc09bbcc4e` · official testnet USD₮0: `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`.</p>
                </DocsSection>
                <DocsSection title="Builder Codes and evidence">
                  <p>PortPay attaches the registered Builder Code `kob1lkgsg6infkg3` to eligible approval and settlement transactions. The registry payout resolves to the buyer test wallet recorded in the README evidence.</p>
                  <p>Historical testnet transaction links and confirmation details remain in the README for audit/compatibility. This page is only available in explicitly enabled local development.</p>
                </DocsSection>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function BuilderCodeDebugPage() {
  const [result, setResult] = useState<{ status: 'checking' | 'verified' | 'failed'; message: string; details?: string }>({
    status: 'checking',
    message: 'Running the browser registry verification…',
  });

  useEffect(() => {
    assertRegisteredBuilderCode(
      portPayBuilderCode,
      () => readBuilderCodePayoutAddress(portPayBuilderCode),
    ).then(
      () => setResult({ status: 'verified', message: 'Builder Code verification passed.' }),
      (error: unknown) => setResult({
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        details: error instanceof BuilderCodeVerificationError
          ? JSON.stringify(error.diagnostics, null, 2)
          : undefined,
      }),
    );
  }, []);

  return (
    <section className="flex flex-1 items-center justify-center py-16">
      <div className="w-full max-w-2xl rounded-[2rem] border border-ink/10 bg-white p-7 shadow-soft sm:p-10">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-ink/45">Development diagnostics</p>
        <h1 className="mt-3 text-3xl font-semibold text-ink">Builder Code registry check</h1>
        <p className="mt-3 text-sm leading-6 text-ink/60">This temporary page runs the same fail-closed check used immediately before buyer approval.</p>
        <div className="mt-7 rounded-2xl bg-ink/5 p-5 text-sm leading-7 text-ink">
          <p><strong>Code:</strong> {portPayBuilderCode}</p>
          <p><strong>Status:</strong> {result.status}</p>
          <p className="mt-2">{result.message}</p>
          {result.details ? <pre className="mt-4 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-4 text-xs leading-5">{result.details}</pre> : null}
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const allowInternalTestnet = import.meta.env.DEV && import.meta.env.VITE_ENABLE_INTERNAL_TESTNET === 'true';
  const [route, setRoute] = useState<InvoiceRoute>(() => readInvoiceRoute(
    window.location.pathname,
    window.location.search,
    { allowInternalTestnet },
  ));

  useEffect(() => {
    const onPopState = () => setRoute(readInvoiceRoute(
      window.location.pathname,
      window.location.search,
      { allowInternalTestnet },
    ));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [allowInternalTestnet]);

  function openMerchantInvoice(invoiceId: string) {
    window.history.pushState({}, '', `/merchant/invoices/${encodeURIComponent(invoiceId)}`);
    setRoute({ type: 'merchantInvoice', invoiceId });
  }

  function openBuyerInvoice(invoiceId: string) {
    window.history.pushState({}, '', `/pay/${encodeURIComponent(invoiceId)}`);
    setRoute({ type: 'pay', invoiceId, paymentNetwork: 'mainnet' });
  }

  function openDashboard() {
    window.history.pushState({}, '', '/');
    setRoute({ type: 'dashboard' });
  }

  return (
    <AppShell>
      {import.meta.env.DEV && window.location.pathname === '/__builder-code-debug' ? (
        <BuilderCodeDebugPage />
      ) : route.type === 'docs' ? (
        <DocumentationPage slug={route.slug} />
      ) : route.type === 'merchantInvoice' ? (
        <MerchantInvoicePage invoiceId={route.invoiceId} onBack={openDashboard} />
      ) : route.type === 'pay' ? (
        <BuyerCheckoutPage invoiceId={route.invoiceId} paymentNetwork={route.paymentNetwork} onBack={openDashboard} onOpenBuyerInvoice={openBuyerInvoice} />
      ) : (
        <MerchantDashboard onOpenMerchantInvoice={openMerchantInvoice} />
      )}
    </AppShell>
  );
}
