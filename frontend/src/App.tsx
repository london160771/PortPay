import { xLayerTestnet } from './config/network';

const foundationAreas = [
  {
    label: 'Client boundary',
    value: 'React + Vite + TypeScript',
    detail: 'Ready for wallet-aware payment screens in later phases.',
  },
  {
    label: 'Network boundary',
    value: 'X Layer Testnet · 1952',
    detail: 'OKB is the configured testnet gas token.',
  },
  {
    label: 'Data boundary',
    value: 'Supabase / Postgres',
    detail: 'Configuration is scaffolded; application schema comes later.',
  },
];

export default function App() {
  return (
    <main className="min-h-screen overflow-hidden bg-cloud text-ink">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-6 sm:px-10 lg:px-12">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-ink text-lg font-bold text-mint">
              P
            </span>
            <span className="text-lg font-semibold tracking-tight">PortPay</span>
          </div>
          <span className="rounded-full border border-ink/10 bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">
            Foundation preview
          </span>
        </header>

        <section className="grid flex-1 items-center gap-12 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-mint/70 px-3 py-1.5 text-sm font-semibold text-ink">
              <span className="h-2 w-2 rounded-full bg-emerald-600" />
              X Layer Testnet connected by configuration
            </div>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[1.04] tracking-[-0.06em] sm:text-7xl">
              Spend your portfolio. Merchants get stablecoins.
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-ink/65">
              PortPay is building a simpler payment layer for tokenized assets. This screen is the Phase 0 foundation: the independent client, network setup, and data boundary are ready for the documented payment flow.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <span className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white">
                Phase 0 · Foundation
              </span>
              <span className="rounded-full border border-ink/15 bg-white px-5 py-3 text-sm font-semibold text-ink/70">
                {xLayerTestnet.name}
              </span>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-8 rounded-[3rem] bg-mint/50 blur-3xl" />
            <div className="relative rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-soft backdrop-blur sm:p-8">
              <div className="flex items-start justify-between border-b border-ink/10 pb-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/45">System status</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight">Ready for the next layer</h2>
                </div>
                <span className="rounded-full bg-mint px-3 py-1 text-xs font-bold text-ink">ONLINE</span>
              </div>
              <div className="space-y-5 pt-6">
                {foundationAreas.map((area) => (
                  <div key={area.label} className="flex gap-4">
                    <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink text-xs font-bold text-mint">
                      ✓
                    </span>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">{area.label}</p>
                      <p className="mt-1 font-semibold">{area.value}</p>
                      <p className="mt-1 text-sm leading-6 text-ink/55">{area.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-7 rounded-2xl bg-ink p-5 text-white">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-mint/75">Next planned milestone</p>
                <p className="mt-2 text-lg font-semibold">DemoAAPL + settlement foundation</p>
                <p className="mt-1 text-sm leading-6 text-white/60">Phase 1 starts only after approval of this foundation.</p>
              </div>
            </div>
          </div>
        </section>

        <footer className="flex flex-col gap-2 border-t border-ink/10 py-5 text-sm text-ink/45 sm:flex-row sm:items-center sm:justify-between">
          <span>PortPay · Testnet/demo foundation</span>
          <span>Wallet connection and payments are not enabled in Phase 0.</span>
        </footer>
      </div>
    </main>
  );
}
