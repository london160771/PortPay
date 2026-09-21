import { useEffect, useMemo, useState } from 'react';
import type { Address } from 'viem';
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useSwitchChain,
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
  type Invoice,
  type SettlementQuote,
} from './config/api';
import { erc20BalanceAbi, formatTokenBalance, parseConfiguredAddress, portfolioAssets, testnetAssets } from './config/assets';
import { portPayNetworkConfig, xLayerTestnet } from './config/network';
import { invoiceStatusLabel, readInvoiceRoute, type InvoiceRoute } from './config/invoice';
import {
  formatPaymentTimestamp,
  formatReceivedAmount,
  formatSpentAmount,
  getExplorerTransactionUrl,
  hasVerifiedPaymentEvidence,
  isOfficialSettlementAsset,
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
import { getWalletNetworkState, shortenAddress } from './config/wallet';
import { okxWalletConnector } from './config/wagmi';
import {
  assertRegisteredBuilderCode,
  BuilderCodeVerificationError,
  builderCodeTransactionData,
  portPayBuilderCode,
  readBuilderCodePayoutAddress,
} from './config/builderCodes';


type TokenBalanceCardProps = {
  asset: (typeof testnetAssets)[keyof typeof testnetAssets];
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
    chainId: xLayerTestnet.id,
    query: { enabled: queryEnabled },
  });
  const { data: decimals, isError: decimalsError, isLoading: decimalsLoading } = useReadContract({
    address,
    abi: erc20BalanceAbi,
    functionName: 'decimals',
    chainId: xLayerTestnet.id,
    query: { enabled: queryEnabled },
  });

  const formattedBalance = formatTokenBalance(balance, decimals);
  const isLoading = balanceLoading || decimalsLoading;
  const readFailed = balanceError || decimalsError;

  let detail = 'Connect OKX Wallet on X Layer Testnet to read this balance.';
  if (!address) {
    detail = `Address not configured yet. Deploy ${asset.label}, then set its VITE_* address variable.`;
  } else if (canRead && isLoading) {
    detail = 'Reading token balance and decimals…';
  } else if (canRead && readFailed) {
    detail = 'Unable to read this token at the configured address.';
  } else if (canRead && formattedBalance !== undefined) {
    detail = 'Read from the token contract on X Layer Testnet.';
  }

  return (
    <article className="portpay-appear rounded-3xl border border-ink/10 bg-paper p-5 text-ink shadow-panel transition hover:-translate-y-0.5 hover:shadow-soft">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/45">Wallet balance</p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight">{asset.label}</h3>
        </div>
        <span className="rounded-full bg-mint/75 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-ink">Testnet</span>
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
    <section className="portpay-appear relative overflow-hidden rounded-[2rem] border border-white/10 bg-ink p-6 text-white shadow-soft sm:p-8">
      <div className="portpay-grid pointer-events-none absolute inset-0 opacity-30" />
      <div className="relative">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-mint/75">Merchant wallet</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Ready to collect</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/60">
            Connect OKX Wallet to create invoices, share payment links, and watch confirmed receipts arrive on X Layer Testnet.
          </p>
        </div>
        <span
          className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${
            networkState === 'ready'
              ? 'bg-mint text-ink'
              : networkState === 'wrong-network'
                ? 'bg-amber-300 text-amber-950'
                : 'bg-white/10 text-white/70'
          }`}
        >
          {networkState === 'ready'
            ? 'X LAYER TESTNET'
            : networkState === 'wrong-network'
              ? 'WRONG NETWORK'
              : 'NOT CONNECTED'}
        </span>
      </div>

      {!isConnected ? (
        <div className="mt-7">
          <button
            type="button"
            className="rounded-xl bg-mint px-5 py-3 text-sm font-bold text-ink transition hover:bg-white disabled:cursor-wait disabled:opacity-60"
            onClick={() => connect({ connector: okxWalletConnector })}
            disabled={isConnecting}
          >
            {isConnecting ? 'Opening OKX Wallet…' : 'Connect OKX Wallet'}
          </button>
          <p className="mt-3 text-xs text-white/45">OKX Wallet must be installed and unlocked in this browser.</p>
          {connectError ? <p className="mt-3 text-sm text-rose-200">{connectError.message}</p> : null}
        </div>
      ) : networkState === 'wrong-network' ? (
        <div className="mt-7 rounded-2xl border border-amber-200/20 bg-amber-200/10 p-4">
          <p className="text-sm font-semibold text-amber-100">Switch to X Layer Testnet to create invoices.</p>
          <p className="mt-1 text-xs text-amber-100/70">
            This wallet is connected on chain {chainId ?? 'unknown'}; PortPay merchant actions are enabled only on chain 1952.
          </p>
          <button
            type="button"
            className="mt-4 rounded-xl bg-amber-200 px-4 py-2.5 text-sm font-bold text-amber-950 transition hover:bg-white disabled:cursor-wait disabled:opacity-60"
            onClick={() => switchChain({ chainId: xLayerTestnet.id })}
            disabled={isSwitching}
          >
            {isSwitching ? 'Switching network…' : 'Switch to X Layer Testnet'}
          </button>
          {switchError ? <p className="mt-3 text-sm text-rose-200">{switchError.message}</p> : null}
        </div>
      ) : (
        <div className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-mint">Wallet connected to X Layer Testnet</p>
            <p className="mt-1 font-mono text-sm text-white/60">{shortenAddress(address!)}</p>
          </div>
          <button
            type="button"
            className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:border-white/50 hover:text-white"
            onClick={() => disconnect()}
          >
            Disconnect
          </button>
        </div>
      )}

      <div className="mt-7 grid gap-3 border-t border-white/10 pt-5 text-xs text-white/45 sm:grid-cols-2">
        <span>Network: {xLayerTestnet.name}</span>
        <span>Chain ID: {portPayNetworkConfig.chainId}</span>
        <span>Gas: {xLayerTestnet.nativeCurrency.symbol}</span>
        <span>Invoices: Supabase/Postgres</span>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <TokenBalanceCard asset={testnetAssets.demoAapl} account={address} canRead={canReadBalances} />
        <TokenBalanceCard asset={testnetAssets.demoNvda} account={address} canRead={canReadBalances} />
        <TokenBalanceCard asset={testnetAssets.usdt0} account={address} canRead={canReadBalances} />
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
      className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-ink/80"
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
      setError('Connect the merchant wallet on X Layer Testnet first.');
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
    <section id="create-invoice" className="portpay-appear rounded-3xl border border-ink/10 bg-paper p-6 shadow-panel sm:p-7">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/45">Step 1 · Create</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">Create a payment request</h2>
        <p className="mt-2 text-sm leading-6 text-ink/55">
          Name the thing you are charging for and set the exact amount in official testnet USD₮0. PortPay creates a unique link you can send to the buyer.
        </p>
      </div>

      <form className="mt-6 space-y-5" onSubmit={submitInvoice}>
        <label className="block">
          <span className="text-sm font-semibold">Product or service name</span>
          <input
            className="mt-2 w-full rounded-xl border border-ink/15 bg-cloud px-4 py-3 text-sm outline-none transition focus:border-electric/70 focus:bg-white"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Harbor design consultation"
            maxLength={120}
            required
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold">Amount due in USD₮0</span>
            <div className="mt-2 flex items-center rounded-xl border border-ink/15 bg-cloud focus-within:border-electric/70 focus-within:bg-white">
            <input
              className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm outline-none"
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
          className="w-full rounded-xl bg-ink px-5 py-3.5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-ink/85 hover:shadow-panel disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canCreate || isSubmitting}
        >
          {isSubmitting ? 'Saving invoice…' : 'Create invoice and payment link'}
        </button>
        {!canCreate ? (
          <p className="text-center text-xs text-ink/45">Connect and switch to X Layer Testnet to enable invoice creation.</p>
        ) : null}
      </form>
    </section>
  );
}

function InvoiceStatusPill({ status }: { status: Invoice['status'] }) {
  return (
    <span
      aria-label={`Invoice status: ${invoiceStatusLabel(status)}`}
      className={`rounded-full px-3 py-1 text-xs font-bold ${
        status === 'paid' ? 'bg-mint text-ink' : 'bg-amber-100 text-amber-900'
      }`}
    >
      {invoiceStatusLabel(status)}
    </span>
  );
}

function PaymentHistoryPanel({
  address,
  canRead,
  onOpenInvoice,
}: {
  address: Address | undefined;
  canRead: boolean;
  onOpenInvoice: (invoiceId: string) => void;
}) {
  const [view, setView] = useState<'buyer' | 'merchant'>('merchant');
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
    <section id="history" className="portpay-appear rounded-3xl border border-ink/10 bg-paper p-6 shadow-panel sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/45">Step 3 · History</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            {view === 'merchant' ? 'What this wallet received' : 'What this wallet spent'}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/55">
            Confirmed payments only. Every row is backed by persisted settlement evidence and links to the X Layer receipt.
          </p>
        </div>
        <div className="flex rounded-xl bg-cloud p-1 text-xs font-semibold">
          <button
            type="button"
            className={`rounded-lg px-3 py-2 transition ${view === 'merchant' ? 'bg-ink text-white' : 'text-ink/55 hover:text-ink'}`}
            onClick={() => setView('merchant')}
          >
            Merchant view
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-2 transition ${view === 'buyer' ? 'bg-ink text-white' : 'text-ink/55 hover:text-ink'}`}
            onClick={() => setView('buyer')}
          >
            Buyer view
          </button>
        </div>
      </div>

      {isLoading ? <p className="mt-7 rounded-2xl bg-cloud p-5 text-sm text-ink/55">Loading confirmed payment history…</p> : null}
      {loadError ? <p className="mt-7 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</p> : null}
      {!canRead || !address ? (
        <p className="mt-7 rounded-2xl bg-cloud p-5 text-sm leading-6 text-ink/55">
          Connect a wallet on X Layer Testnet to load its payment history.
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
            const explorerUrl = getExplorerTransactionUrl(payment.paymentTxHash);
            const evidenceComplete = hasVerifiedPaymentEvidence(payment);
            return (
              <article key={payment.id} className="group rounded-2xl border border-ink/10 bg-cloud/60 p-4 transition hover:border-ink/20 hover:bg-white sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <button type="button" className="text-left" onClick={() => onOpenInvoice(payment.id)}>
                    <p className="font-semibold group-hover:underline group-hover:underline-offset-4">{payment.title}</p>
                    <p className="mt-1 text-xs text-ink/45">
                      Paid {formatPaymentTimestamp(payment.paidAt)} · Invoice {payment.id.slice(0, 8)}…
                    </p>
                  </button>
                  <InvoiceStatusPill status={payment.status} />
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
    { number: '01', title: 'Create', detail: 'Merchant sets a USD₮0 amount and shares one link.' },
    { number: '02', title: 'Pay', detail: 'Buyer reviews a precise quote and confirms in OKX Wallet.' },
    { number: '03', title: 'Confirm', detail: 'Both sides see the same verified X Layer receipt.' },
  ];

  return (
    <aside id="two-tab-demo" className="portpay-appear rounded-[2rem] border border-white/10 bg-ink p-6 text-white shadow-soft sm:p-7">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-mint/75">Two-tab demo</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">A clean handoff, end to end.</h2>
        </div>
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-mint text-lg font-bold text-ink">↗</span>
      </div>
      <div className="mt-7 space-y-5">
        {steps.map((step, index) => (
          <div key={step.number} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 font-mono text-[10px] font-bold text-mint">{step.number}</span>
              {index < steps.length - 1 ? <span className="mt-2 h-full w-px bg-white/10" /> : null}
            </div>
            <div className={index < steps.length - 1 ? 'pb-1' : ''}>
              <p className="font-semibold">{step.title}</p>
              <p className="mt-1 text-sm leading-6 text-white/55">{step.detail}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-7 rounded-2xl border border-mint/20 bg-mint/10 p-4 text-xs leading-5 text-white/65">
        <span className="font-semibold text-mint">Testnet only.</span> DemoAAPL and DemoNVDA are ordinary demo assets, not real shares. Merchant settlement uses official X Layer Testnet USD₮0.
      </div>
    </aside>
  );
}

function MerchantDashboard({ onOpenInvoice }: { onOpenInvoice: (invoiceId: string) => void }) {
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
      <section className="relative grid gap-10 overflow-hidden py-12 sm:py-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:py-20">
        <div className="portpay-grid pointer-events-none absolute inset-x-0 top-0 h-full opacity-50" />
        <div className="relative">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-ink/10 bg-white/75 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-ink/60 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
            Merchant workspace · X Layer Testnet
          </div>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[0.98] tracking-[-0.065em] sm:text-7xl">
            Spend your portfolio.<br /><span className="text-ink/45">Get paid in stablecoins.</span>
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-ink/65">
            PortPay turns a simple invoice into a clean two-sided payment flow: you request official testnet USD₮0, your customer pays from a demo portfolio, and the receipt reconciles onchain.
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

      <section className="grid gap-4 py-8 sm:grid-cols-3">
        <div className="portpay-appear rounded-3xl border border-ink/10 bg-paper p-5 shadow-panel">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/45">All invoices</p>
          <p className="mt-3 text-4xl font-semibold tracking-tight">{invoices.length}</p>
          <p className="mt-2 text-sm text-ink/55">Stored for this merchant wallet.</p>
        </div>
        <div className="portpay-appear rounded-3xl border border-ink/10 bg-paper p-5 shadow-panel">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/45">Awaiting payment</p>
          <p className="mt-3 text-4xl font-semibold tracking-tight">{pendingCount}</p>
          <p className="mt-2 text-sm text-ink/55">Open requests waiting for a buyer.</p>
        </div>
        <div className="portpay-appear rounded-3xl border border-ink/10 bg-ink p-5 text-white shadow-panel">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-mint/70">Payment received</p>
          <p className="mt-3 text-4xl font-semibold tracking-tight">{paidCount}</p>
          <p className="mt-2 text-sm text-white/55">Confirmed from settlement evidence.</p>
        </div>
      </section>

      <section className="grid gap-6 pb-8 lg:grid-cols-[0.9fr_1.1fr]">
        <InvoiceForm merchantAddress={address} canCreate={canCreate} onCreated={handleCreated} />

        <section className="portpay-appear rounded-3xl border border-ink/10 bg-paper p-6 shadow-panel sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/45">Step 2 · Monitor</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Your payment requests</h2>
            </div>
            {isLoading ? <span className="text-xs text-ink/45">Loading…</span> : null}
          </div>

          {createdInvoice ? (
              <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
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
                onClick={() => onOpenInvoice(createdInvoice.id)}
              >
                Open buyer preview ↗
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
              No invoices yet. Once the wallet is connected to X Layer Testnet, create the first payment request.
            </p>
          ) : (
            <div className="mt-6 divide-y divide-ink/10">
              {invoices.map((invoice) => (
                <button
                  key={invoice.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-4 py-4 text-left transition hover:bg-cloud/60"
                  onClick={() => onOpenInvoice(invoice.id)}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{invoice.title}</span>
                    <span className="mt-1 block text-xs text-ink/45">
                      {new Date(invoice.createdAt).toLocaleString()} · {shortenAddress(invoice.merchantAddress)}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-2">
                    <span className="font-semibold">{invoice.amountUsdt0} USD₮0</span>
                    <InvoiceStatusPill status={invoice.status} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </section>

      <PaymentHistoryPanel address={address} canRead={canCreate} onOpenInvoice={onOpenInvoice} />
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
  const networkState = getWalletNetworkState(isConnected, chainId);
  const [selectedAssetKey, setSelectedAssetKey] = useState<SmartSpendAssetKey>('demoAapl');
  const [appliedSmartSpend, setAppliedSmartSpend] = useState<ReturnType<typeof snapshotSmartSpendChoice>>(undefined);
  const smartSpendApplied = Boolean(appliedSmartSpend);
  const [targetAllocation, setTargetAllocation] = useState<TargetAllocationBps>(DEFAULT_TARGET_ALLOCATION_BPS);
  const assetAddress = parseConfiguredAddress(portfolioAssets[selectedAssetKey].address);
  const demoAaplAddress = parseConfiguredAddress(portfolioAssets.demoAapl.address);
  const demoNvdaAddress = parseConfiguredAddress(portfolioAssets.demoNvda.address);
  const stablecoinAddress = parseConfiguredAddress(testnetAssets.usdt0.address);
  const settlementAddress = parseConfiguredAddress(portPayNetworkConfig.settlementAddress);
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
              {paymentStep === 'awaiting-approval' ? `Approve ${portfolioAssets[selectedAssetKey].label} in wallet…` : paymentStep === 'confirming-approval' ? 'Confirming approval…' : paymentStep === 'awaiting-payment-signature' ? 'Confirm payment in wallet…' : paymentStep === 'confirming-payment' ? 'Confirming settlement…' : paymentStep === 'reconciling' ? 'Verifying payment…' : paymentStep === 'paid' ? 'Payment received' : `Approve and pay with ${portfolioAssets[selectedAssetKey].label}`}
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

function InvoiceDetailPage({ invoiceId, onBack }: { invoiceId: string; onBack: () => void }) {
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
    <section className="portpay-appear flex flex-1 items-center justify-center py-10 sm:py-16">
      <div className="w-full max-w-3xl rounded-[2rem] border border-ink/10 bg-paper p-6 shadow-soft sm:p-10">
        <button type="button" className="text-sm font-semibold text-ink/50 transition hover:text-ink" onClick={onBack}>
          ← Back to merchant workspace
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
          <div className="pt-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/45">PortPay checkout · Step 2 of 3</p>
              <InvoiceStatusPill status={invoice.status} />
            </div>
            <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <p className="text-sm font-semibold text-ink/45">You are paying</p>
                <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">{invoice.title}</h1>
              </div>
              <div className="rounded-2xl bg-ink px-5 py-4 text-white lg:min-w-56 lg:text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">Amount due</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight">{invoice.amountUsdt0} <span className="text-base text-mint">USD₮0</span></p>
              </div>
            </div>

            <div className={`mt-8 rounded-2xl p-5 ${invoice.status === 'paid' ? 'border border-emerald-200 bg-emerald-50' : 'border border-ink/10 bg-cloud'}`}>
              <div className="flex items-center gap-3">
                <span className={`grid h-8 w-8 place-items-center rounded-full text-sm font-bold ${invoice.status === 'paid' ? 'bg-emerald-600 text-white' : 'bg-amber-200 text-amber-950'}`}>
                  {invoice.status === 'paid' ? '✓' : '…'}
                </span>
                <p className="text-sm font-semibold">{invoiceStatusLabel(invoice.status)}</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-ink/55">
                {invoice.status === 'paid'
                  ? 'This status is read from a confirmed PortPay settlement event on X Layer Testnet.'
                  : 'Review the exact quote below, then approve the selected demo asset and confirm payment in OKX Wallet.'}
              </p>
            </div>

            {invoice.status === 'pending' ? <BuyerWalletPanel invoice={invoice} onPaid={setInvoice} /> : null}

            {invoice.status === 'paid' ? (
              <PaymentReceipt invoice={invoice} />
            ) : null}

            <dl className="mt-8 grid gap-4 border-t border-ink/10 pt-6 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-4">
                <dt className="text-ink/45">Merchant wallet</dt>
                <dd className="font-mono">{shortenAddress(invoice.merchantAddress)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink/45">Network</dt>
                <dd>X Layer Testnet · 1952</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink/45">Invoice ID</dt>
                <dd className="max-w-[16rem] break-all text-right font-mono text-xs">{invoice.id}</dd>
              </div>
            </dl>
            <p className="mt-6 text-center text-xs leading-5 text-ink/40">Testnet demonstration · Demo portfolio assets are not backed by real shares.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PaymentReceipt({ invoice }: { invoice: Invoice }) {
  const explorerUrl = getExplorerTransactionUrl(invoice.paymentTxHash);
  const evidenceComplete = hasVerifiedPaymentEvidence(invoice);

  return (
    <section className="mt-8 rounded-[1.75rem] border border-emerald-200 bg-emerald-50 p-5 shadow-panel sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-800">Step 3 · Receipt</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-emerald-950">Payment received</h2>
        </div>
        <InvoiceStatusPill status={invoice.status} />
      </div>

      <div className="mt-6 flex flex-col gap-4 rounded-2xl bg-white/65 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-900/55">Merchant received</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-emerald-950">{formatReceivedAmount(invoice)}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-900/55">Buyer spent</p>
          <p className="mt-1 text-lg font-semibold text-emerald-950">{formatSpentAmount(invoice)}</p>
        </div>
      </div>

      <p className="mt-5 text-sm leading-6 text-emerald-950">
        Confirmed from the canonical PortPay settlement receipt on X Layer Testnet. This is a portfolio settlement, not a DEX swap or market-price statement.
      </p>

      <dl className="mt-6 grid gap-x-6 gap-y-4 border-t border-emerald-900/10 pt-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-emerald-900/55">Invoice</dt>
          <dd className="mt-1 font-semibold text-emerald-950">{invoice.title}</dd>
          <dd className="mt-1 break-all font-mono text-xs text-emerald-900/65">{invoice.id}</dd>
        </div>
        <div>
          <dt className="text-emerald-900/55">Status</dt>
          <dd className="mt-1 font-semibold text-emerald-950">{invoiceStatusLabel(invoice.status)}</dd>
        </div>
        <div>
          <dt className="text-emerald-900/55">Buyer</dt>
          <dd className="mt-1 break-all font-mono text-xs text-emerald-950">{invoice.buyerAddress ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt className="text-emerald-900/55">Merchant</dt>
          <dd className="mt-1 break-all font-mono text-xs text-emerald-950">{invoice.merchantAddress}</dd>
        </div>
        <div>
          <dt className="text-emerald-900/55">Asset spent</dt>
          <dd className="mt-1 font-semibold text-emerald-950">{formatSpentAmount(invoice)}</dd>
        </div>
        <div>
          <dt className="text-emerald-900/55">Settlement asset</dt>
          <dd className="mt-1 font-semibold text-emerald-950">
            USD₮0{isOfficialSettlementAsset(portPayNetworkConfig.stablecoinAddress) ? ' · official X Layer Testnet token' : ''}
          </dd>
        </div>
        <div>
          <dt className="text-emerald-900/55">Merchant received</dt>
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
          <a className="mt-3 inline-flex items-center rounded-xl bg-emerald-900 px-4 py-2.5 font-semibold text-white transition hover:-translate-y-0.5 hover:bg-emerald-950" href={explorerUrl} target="_blank" rel="noreferrer">
            View on X Layer Explorer <span className="ml-2 text-mint">↗</span>
          </a>
        ) : null}
        {!evidenceComplete ? (
          <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            Some canonical settlement evidence is missing from this record. PortPay will not invent the missing transaction details.
          </p>
        ) : null}
        {invoice.settlementBlockNumber ? <p className="mt-3 text-xs text-emerald-900/65">Settlement block: {invoice.settlementBlockNumber}</p> : null}
        <div className="mt-4 rounded-xl border border-emerald-900/10 bg-white/60 px-3 py-2 text-xs leading-5 text-emerald-900/70">
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
        </div>
      </div>
    </section>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="portpay-shell min-h-screen overflow-hidden bg-cloud text-ink">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-5 sm:px-8 sm:py-7 lg:px-12">
        <header className="flex items-center justify-between border-b border-ink/10 pb-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-ink text-lg font-bold text-mint shadow-sm">P</span>
            <div>
              <span className="block text-lg font-semibold tracking-tight">PortPay</span>
              <span className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/40 sm:block">Portfolio payments, simplified</span>
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-ink/10 bg-white/70 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ink/60 sm:px-4">
            <span className="hidden sm:inline">X Layer Testnet · </span>1952
          </span>
        </header>

        {children}

        <footer className="flex flex-col gap-2 border-t border-ink/10 py-6 text-xs leading-5 text-ink/45 sm:flex-row sm:items-center sm:justify-between">
          <span>PortPay · testnet portfolio settlement</span>
          <span>DemoAAPL + DemoNVDA are demo assets, not real shares.</span>
        </footer>
      </div>
    </main>
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
  const [route, setRoute] = useState<InvoiceRoute>(() => readInvoiceRoute(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(readInvoiceRoute(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function openInvoice(invoiceId: string) {
    window.history.pushState({}, '', `/invoice/${encodeURIComponent(invoiceId)}`);
    setRoute({ type: 'invoice', invoiceId });
  }

  function openDashboard() {
    window.history.pushState({}, '', '/');
    setRoute({ type: 'dashboard' });
  }

  return (
    <AppShell>
      {import.meta.env.DEV && window.location.pathname === '/__builder-code-debug' ? (
        <BuilderCodeDebugPage />
      ) : route.type === 'invoice' ? (
        <InvoiceDetailPage invoiceId={route.invoiceId} onBack={openDashboard} />
      ) : (
        <MerchantDashboard onOpenInvoice={openInvoice} />
      )}
    </AppShell>
  );
}
