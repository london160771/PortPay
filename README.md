# PortPay

Spend your portfolio. Merchants get stablecoins.

PortPay is a payment-layer foundation for paying with tokenized portfolio assets while a merchant receives stablecoins on X Layer. The project starts on X Layer Testnet and keeps the testnet settlement path separate from the optional future `OKXDEXMainnetAdapter` path.

## Current project status

**Phase 3 — Core Settlement: implementation and first live X Layer Testnet proof complete. Phase 4 has not started.**

The repository now contains independent frontend, backend, and Foundry contract workspaces, an OKX Wallet-aware merchant dashboard, Supabase/Postgres-backed invoice persistence, unique shareable invoice links, a DemoAAPL buyer checkout, signed short-lived settlement quotes, the `PortPaySettlement` contract, and verified-event invoice reconciliation. No mainnet functionality is required or configured.

Frontend, backend, and Foundry verification pass locally. Foundry was run from the repository's bundled Windows release in the ignored `contracts/.tools/foundry` directory, so WSL is not required.

`DemoNVDA`, Smart Spend, Builder Code transaction attachment, and `OKXDEXMainnetAdapter` remain deferred. The Phase 3 proof used Supabase/Postgres, a dedicated quote signer, funded testnet contracts, test OKB, and separate buyer/merchant wallets.

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
  ├── Supabase/Postgres invoice repository
  ├── `TestnetSettlementAdapter` quote signing
  └── canonical, confirmed settlement-event reconciliation

Foundry workspace (contracts/)
  ├── DemoAAPL ordinary test ERC-20
  ├── PortPaySettlement minimal testnet settlement contract
  └── X Layer Testnet deployment, minting, and funding scripts
```

Invoice metadata, product names, payment-link records, and indexed settlement evidence are persisted offchain in Supabase/Postgres. Ownership, settlement, payment, and the compact `SettlementExecuted` receipt event are onchain. The testnet flow is portfolio settlement / testnet simulated RWA conversion through `TestnetSettlementAdapter`; it is not an OKX DEX swap.

The adapter boundary is documented for the later phases:

- `TestnetSettlementAdapter` — implemented for signed quotes and canonical, confirmed-event reconciliation on X Layer Testnet.
- `OKXDEXMainnetAdapter` — future optional X Layer Mainnet OKX DEX Swap API path.

The mainnet adapter is not implemented. Settlement remains testnet-only in the current phase.

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

The official X Layer Testnet `USD₮0` address is `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`. It was re-verified on 2026-09-18 against the current [official OKX payment documentation](https://web3.okx.com/es-es/onchainos/dev-docs/payments/service-seller-reverseproxy), which identifies the same token on chain `1952`. A read-only call to the official testnet RPC returned chain ID `0x7a0` (`1952`), nonempty code at that address, and `decimals()` of `6`.

### Live Phase 3 testnet proof

The first real proof was completed on 2026-09-20 for invoice `1250b0c6-9616-4983-a850-4f3aa08bbf15` (`PortPay Phase 3 live test`): buyer `0xbabdfef588cf57efcc7c8857960e3ccdd9167589` spent `0.004 DemoAAPL` and merchant `0x815c2fb8178f0bf80ada8c5b97ff44ece90e6e25` received exactly `1 USD₮0`.

| Live item | Verified value |
| --- | --- |
| Chain | X Layer Testnet, `1952` |
| DemoAAPL | `0x756546fce7d7ca3bb4be127904b002baf13b432e` |
| PortPaySettlement | `0xc0b34a6e0858815e7e176a0bcf15f223b1154a04` |
| Official USD₮0 | `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` |
| Buyer approval transaction | [`0xb19bbead21f9eb33cace94dea13edb0d32d7514599086f15661734e19e5574cf`](https://www.okx.com/web3/explorer/xlayer-test/tx/0xb19bbead21f9eb33cace94dea13edb0d32d7514599086f15661734e19e5574cf) |
| Settlement transaction | [`0x452381c8774aae0f277688aa8a3e640a57e29726d45644dcfb64894854ba66be`](https://www.okx.com/web3/explorer/xlayer-test/tx/0x452381c8774aae0f277688aa8a3e640a57e29726d45644dcfb64894854ba66be) |
| Settlement block | `41464046` |
| Settlement evidence | One matching `SettlementExecuted` event; canonical receipt block; `660` observed confirmations, `2` required |
| Invoice result | Supabase status `pending` → `paid`; exact `1 USD₮0` received |

The approval transaction encoded the exact quoted allowance of `4000000000000000` DemoAAPL base units. Historical RPC balance reads at the settlement block showed the buyer moving from `1.000` to `0.996 DemoAAPL` and the merchant moving from `0` to `1 USD₮0`. No secrets or private keys are documented here.

## Environment configuration

Copy the relevant example before running a workspace:

```powershell
Copy-Item frontend/.env.example frontend/.env
Copy-Item backend/.env.example backend/.env
```

The examples contain no secrets. Keep populated `.env` files local and never commit private keys, seed phrases, Supabase secrets, API credentials, or mainnet credentials.

Frontend variables are prefixed with `VITE_` because Vite exposes them to browser code. Backend variables remain server-side. `VITE_BACKEND_URL`, `PUBLIC_APP_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` must be configured for a live invoice demo. `DATABASE_URL` is retained for Supabase/Postgres migration tooling. Do not expose the service-role key to the frontend.

The Phase 3 backend also requires `QUOTE_SIGNER_PRIVATE_KEY`, `DEMO_AAPL_REFERENCE_PRICE_USD` (default `250.00` demo USD), and `QUOTE_TTL_SECONDS` (default `300`, allowed range `1`–`300`). The quote signer address must match `QUOTE_SIGNER_ADDRESS` used when deploying `PortPaySettlement`. The private key is server-only and must never be placed in the frontend environment.

For contracts, copy `contracts/.env.example` to `contracts/.env` only when using the deployment or minting scripts. Keep `PRIVATE_KEY` populated only in that local untracked file. The frontend and backend examples contain the verified testnet USD₮0 address; `DemoAAPL` remains blank until a testnet deployment is made.

### Supabase/Postgres setup

Create or select a Supabase project, then apply these migrations in order through the Supabase SQL editor or the Supabase CLI migration workflow:

1. [`backend/supabase/migrations/20260917000000_create_invoices.sql`](backend/supabase/migrations/20260917000000_create_invoices.sql)
2. [`backend/supabase/migrations/20260917000001_add_settlement_evidence.sql`](backend/supabase/migrations/20260917000001_add_settlement_evidence.sql)

The first migration creates `public.invoices`; the second adds confirmed settlement evidence fields and unique transaction/quote indexes. Both keep row-level security enabled. PortPay uses the server-only `SUPABASE_SERVICE_ROLE_KEY`; no browser Supabase client is used. Do not rely on live settlement until both migrations are applied and the backend is configured with database access.

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

After creating an invoice, use **Copy link** to share `/invoice/<uuid>`. Opening that URL in another tab loads the buyer checkout. On X Layer Testnet, the buyer connects OKX Wallet, reviews the exact DemoAAPL/USD₮0 quote, approves only the quoted DemoAAPL amount, confirms settlement, and waits for the backend to verify the `SettlementExecuted` event. The merchant invoice becomes paid only after that evidence is reconciled.

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

The backend exposes the health route, Phase 2 invoice API, and Phase 3 settlement API:

- `POST /api/invoices` with `{ "title", "amountUsdt0", "merchantAddress" }` creates a pending invoice.
- `GET /api/invoices?merchantAddress=<wallet>` lists invoices for the connected merchant wallet.
- `GET /api/invoices/<uuid>` resolves the shareable invoice link target.
- `POST /api/invoices/<uuid>/quote` issues a short-lived EIP-712 quote bound to the invoice, buyer, merchant, assets, exact amounts, chain, settlement contract, and expiry.
- `POST /api/invoices/<uuid>/reconcile` checks the canonical receipt block and configured confirmation depth, verifies the structured settlement event, and changes the invoice to `paid`.

The API validates titles, positive USD₮0 amounts with up to 6 decimals, EVM wallet addresses, UUIDs, and transaction hashes. It returns a clear unavailable response when Supabase/Postgres or the quote signer/contract configuration is not ready. It never marks an invoice paid from client input alone; the reconciliation endpoint requires a successful X Layer Testnet receipt sent to the configured settlement contract with one matching `SettlementExecuted` event.

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

The `DemoAAPL` and `PortPaySettlement` contracts and their tests are in `contracts/src/` and `contracts/test/`. Use a local untracked `contracts/.env` for the testnet workflow:

```powershell
cd contracts
Copy-Item .env.example .env
# fill PRIVATE_KEY, then deploy DemoAAPL and set DEMO_AAPL_ADDRESS
& .\.tools\foundry\forge.exe script script/DeployDemoAAPL.s.sol:DeployDemoAAPL --rpc-url xlayer_testnet --broadcast
& .\.tools\foundry\forge.exe script script/MintDemoAAPL.s.sol:MintDemoAAPL --rpc-url xlayer_testnet --broadcast
# fill QUOTE_SIGNER_ADDRESS, TESTNET_USDT0_ADDRESS, and DEMO_AAPL_ADDRESS
& .\.tools\foundry\forge.exe script script/DeployPortPaySettlement.s.sol:DeployPortPaySettlement --rpc-url xlayer_testnet --broadcast
# set PORTPAY_SETTLEMENT_ADDRESS, then fund it with test USD₮0
& .\.tools\foundry\forge.exe script script/FundPortPaySettlement.s.sol:FundPortPaySettlement --rpc-url xlayer_testnet --broadcast
```

Run `forge` directly if it is installed on PATH. These scripts reject non-1952 deployments and are testnet-only. The live proof above was performed on X Layer Testnet only; no mainnet deployment or transaction has been performed.

## Deployment structure

- `frontend/` can be built and deployed as a static Vite site. Its runtime chain and address configuration is provided through `VITE_*` variables.
- `backend/` can be built into `dist/` and deployed as an independent Node.js service. Its port, CORS, network, and Supabase/Postgres settings are server-side variables.
- `contracts/` is deployed independently through Foundry. `DemoAAPL`, `PortPaySettlement`, and settlement funding scripts target X Layer Testnet only; private keys and broadcast artifacts remain local and untracked.

No workspace depends on a hidden mainnet credential or mainnet transaction.

## Phase 3 verification

Expected checks from a clean checkout:

```powershell
cd frontend; npm install; npm run lint; npm run typecheck; npm run test; npm run build
cd ../backend; npm install; npm run lint; npm run typecheck; npm run test; npm run build
cd ../contracts; forge fmt --check; forge build --no-cache --use .tools/solc-0.8.24.exe; forge test --use .tools/solc-0.8.24.exe
```

The frontend and backend can be started independently after their own install and Supabase configuration. A Phase 3 smoke check is: apply both migrations, configure the backend quote signer and deployed addresses, start the backend/frontend, create a small invoice such as `20.00 USD₮0`, open the link in a second tab, connect a funded buyer wallet, verify the quote displays `0.08 DemoAAPL` for `20 USD₮0`, approve exactly that amount (or use an existing sufficient allowance), confirm settlement, wait for invoice reconciliation, and verify the merchant record is `paid` with the transaction link. Invalid, missing, wrong-network, rejected-signature, insufficient-balance, failed-transaction, and duplicate-payment states should remain explicit. A submitted payment hash must be checked and reconciled before retrying a payment.

Before broadcasting, compare the deployed `quoteSigner`, `demoAsset`, and `stablecoin` getters against the backend signer, DemoAAPL address, and official testnet USD₮0 address. The deployment script requires the official USD₮0 address; the funding script checks that the target settlement contract reports the same stablecoin. The backend rejects a non-1952 RPC, filters receipt events to the configured settlement contract, binds the receipt sender to the buyer, and requires a canonical receipt block with two confirmations by default (`SETTLEMENT_CONFIRMATION_DEPTH`). Reconciliation uses the contract-verified asset amount in the event, so changing the demo reference price after signing cannot strand a successful payment. The contract checks the buyer's exact asset debit, its exact asset receipt, and the merchant's exact stablecoin receipt; fee-on-transfer tokens revert the entire settlement.

## Known limitations and deferred work

- Live Supabase/Postgres credentials and both Phase 2/3 migrations are required for any reproduction; the recorded proof used the applied migrations and live persistence.
- The recorded deployment addresses and payment evidence are for X Layer Testnet only. Deployment transaction hashes were not retained in the committed workspace; the deployed addresses and settlement configuration were verified through the live contract and receipt.
- A quote signer private key is required server-side; it must correspond to the signer configured in the deployed settlement contract. Whoever controls that key can authorize spending the contract's prefunded USD₮0 balance through valid quotes, so use a dedicated restricted demo key and protect it as a settlement authority. Changing the signer requires a new settlement deployment.
- DemoAAPL quote math uses the explicit `250.00 USD` reference price and rejects conversions that would silently round. This is a demo value, not market data or an oracle.
- Settlement liquidity must be funded manually with official testnet USD₮0 before a buyer can pay again.
- The merchant wallet address is supplied by the connected frontend wallet but is not cryptographically authenticated by the Phase 2 API; authentication/authorization is deferred.
- The Supabase migration enables row-level security and the backend uses the server-only service-role key. No browser client or direct anon-key database access is enabled.
- Builder Code registration and transaction attribution are not implemented or verified.
- The public X Layer Testnet RPC may be rate limited, and wallet connection/balance reads require an installed OKX Wallet browser extension and a connected account.
- Receipt reconciliation requires a canonical receipt block and two confirmations by default; this is a small testnet safety check, not a claim of protocol finality.
- A deployed `DemoAAPL` address and minted balance require a burner wallet, test OKB, and explicit local deployment commands when reproducing the proof.
- `DemoAAPL` is a centrally minted test asset for demos and is not an official xStock or backed by Apple shares.
- The official USD₮0 address and six-decimal metadata are verified from the current docs and a read-only testnet RPC call.

## Source-of-truth and phase discipline

`AGENTS.md` defines repository workflow and approval gates. `PORTPAY_SPEC.md` defines the product, architecture, scope, and phased build plan. Only one named phase may be active at a time. Phase 3 implementation and the first live testnet proof are complete, no Phase 4 work has started, and GPT-5.6 Sol High Checkpoint A is complete.
