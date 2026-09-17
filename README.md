# PortPay

Spend your portfolio. Merchants get stablecoins.

PortPay is a payment-layer foundation for paying with tokenized portfolio assets while a merchant receives stablecoins on X Layer. The project starts on X Layer Testnet and keeps the testnet settlement path separate from the optional future `OKXDEXMainnetAdapter` path.

## Current project status

**Phase 0 — Foundation: implementation complete.**

The repository now contains independent frontend, backend, and Foundry contract workspaces, X Layer Testnet configuration, environment examples, database configuration scaffolding, and basic verification scripts. No contracts have been deployed, no payment flow has been implemented, and no mainnet functionality is required or configured.

Frontend and backend verification passed locally. Foundry command verification is pending a Windows-accessible Foundry runtime because the current host has no usable WSL distribution.

Phase 1+ functionality is intentionally not included yet. In particular, `DemoAAPL`, `DemoNVDA`, `PortPaySettlement`, `TestnetSettlementAdapter`, `OKXDEXMainnetAdapter`, invoices, quotes, checkout, receipts, Smart Payment History, Smart Spend, and Builder Code transaction attachment are reserved for their documented phases.

## Stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, `wagmi`, and `viem`.
- Backend: Node.js, Express, and TypeScript.
- Database: Supabase/Postgres, required for PortPay persistence. Phase 0 only scaffolds configuration; no application schema is added yet.
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
  └── Supabase/Postgres configuration boundary

Foundry workspace (contracts/)
  └── Phase 0 compile/test marker only; no deployable settlement contract yet
```

The planned data boundary keeps invoice metadata, product names, demo prices, status indexing, and searchable history offchain in Supabase/Postgres. Ownership, settlement, payment, and compact receipt events will be onchain in later phases. The testnet flow is planned as portfolio settlement / testnet simulated RWA conversion through `TestnetSettlementAdapter`; it is not an OKX DEX swap.

The adapter boundary is documented for the later phases:

- `TestnetSettlementAdapter` — future X Layer Testnet prefunded-contract path.
- `OKXDEXMainnetAdapter` — future optional X Layer Mainnet OKX DEX Swap API path.

Neither adapter is implemented in Phase 0.

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

The planned official testnet `USD₮0` address recorded in the specification is `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`. It is configuration only at this stage and must be rechecked against current official X Layer documentation before Phase 1 deployment or use. No demo asset or settlement contract address exists yet.

## Environment configuration

Copy the relevant example before running a workspace:

```powershell
Copy-Item frontend/.env.example frontend/.env
Copy-Item backend/.env.example backend/.env
```

The examples contain no secrets. Keep populated `.env` files local and never commit private keys, seed phrases, Supabase secrets, API credentials, or mainnet credentials.

Frontend variables are prefixed with `VITE_` because Vite exposes them to browser code. Backend variables remain server-side. `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` are intentionally blank in the examples until a Supabase project is selected. No Supabase client or schema migration is required for Phase 0.

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

The backend currently exposes only foundation health information. It does not create invoices, quote prices, write payments, access wallets, or persist application records yet.

### Contracts

Install [Foundry](https://book.getfoundry.sh/getting-started/installation), then run:

```powershell
cd contracts
forge fmt --check
forge build
forge test
```

The Phase 0 Solidity marker is compile/test scaffolding only. No contract deployment, faucet funding, or testnet transaction has been performed.

## Deployment structure

- `frontend/` can be built and deployed as a static Vite site. Its runtime chain and address configuration is provided through `VITE_*` variables.
- `backend/` can be built into `dist/` and deployed as an independent Node.js service. Its port, CORS, network, and Supabase/Postgres settings are server-side variables.
- `contracts/` is deployed independently through Foundry in a later phase. Deployment scripts, private keys, and broadcast artifacts are intentionally absent from Phase 0.

No workspace depends on a hidden mainnet credential or mainnet transaction.

## Phase 0 verification

Expected checks from a clean checkout:

```powershell
cd frontend; npm install; npm run lint; npm run typecheck; npm run test; npm run build
cd ../backend; npm install; npm run lint; npm run typecheck; npm run test; npm run build
cd ../contracts; forge fmt --check; forge build; forge test
```

The frontend and backend can be started independently after their own install. A manual Phase 0 smoke check is: load the frontend foundation screen, start the backend and request `/health`, then run the Foundry compile/test checks. This does not demonstrate payment or settlement; those are later-phase acceptance checks.

## Known limitations and deferred work

- No invoice creation, payment links, checkout, quote validation, settlement, receipt, or history flow exists yet.
- No `DemoAAPL` or `DemoNVDA` token has been deployed.
- `PortPaySettlement` and both adapter implementations are not present yet.
- No Supabase project, credentials, schema, migrations, or database writes are configured.
- Builder Code registration and transaction attribution are not implemented or verified.
- The public X Layer Testnet RPC may be rate limited.
- Foundry verification requires a Windows-accessible Foundry installation or an active WSL distribution; the current host has no usable WSL distribution, so the contract commands remain pending environment setup.
- The testnet `USD₮0` address is unverified for active deployment use and is not used by Phase 0 behavior.
- Demo assets, when added in later phases, must be labeled demo assets and not presented as real stock ownership or market prices.

## Source-of-truth and phase discipline

`AGENTS.md` defines repository workflow and approval gates. `PORTPAY_SPEC.md` defines the product, architecture, scope, and phased build plan. Only one named phase may be active at a time. Phase 0 is complete and no commit or push has been made.
