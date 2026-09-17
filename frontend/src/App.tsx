import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useSwitchChain,
} from 'wagmi';
import {
  ApiError,
  createInvoice as createInvoiceRequest,
  getInvoice,
  getMerchantInvoices,
  type Invoice,
} from './config/api';
import { erc20BalanceAbi, formatTokenBalance, parseConfiguredAddress, testnetAssets } from './config/assets';
import { portPayNetworkConfig, xLayerTestnet } from './config/network';
import { invoiceStatusLabel, readInvoiceRoute, type InvoiceRoute } from './config/invoice';
import { getWalletNetworkState, shortenAddress } from './config/wallet';
import { okxWalletConnector } from './config/wagmi';

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
    detail = 'Address not configured yet. Deploy DemoAAPL, then set VITE_DEMO_AAPL_ADDRESS.';
  } else if (canRead && isLoading) {
    detail = 'Reading token balance and decimals…';
  } else if (canRead && readFailed) {
    detail = 'Unable to read this token at the configured address.';
  } else if (canRead && formattedBalance !== undefined) {
    detail = 'Read from the token contract on X Layer Testnet.';
  }

  return (
    <article className="rounded-3xl border border-ink/10 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Testnet balance</p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight">{asset.label}</h3>
        </div>
        <span className="rounded-full bg-mint px-3 py-1 text-xs font-bold text-ink">READ ONLY</span>
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
    <section className="rounded-[2rem] border border-ink/10 bg-ink p-6 text-white shadow-soft sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-mint/75">Merchant wallet</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">OKX Wallet · X Layer Testnet</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/60">
            Connect the merchant wallet to create invoices and view its invoices. PortPay accepts invoice creation only on chain ID 1952.
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
            <p className="text-sm font-semibold text-mint">Connected to X Layer Testnet</p>
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
        <span>Gas token: {xLayerTestnet.nativeCurrency.symbol}</span>
        <span>Invoice storage: Supabase/Postgres</span>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <TokenBalanceCard asset={testnetAssets.demoAapl} account={address} canRead={canReadBalances} />
        <TokenBalanceCard asset={testnetAssets.usdt0} account={address} canRead={canReadBalances} />
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
      className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink/80"
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
    <section className="rounded-3xl border border-ink/10 bg-white p-6 shadow-sm sm:p-7">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Create invoice</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">Request USD₮0 from a customer</h2>
        <p className="mt-2 text-sm leading-6 text-ink/55">
          Add a clear product or service name and a stablecoin amount. A unique payment link is created after the backend validates and stores the invoice.
        </p>
      </div>

      <form className="mt-6 space-y-5" onSubmit={submitInvoice}>
        <label className="block">
          <span className="text-sm font-semibold">Product or service name</span>
          <input
            className="mt-2 w-full rounded-xl border border-ink/15 bg-cloud px-4 py-3 text-sm outline-none transition focus:border-ink/50"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Harbor design consultation"
            maxLength={120}
            required
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold">Amount due in USD₮0</span>
          <div className="mt-2 flex items-center rounded-xl border border-ink/15 bg-cloud focus-within:border-ink/50">
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
          className="w-full rounded-xl bg-ink px-5 py-3 text-sm font-bold text-white transition hover:bg-ink/80 disabled:cursor-not-allowed disabled:opacity-40"
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
      className={`rounded-full px-3 py-1 text-xs font-bold ${
        status === 'paid' ? 'bg-mint text-ink' : 'bg-amber-100 text-amber-900'
      }`}
    >
      {invoiceStatusLabel(status)}
    </span>
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
      <section className="py-14 sm:py-16">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-mint/70 px-3 py-1.5 text-sm font-semibold text-ink">
          <span className="h-2 w-2 rounded-full bg-emerald-600" />
          Phase 2 · Merchant invoice flow
        </div>
        <h1 className="max-w-4xl text-5xl font-semibold leading-[1.04] tracking-[-0.06em] sm:text-7xl">
          Turn a product into a shareable payment request.
        </h1>
        <p className="mt-7 max-w-2xl text-lg leading-8 text-ink/65">
          Create a USD₮0-denominated invoice, share the link, and keep the merchant view open while the future buyer checkout is built.
        </p>
      </section>

      <WalletPanel />

      <section className="grid gap-4 py-8 sm:grid-cols-3">
        <div className="rounded-3xl border border-ink/10 bg-white/75 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Invoices</p>
          <p className="mt-2 text-3xl font-semibold">{invoices.length}</p>
          <p className="mt-1 text-sm text-ink/55">Stored for this merchant wallet.</p>
        </div>
        <div className="rounded-3xl border border-ink/10 bg-white/75 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Waiting</p>
          <p className="mt-2 text-3xl font-semibold">{pendingCount}</p>
          <p className="mt-1 text-sm text-ink/55">Pending invoice records.</p>
        </div>
        <div className="rounded-3xl border border-ink/10 bg-white/75 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Received</p>
          <p className="mt-2 text-3xl font-semibold">{paidCount}</p>
          <p className="mt-1 text-sm text-ink/55">Paid records from later payment processing.</p>
        </div>
      </section>

      <section className="grid gap-6 pb-8 lg:grid-cols-[0.9fr_1.1fr]">
        <InvoiceForm merchantAddress={address} canCreate={canCreate} onCreated={handleCreated} />

        <section className="rounded-3xl border border-ink/10 bg-white p-6 shadow-sm sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Recent invoices</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Your payment requests</h2>
            </div>
            {isLoading ? <span className="text-xs text-ink/45">Loading…</span> : null}
          </div>

          {createdInvoice ? (
            <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800">Link ready to share</p>
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
                Open invoice detail
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
    </>
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
    <section className="flex flex-1 items-center justify-center py-16">
      <div className="w-full max-w-2xl rounded-[2rem] border border-ink/10 bg-white p-7 shadow-soft sm:p-10">
        <button type="button" className="text-sm font-semibold text-ink/55 hover:text-ink" onClick={onBack}>
          ← Back to merchant dashboard
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
          <div className="pt-12">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">PortPay invoice</p>
              <InvoiceStatusPill status={invoice.status} />
            </div>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">{invoice.title}</h1>
            <p className="mt-5 text-5xl font-semibold tracking-tight">
              {invoice.amountUsdt0} <span className="text-xl text-ink/50">USD₮0</span>
            </p>

            <div className="mt-10 rounded-2xl bg-cloud p-5">
              <p className="text-sm font-semibold">{invoiceStatusLabel(invoice.status)}</p>
              <p className="mt-2 text-sm leading-6 text-ink/55">
                {invoice.status === 'paid'
                  ? 'This status is read from the persisted invoice record.'
                  : 'Keep this invoice open while waiting for the future buyer checkout flow. No payment action is enabled in this phase.'}
              </p>
            </div>

            <dl className="mt-8 space-y-4 border-t border-ink/10 pt-6 text-sm">
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
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen overflow-hidden bg-cloud text-ink">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-6 sm:px-10 lg:px-12">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-ink text-lg font-bold text-mint">P</span>
            <span className="text-lg font-semibold tracking-tight">PortPay</span>
          </div>
          <span className="rounded-full border border-ink/10 bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">
            Merchant invoice flow
          </span>
        </header>

        {children}

        <footer className="flex flex-col gap-2 border-t border-ink/10 py-5 text-sm text-ink/45 sm:flex-row sm:items-center sm:justify-between">
          <span>PortPay · X Layer Testnet</span>
          <span>Phase 2 merchant invoices only · no buyer checkout or payment action yet.</span>
        </footer>
      </div>
    </main>
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
      {route.type === 'invoice' ? (
        <InvoiceDetailPage invoiceId={route.invoiceId} onBack={openDashboard} />
      ) : (
        <MerchantDashboard onOpenInvoice={openInvoice} />
      )}
    </AppShell>
  );
}
