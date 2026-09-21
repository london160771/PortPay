# PortPay

Spend your portfolio. Merchants get stablecoins.

PortPay lets customers spend tokenized stock holdings while merchants receive stablecoins. Businesses request payment in stablecoins, customers choose an xStock-style portfolio asset, PortPay handles the payment flow, and both sides receive an onchain-verifiable receipt.

The core message is simple: **PortPay turns tokenized portfolios into a payment method. Customers spend the assets they already hold. Merchants keep pricing and receiving payments in stablecoins.**

## Current project status

**Mainnet Phase 1 preparation: role-separated merchant/buyer views, nested documentation, authenticated merchant integration, the existing testnet payment proof, and an isolated read-only `OKXDEXMainnetAdapter` are in place. Mainnet execution remains disabled; no mainnet test is approved or required.**

The repository now contains independent frontend, backend, and Foundry contract workspaces, an OKX Wallet-aware merchant dashboard, Supabase/Postgres-backed invoice persistence, unique shareable invoice links, a buyer checkout for DemoAAPL and DemoNVDA, signed short-lived multi-asset settlement quotes, the two-asset `PortPaySettlement` contract, verified-event invoice reconciliation, transaction-backed payment receipts, paid-only Smart Payment History for buyer and merchant views, deterministic Smart Spend recommendations, and a server-side read-only chain-196 OKX V6 preparation path. No mainnet transaction execution is enabled.

Frontend and backend verification pass locally. The pinned Windows Foundry release remains in the ignored `contracts/.tools/foundry` directory, so WSL is not required by the project; this UX/integration pass made no contract changes and did not send transactions.

PortPay now prepares ERC-8021 Builder Code suffixes for eligible browser-wallet approval and settlement transactions and checks registry registration and payout before requesting a wallet signature. The configured testnet code is registered and was verified on a real attributed testnet payment. `OKXDEXMainnetAdapter` is implemented only as an isolated read-only preparation layer. The Phase 3 proof used Supabase/Postgres, a dedicated quote signer, funded testnet contracts, test OKB, and separate buyer/merchant wallets. Phase 5 added and deployed DemoNVDA plus the two-asset settlement contract; the Phase 6 live proof used DemoAAPL.

The pre-mainnet readiness pass keeps that working flow compact and judge-friendly: merchant and buyer routes are visibly separate, each role receives role-specific receipt wording, buyer checkout leads with the amount due and exact quote, Smart Spend remains buyer-only and deterministic, and merchant integration sits above the existing invoice/reconciliation layer. Testnet and demo-asset disclosures remain visible throughout. The mainnet adapter is isolated, preparation-only, and does not change settlement, contracts, or the proven testnet Builder Code flow.

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
  ├── authenticated merchant integration API and signed payment notifications
  ├── Supabase/Postgres invoice repository
  ├── `TestnetSettlementAdapter` quote signing
  ├── isolated `OKXDEXMainnetAdapter` read-only quote/transaction preparation
  ├── server-side authenticated OKX V6 DEX API client
  ├── deterministic Smart Spend allocation and target rules
  ├── canonical, confirmed settlement-event reconciliation
  └── paid-only receipt and Smart Payment History queries

Foundry workspace (contracts/)
  ├── DemoAAPL ordinary test ERC-20
  ├── PortPaySettlement minimal testnet settlement contract
  └── X Layer Testnet deployment, minting, and funding scripts
```

Invoice metadata, product names, payment-link records, and indexed settlement evidence are persisted offchain in Supabase/Postgres. Ownership, settlement, payment, and the compact `SettlementExecuted` receipt event are onchain. The testnet flow is portfolio settlement / testnet simulated RWA conversion through `TestnetSettlementAdapter`; it is not an OKX DEX swap.

The product routes are intentionally role-separated:

- `/merchant` — merchant dashboard and invoice list.
- `/merchant/invoices/:invoiceId` — merchant status, copyable buyer link, and merchant receipt.
- `/pay/:invoiceId` — hosted buyer checkout, wallet actions, Smart Spend, and buyer receipt.
- `/docs`, `/docs/getting-started`, `/docs/how-it-works`, `/docs/merchant-integration`, `/docs/testnet` — judge and business documentation.

The merchant API is also role-separated from the browser: server-side merchant credentials create invoices and retrieve verified status, while the hosted `/pay/:invoiceId` page owns wallet/payment behavior.

The adapter boundary is documented for the later phases:

- `TestnetSettlementAdapter` — implemented for signed quotes and canonical, confirmed-event reconciliation on X Layer Testnet.
- `OKXDEXMainnetAdapter` — isolated X Layer Mainnet OKX V6 read-only preparation path; broadcasting is disabled.

The mainnet adapter does not broadcast, approve, deploy, or send swaps. Settlement remains testnet-only until a separately approved live mainnet phase.

## X Layer Mainnet preparation (read-only)

Mainnet preparation is isolated from the proven testnet flow:

```text
chain 196 → OKXDEXMainnetAdapter → wNVDAx / wAAPLx → USD₮0 directly to the merchant
```

The server-side adapter uses the authenticated OKX V6 DEX API at its pinned official origin for quotes, exact approval calldata, and swap transaction preparation. It validates chain `196`, independently verified xStock and USD₮0 addresses, decoded invoice merchant recipient, decoded tokens and amounts, quote freshness, minimum receive amount, router, spender, and exact approval amount. Unsupported router call shapes fail closed. It has no active broadcast method.

Current mainnet addresses:

| Asset | Address | Decimals |
| --- | --- | ---: |
| `wNVDAx` | `0xa8ddb5cd96b5222afe198316e9a57caa642850d5` | 18 |
| `wAAPLx` | `0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f` | 18 |
| Official mainnet `USD₮0` | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` | 6 |

The official mainnet Builder Code registry is `0xd6c426f9c077358735622ae5a83468dc0510823b`. Mainnet Builder Code registration remains intentionally pending.

Configure the following only in the backend environment. Never place OKX credentials in frontend configuration:

```text
X_LAYER_MAINNET_RPC_URL=https://rpc.xlayer.tech
X_LAYER_MAINNET_EXPLORER_URL=https://www.okx.com/web3/explorer/xlayer
MAINNET_WNVDA_ADDRESS=
MAINNET_WAAPL_ADDRESS=
MAINNET_USDT0_ADDRESS=
PORTPAY_MAINNET_BUILDER_CODE=
MAINNET_QUOTE_TTL_SECONDS=60
OKX_DEX_API_KEY=
OKX_DEX_SECRET_KEY=
OKX_DEX_PASSPHRASE=
```

`PORTPAY_MAINNET_BUILDER_CODE` is intentionally empty until a separate mainnet Builder Code is registered. The adapter can prepare, but not send, ERC-8021 suffixes for approval and swap calldata. No mainnet Builder Code registration or transaction has been performed.

The visible product remains testnet-first. A mainnet selector is not enabled while mainnet execution is disabled; changing a future mode must select the complete chain, token, adapter, API, Builder Code, and explorer configuration rather than only switching the wallet network. The backend uses `viem` 2.56 or newer, satisfying the ERC-8021 helper's documented 2.45 minimum.

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

### Phase 5 testnet deployment

The Phase 5 multi-asset contracts were deployed on 2026-09-20 to X Layer Testnet. DemoNVDA was minted to the existing buyer test wallet. No DemoNVDA settlement was broadcast during this phase; the existing Phase 3 live payment remains the settlement proof.

| Live item | Verified value |
| --- | --- |
| DemoNVDA | `0xa0c469d4419446c21a1d992c0a1c3cdc09bbcc4e` |
| DemoNVDA deployment | [`0x29c409a5a80fe982e1638f21052d15721687e55cb1adf83ee2cb8568c5accf06`](https://www.okx.com/web3/explorer/xlayer-test/tx/0x29c409a5a80fe982e1638f21052d15721687e55cb1adf83ee2cb8568c5accf06) |
| DemoNVDA mint to buyer | [`0xca36ce079a26dde74aa44b2cce816dd1a91653b2a44f80c3612ab71bcfd2a85d`](https://www.okx.com/web3/explorer/xlayer-test/tx/0xca36ce079a26dde74aa44b2cce816dd1a91653b2a44f80c3612ab71bcfd2a85d) |
| PortPaySettlement (two supported assets) | `0xeaab8d9507dcb3323c6045544d0bae546bfed90b` |
| PortPaySettlement deployment | [`0xaac33e7a7b60529f44f89ef5b41e12c9f93e7253b1cd5a4803fcbfe396b51d20`](https://www.okx.com/web3/explorer/xlayer-test/tx/0xaac33e7a7b60529f44f89ef5b41e12c9f93e7253b1cd5a4803fcbfe396b51d20) |
| Settlement funding | `2 USD₮0` via [`0x1a758323c35d8208d44f16e4a54b15aef8a9fdaff47f2c8128166fec4f2ab37e`](https://www.okx.com/web3/explorer/xlayer-test/tx/0x1a758323c35d8208d44f16e4a54b15aef8a9fdaff47f2c8128166fec4f2ab37e) |
| Deployment verification | Chain `1952`; quote signer `0xdAFEEdC46A7d39c2fF364ff63F438925A7514d43`; DemoAAPL and DemoNVDA getters match configured addresses; official USD₮0 getter matches `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` |

### Phase 6 Builder Codes testnet evidence

The current [official OKX integration guide](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/builder-codes/integration) requires `viem` `2.45.0` or higher, `ox/erc8021`, and app-side `dataSuffix` attachment because OKX Wallet does not inject Builder Codes automatically. The frontend uses `viem` `^2.56.7`, `ox` `^0.14.45`, and attaches `Attribution.toDataSuffix({ codes: [VITE_PORTPAY_BUILDER_CODE] })` to the DemoAAPL approval and PortPay settlement write requests. No settlement-contract logic was changed.

The official testnet registry proxy is `0x33907e98d7392d95212b05ab03f091e02d7815bf`. The supplied registration transaction [`0x364e2aecb5cbbe0b206cb254a82f786ce5dd0645668adc0af0ee391fb1ce8b50`](https://www.okx.com/web3/explorer/xlayer-test/tx/0x364e2aecb5cbbe0b206cb254a82f786ce5dd0645668adc0af0ee391fb1ce8b50) is canonical on chain `1952`. Its registry logs and a fresh `payoutAddress(uint256)` call prove that **`kob1lkgsg6infkg3` (`lk`)** is registered to `0xbabdfef588cf57efcc7c8857960e3ccdd9167589`. The older **`kob1klgsg6infkg3` (`kl`)** and temporary-page `2j3pbm1a4djso11j` both return the registry's `Unregistered` error and must not be used.

A historical zero-value approval transaction [`0xac4bd28ab7ce813c6ccd92a39bd323db2f723e701bf42e3ffbdae0a9f11dda7f`](https://www.okx.com/web3/explorer/xlayer-test/tx/0xac4bd28ab7ce813c6ccd92a39bd323db2f723e701bf42e3ffbdae0a9f11dda7f) succeeded in block `41479224` and decoded to the older unregistered `kob1klgsg6infkg3`. It proves suffix mechanics only and is not the Phase 6 attribution proof.

### Live Phase 6 attributed settlement proof

Invoice `eb2eae24-f8c9-47b4-9a7f-20942fd83e6e` moved from `pending` to `paid` through the real buyer flow. The approval and settlement calldata both decode to `kob1lkgsg6infkg3`; the official registry resolves that code to the buyer payout `0xbabdfef588cf57efcc7c8857960e3ccdd9167589`.

| Live item | Verified value |
| --- | --- |
| Chain | X Layer Testnet, `1952` |
| Buyer / merchant | `0xbabdfef588cf57efcc7c8857960e3ccdd9167589` / `0x815c2fb8178f0bf80ada8c5b97ff44ece90e6e25` |
| DemoAAPL / USD₮0 | `0x756546fce7d7ca3bb4be127904b002baf13b432e` / `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` |
| PortPaySettlement | `0xeaab8d9507dcb3323c6045544d0bae546bfed90b` |
| Builder Code | `kob1lkgsg6infkg3` in approval and settlement calldata |
| Registry payout | `0xbabdfef588cf57efcc7c8857960e3ccdd9167589` from `payoutAddress(uint256)` |
| Buyer approval | [`0xdd356fda64ff5dc4ee7550b178b782439a235288462709d32e3e89838f8ceab7`](https://www.okx.com/web3/explorer/xlayer-test/tx/0xdd356fda64ff5dc4ee7550b178b782439a235288462709d32e3e89838f8ceab7), block `41487785` |
| Approval arguments | `approve(PortPaySettlement, 4000000000000000)` |
| Settlement | [`0x4715d804cb838a05a8982e129d025e39e090955868868ff62465a53477cd3e07`](https://www.okx.com/web3/explorer/xlayer-test/tx/0x4715d804cb838a05a8982e129d025e39e090955868868ff62465a53477cd3e07), block `41487796` |
| Settlement event | One matching `SettlementExecuted` event from the deployed PortPaySettlement |
| Receipt verification | Successful receipt; receipt block hash matched the canonical block; `987` observed confirmations at verification time, `2` required |
| Balance change | Buyer `0.996` → `0.992 DemoAAPL`; merchant `1` → `2 USD₮0` |
| Invoice result | Supabase status `pending` → `paid`; exact `1 USD₮0` received |

## Environment configuration

Copy the relevant example before running a workspace:

```powershell
Copy-Item frontend/.env.example frontend/.env
Copy-Item backend/.env.example backend/.env
```

The examples contain no secrets. Keep populated `.env` files local and never commit private keys, seed phrases, Supabase secrets, API credentials, or mainnet credentials.

Frontend variables are prefixed with `VITE_` because Vite exposes them to browser code. Backend variables remain server-side. `VITE_BACKEND_URL`, `PUBLIC_APP_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` must be configured for a live invoice demo. `DATABASE_URL` is retained for Supabase/Postgres migration tooling. Do not expose the service-role key or `PORTPAY_*_API_KEY` values to the frontend.
External merchant integrations use the server-only `PORTPAY_TEST_API_KEY` and `PORTPAY_TEST_MERCHANT_ADDRESS` pair. Generate an API key with at least 32 high-entropy characters. Optional signed callbacks use a trusted operator-configured HTTPS `PORTPAY_TEST_WEBHOOK_URL`; literal local/private destinations are rejected. `PORTPAY_TEST_WEBHOOK_SECRET` must contain at least 32 high-entropy characters. Mainnet OKX API credentials belong only to the isolated backend preparation client and are never used by this merchant integration or the testnet path.
Production frontend deployments must set `VITE_BACKEND_URL` at build time; API requests fail clearly when it is omitted. Production backend startup requires explicit `PUBLIC_APP_URL` and `CORS_ORIGIN`. Localhost defaults apply only to development, so check all three public origins when deploying the two-tab demo.

The Phase 3/5 backend also requires `QUOTE_SIGNER_PRIVATE_KEY`, `DEMO_AAPL_REFERENCE_PRICE_USD` (default `250.00` demo USD), `DEMO_NVDA_REFERENCE_PRICE_USD` (default `180.00` demo USD), and `QUOTE_TTL_SECONDS` (default `300`, allowed range `1`–`300`). The quote signer address must match `QUOTE_SIGNER_ADDRESS` used when deploying `PortPaySettlement`. The private key is server-only and must never be placed in the frontend environment.

For Phase 6, set `VITE_PORTPAY_BUILDER_CODE` to a 16-character code registered on the official testnet registry with payout address `0xbabdfef588cf57efcc7c8857960e3ccdd9167589`. The current local value is the already registered `kob1lkgsg6infkg3`; checkout verifies it through an explicit X Layer Testnet public client and chain-1952 check before approval. Builder Codes are public identifiers, not secrets. Verify future transactions on [OKLink](https://www.oklink.com/x-layer-testnet) by checking the ERC-8021 calldata suffix, then read `payoutAddress(uint256)` from the official testnet registry.

For contracts, copy `contracts/.env.example` to `contracts/.env` only when using the deployment or minting scripts. Keep `PRIVATE_KEY` populated only in that local untracked file. The frontend and backend examples include the verified testnet USD₮0, DemoAAPL, DemoNVDA, settlement, and registered Builder Code values. The Foundry deployment template keeps newly deployed addresses blank until each script run supplies them.

### Supabase/Postgres setup

Create or select a Supabase project, then apply these migrations in order through the Supabase SQL editor or the Supabase CLI migration workflow:

1. [`backend/supabase/migrations/20260917000000_create_invoices.sql`](backend/supabase/migrations/20260917000000_create_invoices.sql)
2. [`backend/supabase/migrations/20260917000001_add_settlement_evidence.sql`](backend/supabase/migrations/20260917000001_add_settlement_evidence.sql)
3. [`backend/supabase/migrations/20260920000000_add_smart_spend_metadata.sql`](backend/supabase/migrations/20260920000000_add_smart_spend_metadata.sql)
4. [`backend/supabase/migrations/20260921000001_add_merchant_integration.sql`](backend/supabase/migrations/20260921000001_add_merchant_integration.sql)

The first migration creates `public.invoices`; the second adds confirmed settlement evidence fields and unique transaction/quote indexes; the third adds `smart_spend_used`, `smart_spend_recommended_asset`, and `smart_spend_reason` for paid history; the fourth adds the optional merchant-controlled `external_order_reference` and lookup index. All keep row-level security enabled. PortPay uses the server-only `SUPABASE_SERVICE_ROLE_KEY`; no browser Supabase client is used. Apply all four before relying on the complete current integration schema.

Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_APP_URL`, and `CORS_ORIGIN` in `backend/.env`. Keep `PUBLIC_APP_URL` equal to the independently deployed frontend origin so generated `/pay/<uuid>` links open in the right app.

## Local run instructions

### Frontend

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Open `http://localhost:5173/merchant`. For a production-style local check:

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
npm run start
```

`npm run start` serves the Vite preview and expects the preceding build output.

The frontend scripts use Vite's runner config loader for reliable Windows/OneDrive development and test execution. This does not change the production bundle or wallet behavior.

With OKX Wallet installed and unlocked, click **Connect OKX Wallet**, approve the connection, and use **Switch to X Layer Testnet** if the wallet is on another chain. The merchant dashboard enables invoice creation only when the connected wallet is on chain 1952. It loads that wallet's persisted invoices from the backend and keeps the Phase 1 read-only DemoAAPL/USD₮0 balance cards available.

After creating an invoice, use **Copy link** to share `/pay/<uuid>`. The merchant can keep `/merchant/invoices/<uuid>` open to monitor status and copy the link again. Opening `/pay/<uuid>` in another tab loads the buyer checkout. On X Layer Testnet, the buyer connects OKX Wallet, reviews the exact DemoAAPL or DemoNVDA/USD₮0 quote, may set target allocations and choose **Smart Pay**, or may manually choose an asset, then explicitly approves only the quoted amount and confirms settlement. Smart Spend never submits a transaction automatically. The merchant invoice becomes paid only after that evidence is reconciled. Each role then sees the same verified evidence with role-specific wording.

From the dashboard, **Smart Payment History** has separate merchant and buyer views. Merchant view emphasizes USD₮0 received; buyer view emphasizes DemoAAPL spent. Both views load only `paid` records from persisted Supabase settlement evidence, show the related invoice and timestamp, and link to the verified transaction when its hash is valid. The existing Phase 3 live payment appears in both views when the corresponding merchant or buyer wallet is connected.

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

The backend exposes the health route, invoice API, Phase 3/5 settlement API, and Phase 4 receipt/history queries:

- `POST /api/invoices` with `{ "title", "amountUsdt0", "merchantAddress" }` creates a pending invoice.
- `GET /api/invoices?merchantAddress=<wallet>` lists invoices for the connected merchant wallet.
- `GET /api/invoices/<uuid>` resolves the shareable invoice link target.
- `POST /api/invoices/<uuid>/quote` accepts `assetKey` (`demoAapl` or `demoNvda`) and issues a short-lived EIP-712 quote bound to the invoice, buyer, merchant, selected asset, exact amounts, chain, settlement contract, and expiry.
- `POST /api/invoices/<uuid>/reconcile` checks the canonical receipt block and configured confirmation depth, verifies the structured settlement event, stores validated Smart Spend metadata when supplied, and changes the invoice to `paid`.
- `GET /api/history/merchant?merchantAddress=<wallet>` returns paid invoices whose persisted merchant matches the wallet.
- `GET /api/history/buyer?buyerAddress=<wallet>` returns paid invoices whose persisted buyer matches the wallet.
- `POST /api/integration/invoices` creates an invoice for the authenticated server-side merchant credential and accepts an optional `externalOrderReference`.
- `GET /api/integration/invoices/<uuid>/status` returns the authenticated merchant's verified status, hosted payment URL, and settlement hash after payment.

Integration credentials use `Authorization: Bearer <PORTPAY_TEST_API_KEY>` and are never accepted from browser configuration. If a webhook URL and secret are configured, the backend sends a signed `payment.confirmed` event only after the same canonical receipt/confirmation-depth reconciliation used by the dashboard. Webhook delivery has bounded in-process retries and idempotency headers; delivery failure does not change a verified payment back to pending.

The API validates titles, positive USD₮0 amounts with up to 6 decimals, EVM wallet addresses, UUIDs, and transaction hashes. It returns a clear unavailable response when Supabase/Postgres or the quote signer/contract configuration is not ready. It never marks an invoice paid from client input alone; the reconciliation endpoint requires a successful X Layer Testnet receipt sent to the configured settlement contract with one matching `SettlementExecuted` event. History endpoints filter to `paid` server-side, so pending invoices and client-supplied fake payment records are excluded.

### Integrate PortPay

Merchants can choose either path:

1. **Payment-link flow:** connect the merchant wallet at `/merchant`, create an invoice, and share the returned `/pay/<uuid>` URL.
2. **Developer integration:** create invoices from the merchant backend, redirect customers to hosted checkout, then retrieve the verified status or consume a signed webhook. No merchant frontend wallet logic or iframe is required.

The current server-to-server endpoints are:

- `POST /api/integration/invoices` — authenticated with `Authorization: Bearer <PORTPAY_TEST_API_KEY>`. Send `{ "title", "amountUsdt0", "externalOrderReference" }`; the merchant address is taken from the server credential. The response includes `invoice.id`, `invoice.status`, `invoice.paymentUrl`, and `invoice.amountUsdt0`.
- `GET /api/integration/invoices/<uuid>/status` — returns the persisted `pending`/`paid` state, amount, hosted payment URL, optional external reference, and verified transaction fields after payment.

`externalOrderReference` is returned only through authenticated integration responses and signed webhooks. The public hosted-checkout invoice response omits it.

Shortest example from a merchant backend:

```powershell
$headers = @{ Authorization = "Bearer $env:PORTPAY_TEST_API_KEY" }
$body = @{ title = "Pro plan"; amountUsdt0 = "20.00"; externalOrderReference = "order-1001" } | ConvertTo-Json
$invoice = Invoke-RestMethod -Method Post -Uri "$env:PORTPAY_BACKEND_URL/api/integration/invoices" -Headers $headers -ContentType "application/json" -Body $body
# Redirect the browser to $invoice.invoice.paymentUrl
$status = Invoke-RestMethod -Method Get -Uri "$env:PORTPAY_BACKEND_URL/api/integration/invoices/$($invoice.invoice.id)/status" -Headers $headers
```

If `PORTPAY_TEST_WEBHOOK_URL` and `PORTPAY_TEST_WEBHOOK_SECRET` are configured, PortPay sends `payment.confirmed` only after the existing canonical settlement reconciliation succeeds. Verify `x-portpay-signature` as `sha256=HMAC-SHA256(secret, raw JSON body)`, deduplicate with `x-portpay-event-id` or `idempotency-key`, and use the persisted settlement fields in the payload to fulfill the order. Delivery retries are bounded and in-process; there is no durable delivery queue. Concurrent delivery is coalesced in one process, but a restart or repeated reconciliation can deliver the same stable event ID again, so consumers must deduplicate. A failed callback never reverts a verified `paid` invoice. Invoice creation itself is not idempotent: retrying `POST /api/integration/invoices` creates another invoice, while `externalOrderReference` is an indexed correlation value rather than an idempotency key.

The integration layer calls the same invoice repository and reconciliation state used by the dashboard. It does not duplicate or bypass `TestnetSettlementAdapter`. Testnet remains the proven default; the separate `OKXDEXMainnetAdapter` is not connected to this API or to any execution route.

### Nested product documentation

The running app includes `/docs` pages for the product overview, getting started, how the settlement flow works, merchant integration, and testnet boundaries. The merchant integration page is the recommended reference for a business that wants PortPay inside its existing checkout.

### Canonical reusable messaging

- Product: “PortPay turns tokenized portfolios into a payment method. Customers spend the assets they already hold. Merchants keep pricing and receiving payments in stablecoins.”
- Business: “Add PortPay to your existing checkout and let customers pay from their tokenized stock portfolio while your business receives stablecoins.”
- Integration: “Businesses can use PortPay as a hosted payment link or integrate the invoice/payment flow directly into their own website.”
- Demo close: “PortPay turns tokenized portfolios into a payment method. Customers spend the assets they already hold, businesses keep receiving stablecoins, and merchants can plug PortPay directly into their existing checkout.”

### Phase 7 judge demo

1. Start the backend and frontend independently, then open `http://localhost:5173/merchant` in the merchant tab.
2. Connect the merchant OKX Wallet on X Layer Testnet and create a small invoice such as `1.00 USD₮0`.
3. Copy the generated `/pay/<uuid>` payment link into a separate buyer tab. The buyer screen shows the invoice title, amount due, chain, supported demo balances, optional Smart Spend recommendation, and exact quote before any wallet request.
4. Connect the buyer OKX Wallet, choose **Smart Pay** or a manual DemoAAPL/DemoNVDA selection, and approve only the quoted asset amount. Confirm the settlement in the wallet.
5. Return to the merchant tab and open `/merchant/invoices/<uuid>` after reconciliation. Show **Payment received**, exact USD₮0 received, asset spent, receipt timestamp, transaction hash, and **View on X Layer Explorer**.
6. Keep the buyer tab on `/pay/<uuid>` to show **Payment sent**, what was spent, and whether Smart Spend was used. The merchant dashboard history separately emphasizes what the merchant received.

The product remains intentionally explicit about the demo boundary: DemoAAPL and DemoNVDA are ordinary test assets, not official xStocks or real Apple/NVIDIA-backed securities; the X Layer Testnet flow is portfolio settlement, not an OKX DEX swap; and no mainnet transaction is required.

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

The `DemoAAPL`, `DemoNVDA`, and `PortPaySettlement` contracts and their tests are in `contracts/src/` and `contracts/test/`. Use a local untracked `contracts/.env` for the testnet workflow:

```powershell
cd contracts
Copy-Item .env.example .env
# fill PRIVATE_KEY, then deploy DemoAAPL and set DEMO_AAPL_ADDRESS
& .\.tools\foundry\forge.exe script script/DeployDemoAAPL.s.sol:DeployDemoAAPL --rpc-url xlayer_testnet --broadcast
& .\.tools\foundry\forge.exe script script/MintDemoAAPL.s.sol:MintDemoAAPL --rpc-url xlayer_testnet --broadcast
# fill QUOTE_SIGNER_ADDRESS, TESTNET_USDT0_ADDRESS, DEMO_AAPL_ADDRESS, and DEMO_NVDA_ADDRESS
& .\.tools\foundry\forge.exe script script/DeployDemoNVDA.s.sol:DeployDemoNVDA --rpc-url xlayer_testnet --broadcast
& .\.tools\foundry\forge.exe script script/MintDemoNVDA.s.sol:MintDemoNVDA --rpc-url xlayer_testnet --broadcast
& .\.tools\foundry\forge.exe script script/DeployPortPaySettlement.s.sol:DeployPortPaySettlement --rpc-url xlayer_testnet --broadcast
# set PORTPAY_SETTLEMENT_ADDRESS, then fund it with test USD₮0
& .\.tools\foundry\forge.exe script script/FundPortPaySettlement.s.sol:FundPortPaySettlement --rpc-url xlayer_testnet --broadcast
```

Run `forge` directly if it is installed on PATH. These scripts reject non-1952 deployments and are testnet-only. The live proof above was performed on X Layer Testnet only; no mainnet deployment or transaction has been performed.

## Deployment structure

- `frontend/` can be built and deployed as a static Vite site. Its runtime chain and address configuration is provided through `VITE_*` variables.
- `backend/` can be built into `dist/` and deployed as an independent Node.js service. Its port, CORS, network, and Supabase/Postgres settings are server-side variables.
- `contracts/` is deployed independently through Foundry. `DemoAAPL`, `DemoNVDA`, `PortPaySettlement`, and settlement funding scripts target X Layer Testnet only; private keys and broadcast artifacts remain local and untracked.

No workspace depends on a hidden mainnet credential or mainnet transaction.

## Phase 5 verification

Expected checks from a clean checkout:

```powershell
cd frontend; npm install; npm run lint; npm run typecheck; npm run test; npm run build
cd ../backend; npm install; npm run lint; npm run typecheck; npm run test; npm run build
cd ../contracts; forge fmt --check; forge build --no-cache --use .tools/solc-0.8.24.exe; forge test --use .tools/solc-0.8.24.exe
```

The frontend and backend can be started independently after their own install and Supabase configuration. A Phase 5 smoke check is: connect the buyer wallet, confirm DemoAAPL and DemoNVDA balances load, set target allocations, verify the deterministic recommendation and reason, choose Smart Pay or a manual asset, and confirm that no wallet transaction opens until the buyer clicks the explicit payment action. Confirm that a completed payment records Smart Spend usage and reason in both the receipt and Smart Payment History. Existing Phase 3 receipts and pending-invoice filtering must remain unchanged. Invalid/missing invoice links and incomplete transaction evidence should remain explicit rather than producing invented hashes or links.

## Phase 6 verification

The frontend Builder Code path is covered by `builderCodes.test.ts` tests for ERC-8021 encoding, registry/payout checks, fail-closed configuration, and viem approval/settlement calldata construction. The Foundry settlement test also verifies that trailing bytes do not change approval or settlement effects. Before a wallet prompt, checkout reads `payoutAddress(uint256)` from the official testnet registry and requires the expected payout address. The temporary registration route is not part of the product flow. The live Phase 6 proof above confirms both eligible transactions carried the registered code and the settlement receipt reconciled successfully.

Before broadcasting, compare the deployed `quoteSigner`, `demoAsset`, `demoNvda`, and `stablecoin` getters against the backend signer, both demo asset addresses, and official testnet USD₮0 address. The deployment script requires the official USD₮0 address; the funding script checks that the target settlement contract reports the same stablecoin. The backend rejects a non-1952 RPC, filters receipt events to the configured settlement contract, binds the receipt sender to the buyer, and requires a canonical receipt block with two confirmations by default (`SETTLEMENT_CONFIRMATION_DEPTH`). Reconciliation uses the contract-verified asset amount in the event, so changing the demo reference price after signing cannot strand a successful payment. The contract checks the buyer's exact asset debit, its exact asset receipt, and the merchant's exact stablecoin receipt; fee-on-transfer tokens revert the entire settlement.

## Phase 7 verification

The Phase 7 product pass is presentation-only. It preserves the existing settlement, quote, Smart Spend, history, Builder Code, and receipt data paths. The responsive layout is built around touch-sized actions, stacked mobile cards, compact wallet/status pills, and a single primary action per stage. The development-only Builder Code diagnostics route remains isolated at `/__builder-code-debug`; registry diagnostics are no longer appended to normal buyer-facing payment errors.

## Known limitations and deferred work

- Live Supabase/Postgres credentials and all three migrations are required for any reproduction. The Phase 2/3 migrations were applied for the recorded proof; the Phase 5 Smart Spend migration must be applied before completed Smart Pay payments can persist their metadata.
- The recorded deployment addresses and payment evidence are for X Layer Testnet only. The historical Phase 3 deployment transaction hashes were not retained in the committed workspace; the Phase 5 deployment and funding hashes are recorded above.
- A quote signer private key is required server-side; it must correspond to the signer configured in the deployed settlement contract. Whoever controls that key can authorize spending the contract's prefunded USD₮0 balance through valid quotes, so use a dedicated restricted demo key and protect it as a settlement authority. Changing the signer requires a new settlement deployment.
- DemoAAPL and DemoNVDA quote math uses explicit `250.00 USD` and `180.00 USD` demo reference prices. Asset amounts are rounded upward in base units so the quoted amount fully covers the exact USD₮0 invoice; this is demo math, not market data or an oracle.
- Smart Spend defaults to a 50/50 DemoAAPL/DemoNVDA target, uses onchain balances and configured demo prices, prefers an eligible overweight asset that can cover the full invoice, and never auto-executes. It is not financial advice.
- Smart Spend choice and reason in receipts/history are checkout-reported offchain metadata; the backend checks a reported recommended asset against the onchain settlement asset, but cannot independently prove that the buyer used the recommendation or that the reason matched an earlier portfolio snapshot. Settlement asset and amounts are verified from the canonical receipt.
- Settlement liquidity must be funded manually with official testnet USD₮0 before a buyer can pay again.
- The merchant wallet address is supplied by the connected frontend wallet but is not cryptographically authenticated by the Phase 2 API; authentication/authorization is deferred.
- The Supabase migration enables row-level security and the backend uses the server-only service-role key. No browser client or direct anon-key database access is enabled.
- The current Phase 6 implementation is testnet-only. Registration transaction `0x364e2aecb5cbbe0b206cb254a82f786ce5dd0645668adc0af0ee391fb1ce8b50` registered `kob1lkgsg6infkg3`, which is now the local frontend configuration. The temporary registration page is removed from the product route; registration remains an external setup step. The older `kob1klgsg6infkg3` and `2j3pbm1a4djso11j` values must not be used without independent registry proof.
- The public X Layer Testnet RPC may be rate limited, and wallet connection/balance reads require an installed OKX Wallet browser extension and a connected account.
- Receipt reconciliation requires a canonical receipt block and two confirmations by default; this is a small testnet safety check, not a claim of protocol finality. Receipt/history views are paid-only and currently load on wallet/view changes rather than through a realtime Supabase subscription.
- The Phase 5 testnet setup is recorded below. A deployed demo asset and minted balance require a burner wallet, test OKB, and explicit local deployment commands when reproducing the proof.
- `DemoAAPL` is a centrally minted test asset for demos and is not an official xStock or backed by Apple shares.
- The official USD₮0 address and six-decimal metadata are verified from the current docs and a read-only testnet RPC call.
- Mainnet Phase 1 is preparation-only. It has no API route, browser-wallet integration, simulation gate, registered mainnet Builder Code, or transaction broadcast method. Its allowlist accepts only decoded OKX router calls with an explicit merchant receiver and structured base request; unsupported router call shapes fail closed until separately reviewed.

## Source-of-truth and phase discipline

`AGENTS.md` defines repository workflow and approval gates. `PORTPAY_SPEC.md` defines the product, architecture, scope, and phased build plan. Only one named phase may be active at a time. Phase 3 implementation and the first live testnet proof are complete, Phase 4 receipts/history implementation is complete, Phase 5 Smart Spend implementation is complete, Phase 6 Builder Codes is closed with verified attributed settlement evidence, Phase 7 product polish is implemented, and Mainnet Phase 1 adds an unconnected preparation-only adapter. Checkpoint C review was performed on 2026-09-21. Optional Phase 8 requires separate explicit approval and another pre-mainnet review.
