# PortPay

Spend your portfolio. Merchants get stablecoins.

PortPay is a payment-layer foundation for paying with tokenized portfolio assets while a merchant receives stablecoins on X Layer. The project starts on X Layer Testnet and keeps the testnet settlement path separate from the optional future `OKXDEXMainnetAdapter` path.

## Current project status

**Phase 1 — Wallet + Demo Assets: implementation complete.**

The repository now contains independent frontend, backend, and Foundry contract workspaces, an OKX Wallet connection surface with wrong-network handling, X Layer Testnet configuration, read-only asset balance support, a tested `DemoAAPL` ERC-20 test asset, and reproducible testnet deployment/minting scripts. No payment or settlement flow has been implemented, and no mainnet functionality is required or configured.

Frontend, backend, and Foundry compilation/test verification pass locally. Foundry is installed through Git for Windows Bash, which avoids requiring WSL; the managed host's optional local-signature cache warning is documented below.

Phase 2+ functionality is intentionally not included yet. In particular, `DemoNVDA`, `PortPaySettlement`, `TestnetSettlementAdapter`, `OKXDEXMainnetAdapter`, invoices, quotes, checkout, receipts, Smart Payment History, Smart Spend, and Builder Code transaction attachment are reserved for their documented phases.

## Stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, `wagmi`, and `viem`.
- Backend: Node.js, Express, and TypeScript.
- Database: Supabase/Postgres, required for PortPay persistence. Phase 1 keeps the configuration boundary scaffolded; no application schema is added yet.
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
  ├── DemoAAPL ordinary test ERC-20
  └── X Layer Testnet deployment/minting scripts
```

The planned data boundary keeps invoice metadata, product names, demo prices, status indexing, and searchable history offchain in Supabase/Postgres. Ownership, settlement, payment, and compact receipt events will be onchain in later phases. The testnet flow is planned as portfolio settlement / testnet simulated RWA conversion through `TestnetSettlementAdapter`; it is not an OKX DEX swap.

The adapter boundary is documented for the later phases:

- `TestnetSettlementAdapter` — future X Layer Testnet prefunded-contract path.
- `OKXDEXMainnetAdapter` — future optional X Layer Mainnet OKX DEX Swap API path.

Neither adapter is implemented in Phase 1. Settlement remains a Phase 3 concern.

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

Frontend variables are prefixed with `VITE_` because Vite exposes them to browser code. Backend variables remain server-side. `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` are intentionally blank in the examples until a Supabase project is selected. No Supabase client or schema migration is required for this phase.

For contracts, copy `contracts/.env.example` to `contracts/.env` only when using the deployment or minting scripts. Keep `PRIVATE_KEY` populated only in that local untracked file. The frontend and backend examples contain the verified testnet USD₮0 address; `DemoAAPL` remains blank until a testnet deployment is made.

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

With OKX Wallet installed and unlocked, click **Connect OKX Wallet**, approve the connection, and use **Switch to X Layer Testnet** if the wallet is on another chain. Once a `DemoAAPL` address is configured, the page reads both `DemoAAPL` and testnet `USD₮0` balances from their contracts. This is read-only wallet/balance functionality; payment actions are not enabled.

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

## Phase 1 verification

Expected checks from a clean checkout:

```powershell
cd frontend; npm install; npm run lint; npm run typecheck; npm run test; npm run build
cd ../backend; npm install; npm run lint; npm run typecheck; npm run test; npm run build
cd ../contracts; forge fmt --check; forge build --use .tools/solc-0.8.24.exe; forge test --use .tools/solc-0.8.24.exe
```

The frontend and backend can be started independently after their own install. A Phase 1 smoke check is: load the frontend, connect OKX Wallet on X Layer Testnet or exercise the wrong-network switch prompt, verify the read-only balance cards, start the backend and request `/health`, then run the Foundry compile/test checks. This does not demonstrate payment or settlement; those are later-phase acceptance checks.

## Known limitations and deferred work

- No invoice creation, payment links, checkout, quote validation, settlement, receipt, or history flow exists yet.
- `DemoAAPL` has not been deployed to X Layer Testnet yet, so its frontend address is intentionally blank until a wallet and test OKB are available.
- `DemoNVDA`, `PortPaySettlement`, and both adapter implementations are not present yet.
- No Supabase project, credentials, schema, migrations, or database writes are configured.
- Builder Code registration and transaction attribution are not implemented or verified.
- The public X Layer Testnet RPC may be rate limited.
- The public X Layer Testnet RPC may be rate limited, and wallet connection/balance reads require an installed OKX Wallet browser extension and a connected account.
- A deployed `DemoAAPL` address and minted balance require the user’s own burner wallet, test OKB, and explicit local deployment commands; none are committed or assumed.
- `DemoAAPL` is a centrally minted test asset for demos and is not an official xStock or backed by Apple shares.
- The official USD₮0 address is verified from current OKX documentation, but no settlement contract is funded or used in this phase.

## Source-of-truth and phase discipline

`AGENTS.md` defines repository workflow and approval gates. `PORTPAY_SPEC.md` defines the product, architecture, scope, and phased build plan. Only one named phase may be active at a time. Phase 1 is complete, Phase 2 has not started, and no commit or push has been made.
