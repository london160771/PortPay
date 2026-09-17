import type { Address } from 'viem';
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useSwitchChain,
} from 'wagmi';
import { erc20BalanceAbi, formatTokenBalance, parseConfiguredAddress, testnetAssets } from './config/assets';
import { portPayNetworkConfig, xLayerTestnet } from './config/network';
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
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-mint/75">Wallet connection</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">OKX Wallet · X Layer Testnet</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/60">
            Connect the injected OKX Wallet provider, then switch to chain ID 1952 if the wallet is on another network.
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
          <p className="text-sm font-semibold text-amber-100">Switch to X Layer Testnet to continue.</p>
          <p className="mt-1 text-xs text-amber-100/70">
            This wallet is connected on chain {chainId ?? 'unknown'}; PortPay reads balances only on chain 1952.
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
        <span>Explorer: OKX X Layer Testnet</span>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <TokenBalanceCard asset={testnetAssets.demoAapl} account={address} canRead={canReadBalances} />
        <TokenBalanceCard asset={testnetAssets.usdt0} account={address} canRead={canReadBalances} />
      </div>
    </section>
  );
}

export default function App() {
  return (
    <main className="min-h-screen overflow-hidden bg-cloud text-ink">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-6 sm:px-10 lg:px-12">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-ink text-lg font-bold text-mint">P</span>
            <span className="text-lg font-semibold tracking-tight">PortPay</span>
          </div>
          <span className="rounded-full border border-ink/10 bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">
            Wallet + demo assets
          </span>
        </header>

        <section className="py-16 sm:py-20">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-mint/70 px-3 py-1.5 text-sm font-semibold text-ink">
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
            Phase 1 · X Layer Testnet
          </div>
          <h1 className="max-w-4xl text-5xl font-semibold leading-[1.04] tracking-[-0.06em] sm:text-7xl">
            Connect your wallet. See your testnet portfolio.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-ink/65">
            PortPay’s wallet foundation is ready for the later payment flow. Today it connects OKX Wallet, handles the X Layer Testnet network, and reads the first demo asset alongside official testnet USD₮0.
          </p>
        </section>

        <WalletPanel />

        <section className="grid gap-4 py-8 sm:grid-cols-3">
          <div className="rounded-3xl border border-ink/10 bg-white/75 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Asset</p>
            <p className="mt-2 font-semibold">DemoAAPL</p>
            <p className="mt-1 text-sm leading-6 text-ink/55">A centrally minted test asset for X Layer Testnet demos.</p>
          </div>
          <div className="rounded-3xl border border-ink/10 bg-white/75 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Stablecoin</p>
            <p className="mt-2 font-semibold">USD₮0</p>
            <p className="mt-1 text-sm leading-6 text-ink/55">The official testnet address is verified from current OKX documentation.</p>
          </div>
          <div className="rounded-3xl border border-ink/10 bg-white/75 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Boundary</p>
            <p className="mt-2 font-semibold">Read-only Phase 1</p>
            <p className="mt-1 text-sm leading-6 text-ink/55">No invoices, checkout, settlement, or payment actions are enabled yet.</p>
          </div>
        </section>

        <footer className="flex flex-col gap-2 border-t border-ink/10 py-5 text-sm text-ink/45 sm:flex-row sm:items-center sm:justify-between">
          <span>PortPay · Testnet/demo asset foundation</span>
          <span>DemoAAPL is not an official xStock or real Apple-backed security.</span>
        </footer>
      </div>
    </main>
  );
}
