# PortPay

Spend your portfolio. Merchants get stablecoins.

PortPay is a payment-layer foundation for paying with tokenized portfolio assets while a merchant receives stablecoins on X Layer. The project starts on X Layer Testnet and keeps the testnet settlement path separate from the optional future `OKXDEXMainnetAdapter` path.

## Current project status

**Phase 2 — Merchant Invoice Flow: implementation complete.**

The repository now contains independent frontend, backend, and Foundry contract workspaces, an OKX Wallet-aware merchant dashboard, Supabase/Postgres-backed invoice persistence, unique shareable invoice links, pending/paid status display, and the earlier X Layer Testnet asset foundation. No buyer checkout, payment, or settlement flow has been implemented, and no mainnet functionality is required or configured.

Frontend and backend verification pass locally. Foundry remains installed through Git for Windows Bash, which avoids requiring WSL; its managed-host optional local-signature cache warning is documented below.

The remaining buyer checkout slice of Phase 2 and all later phases are intentionally not included yet. In particular, checkout, `DemoNVDA`, `PortPaySettlement`, `TestnetSettlementAdapter`, `OKXDEXMainnetAdapter`, quotes, receipts, Smart Payment History, Smart Spend, and Builder Code transaction attachment remain deferred.

## Stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, `wagmi`, and `viem`.
- Backend: Node.js, Express, and TypeScript.
- Database: Supabase/Postgres, required for PortPay persistence. Phase 2 adds the reproducible invoice migration and server-side repository boundary.
- Contracts: Solidity and Foundry.
- Network: X Layer Testnet, chain ID `1952`, native gas token `OKB`.
- Primary wallet: OKX Wallet through the injected EVM wallet connector.
- Package manager: npm.

SQLite is not used or supported as the PortPay database implementation.

## Repository layout

```text
PortPay/
├── frontend/       React/Vite client; deployable independently
├── backend/        Express API; deployable independently
├── contracts/      Foundry/Solidity workspace
├── AGENTS.md       Repository workflow authority
├── PORTPAY_SPEC.md Product and technical source of truth
└── README.md       Setup, architecture, and project status
```

The frontend and backend have separate `package.json` files, lockfiles, environment examples, TypeScript configurations, build output, and deployment boundaries. There is no root npm workspace that couples their installs.

## Architecture overview

```text
React client (frontend/)
  ├── X Layer Testnet chain definition
  ├── wagmi/viem configuration
  └── OKX Wallet injected connector

Express API (backend/)
  ├── health/readiness foundation
  ├── X Layer Testnet and address configuration
  ├── merchant invoice API and validation
  └── Supabase/Postgres invoice repository

Foundry workspace (contracts/)
  ├── DemoAAPL ordinary test ERC-20
  └── X Layer Testnet deployment/minting scripts
```

Invoice metadata, product names, payment-link records, and invoice status are persisted offchain in Supabase/Postgres. Ownership, settlement, payment, and compact receipt events will be onchain in later phases. The testnet flow is planned as portfolio settlement / testnet simulated RWA conversion through `TestnetSettlementAdapter`; it is not an OKX DEX swap.

The adapter boundary is documented for the later phases:

- `TestnetSettlementAdapter` — future X Layer Testnet prefunded-contract path.
- `OKXDEXMainnetAdapter` — future optional X Layer Mainnet OKX DEX Swap API path.

Neither adapter is implemented in Phase 2. Settlement remains a Phase 3 concern.

## X Layer Testnet configuration

The canonical network values are centralized in the frontend and backend config modules and mirrored in the Foundry RPC profile:

| Setting | Value |
| --- | --- |
| Network | X Layer Testnet |
| Chain ID | `1952` |
| Native gas token | `OKB` |
| Default RPC | `https://testrpc.xlayer.tech/terigon` |
| Alternate RPC | `https://xlayertestrpc.okx.com/terigon` |
| Explorer | `https://www.okx.com/web3/explorer/xlayer-test` |

These public RPC defaults come from the [official X Layer network information](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/network-information) and can be overridden with environment variables. Public RPC rate limits may apply.

The official X Layer Testnet `USD₮0` address is `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`. It was verified on 2026-09-17 against the current [official OKX payment documentation](https://web3.okx.com/pl/onchainos/dev-docs/payments/payment-use-buyer), which identifies the same token on `eip155:1952`. No settlement contract or `DemoAAPL` deployment address has been recorded yet.

## Environment configuration

Copy the relevant example before running a workspace:

```powershell
Copy-Item frontend/.env.example frontend/.env
Copy-Item backend/.env.example backend/.env
```

The examples contain no secrets. Keep populated `.env` files local and never commit private keys, seed phrases, Supabase secrets, API credentials, or mainnet credentials.

Frontend variables are prefixed with `VITE_` because Vite exposes them to browser code. Backend variables remain server-side. `VITE_BACKEND_URL`, `PUBLIC_APP_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` must be configured for a live invoice demo. `DATABASE_URL` is retained for Supabase/Postgres migration tooling. Do not expose the service-role key to the frontend.

For contracts, copy `contracts/.env.example` to `contracts/.env` only when using the deployment or minting scripts. Keep `PRIVATE_KEY` populated only in that local untracked file. The frontend and backend examples contain the verified testnet USD₮0 address; `DemoAAPL` remains blank until a testnet deployment is made.

### Supabase/Postgres setup

Create or select a Supabase project, then apply [`backend/supabase/migrations/20260917000000_create_invoices.sql`](backend/supabase/migrations/20260917000000_create_invoices.sql) through the Supabase SQL editor or the Supabase CLI migration workflow. The migration creates the `public.invoices` table, validates title/amount/wallet/status fields, indexes invoices by merchant wallet, and enables row-level security. Phase 2 uses the server-only `SUPABASE_SERVICE_ROLE_KEY`; no browser Supabase client is used.

Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_APP_URL`, and `CORS_ORIGIN` in `backend/.env`. Keep `PUBLIC_APP_URL` equal to the independently deployed frontend origin so generated `/invoice/<uuid>` links open in the right app.

## Local run instructions

### Frontend

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Open `http://localhost:5173`. For a production-style local check:

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
npm run start
```

`npm run start` serves the Vite preview and expects the preceding build output.

With OKX Wallet installed and unlocked, click **Connect OKX Wallet**, approve the connection, and use **Switch to X Layer Testnet** if the wallet is on another chain. The merchant dashboard enables invoice creation only when the connected wallet is on chain 1952. It loads that wallet's persisted invoices from the backend and keeps the Phase 1 read-only DemoAAPL/USD₮0 balance cards available.

After creating an invoice, use **Copy link** to share `/invoice/<uuid>`. Opening that URL in another tab loads the public invoice detail/waiting screen. It does not connect a buyer wallet or perform payment in this phase.

### Backend

In a separate terminal:

```powershell
cd backend
npm install
Copy-Item .env.example .env
npm run dev
```

The health endpoint is available at `http://localhost:3001/health`. For a production-style local check:

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
npm run start
```

The backend exposes the health route and the Phase 2 invoice API:

- `POST /api/invoices` with `{ "title", "amountUsdt0", "merchantAddress" }` creates a pending invoice.
- `GET /api/invoices?merchantAddress=<wallet>` lists invoices for the connected merchant wallet.
- `GET /api/invoices/<uuid>` resolves the shareable invoice link target.

The API validates titles, positive USD₮0 amounts with up to 6 decimals, EVM wallet addresses, and UUIDs. It returns a clear unavailable response when Supabase/Postgres is not configured. It does not create quotes, accept payments, or change an invoice to paid; paid status is reserved for later confirmed payment processing.

### Contracts

On Windows, use Git for Windows Bash and the official [Foundry installation](https://book.getfoundry.sh/getting-started/installation) instead of requiring WSL:

```bash
curl -L https://foundry.paradigm.xyz | bash
export PATH="$PATH:$HOME/.foundry/bin"
foundryup

cd contracts
forge fmt --check
forge build --use .tools/solc-0.8.24.exe
forge test --use .tools/solc-0.8.24.exe
```

If the managed Windows host needs the pinned compiler fallback, download the official Solidity 0.8.24 Windows binary once from PowerShell while inside `contracts/`:

```powershell
New-Item -ItemType Directory -Force .tools
Invoke-WebRequest -Uri https://github.com/ethereum/solidity/releases/download/v0.8.24/solc-windows.exe -OutFile .tools/solc-0.8.24.exe
```

The managed Codex Windows host can compile the contracts and run the tests with the pinned compiler, but its restricted sandbox identity does not expose a Windows profile to Foundry's optional global local-signature cache. On that host, `forge build` may exit after successful compilation with a cache-directory warning; `forge test --use .tools/solc-0.8.24.exe` is the passing verification command. A normal Windows user profile can use the standard `forge build` command after Foundry setup.

The `DemoAAPL` contract and its tests are in `contracts/src/` and `contracts/test/`. No contract deployment, faucet funding, or testnet transaction has been performed.

## Deployment structure

- `frontend/` can be built and deployed as a static Vite site. Its runtime chain and address configuration is provided through `VITE_*` variables.
- `backend/` can be built into `dist/` and deployed as an independent Node.js service. Its port, CORS, network, and Supabase/Postgres settings are server-side variables.
- `contracts/` is deployed independently through Foundry. `DemoAAPL` deployment and minting scripts are prepared for X Layer Testnet only; private keys and broadcast artifacts remain local and untracked.

No workspace depends on a hidden mainnet credential or mainnet transaction.

## Phase 2 verification

Expected checks from a clean checkout:

```powershell
cd frontend; npm install; npm run lint; npm run typecheck; npm run test; npm run build
cd ../backend; npm install; npm run lint; npm run typecheck; npm run test; npm run build
cd ../contracts; forge fmt --check; forge build --use .tools/solc-0.8.24.exe; forge test --use .tools/solc-0.8.24.exe
```

The frontend and backend can be started independently after their own install and Supabase configuration. A Phase 2 smoke check is: load the frontend, connect the merchant OKX Wallet on X Layer Testnet, create an invoice such as `20.00 USD₮0`, copy the generated link, open it in a separate tab, confirm the title/amount/merchant/status, restart the backend, reload the dashboard, and confirm the invoice remains present. Invalid or missing invoice IDs should show the invoice-link error state. This does not demonstrate buyer checkout, payment, or settlement; those are deferred.

## Known limitations and deferred work

- Buyer checkout, quote validation, settlement, receipt, or history flow does not exist yet.
- Invoice creation and link resolution require a configured Supabase project and server-side service-role key; without them the API intentionally returns a storage-not-configured response rather than using a non-durable fallback.
- `DemoAAPL` has not been deployed to X Layer Testnet yet, so its frontend address is intentionally blank until a wallet and test OKB are available.
- `DemoNVDA`, `PortPaySettlement`, and both adapter implementations are not present yet.
- The merchant wallet address is supplied by the connected frontend wallet but is not cryptographically authenticated by the Phase 2 API; authentication/authorization is deferred.
- The Supabase migration enables row-level security and the backend uses the server-only service-role key. No browser client or direct anon-key database access is enabled.
- Builder Code registration and transaction attribution are not implemented or verified.
- The public X Layer Testnet RPC may be rate limited.
- The public X Layer Testnet RPC may be rate limited, and wallet connection/balance reads require an installed OKX Wallet browser extension and a connected account.
- A deployed `DemoAAPL` address and minted balance require the user’s own burner wallet, test OKB, and explicit local deployment commands; none are committed or assumed.
- `DemoAAPL` is a centrally minted test asset for demos and is not an official xStock or backed by Apple shares.
- The official USD₮0 address is verified from current OKX documentation, but no settlement contract is funded or used in this phase.

## Source-of-truth and phase discipline

`AGENTS.md` defines repository workflow and approval gates. `PORTPAY_SPEC.md` defines the product, architecture, scope, and phased build plan. Only one named phase may be active at a time. The Phase 2 Merchant Invoice Flow slice is complete, the follow-on buyer checkout slice remains unstarted, Phase 3 has not started, and no commit or push has been made.
