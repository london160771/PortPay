# PortPay

Spend your portfolio. Merchants get stablecoins.

PortPay lets customers spend tokenized stock holdings while merchants receive stablecoins. Businesses request payment in stablecoins, customers choose an xStock-style portfolio asset, PortPay handles the payment flow, and both sides receive an onchain-verifiable receipt.

The core message is simple: **PortPay turns tokenized portfolios into a payment method. Customers spend the assets they already hold. Merchants keep pricing and receiving payments in stablecoins.**

## Current project status

**PortPay is Mainnet-first; the buyer-signed Pay handoff is implemented but real Mainnet use awaits final review.** Normal merchant, buyer, receipt, and history routes use X Layer Mainnet (chain `196`) without a query selector or network switch. Pay is available only after the backend rechecks the same persisted preparation and returns READY; the connected buyer manually confirms that exact transaction in OKX Wallet. The flow reuses the existing exact allowance, never fetches another swap after READY, and does not send automatically. The backend never signs or broadcasts, and an invoice becomes paid only after canonical reconciliation.

The repository contains independent frontend, backend, and Foundry workspaces, a Mainnet-aware merchant dashboard, Supabase/Postgres invoice persistence, hosted payment links, wNVDAx/wAAPLx checkout preparation, buyer/merchant receipts and history, and a server-side OKX V6 `OKXDEXMainnetAdapter`. Historical DemoAAPL/DemoNVDA settlement remains in the repository only for automated regression and legacy receipt compatibility; it is not exposed by normal production routes or UI.

Frontend and backend verification pass locally. The pinned Windows Foundry release remains in the ignored `contracts/.tools/foundry` directory, so WSL is not required by the project; this UX/integration pass made no contract changes and did not send transactions.

PortPay prepares ERC-8021 Builder Code suffixes for eligible transactions and checks registry registration and payout before a wallet request. The configured testnet code was verified on a real attributed testnet payment. `OKXDEXMainnetAdapter` remains a server-side preparation/reconciliation boundary; the buyer-signed Pay handoff passes only the persisted transaction to the connected wallet after same-calldata readiness recheck. Backend signing and broadcasting remain disabled. The Phase 3 proof used Supabase/Postgres, a dedicated quote signer, funded testnet contracts, test OKB, and separate buyer/merchant wallets. Phase 5 added and deployed DemoNVDA plus the two-asset settlement contract; the Phase 6 live proof used DemoAAPL.

The merchant and buyer routes remain separate, receipts preserve the network recorded with their evidence, and merchant API/invoice logic remains above the network adapter boundary. Testnet is an internal regression environment only. The mainnet adapter remains isolated; its buyer handoff uses the persisted preparation and existing reconciliation path, with no backend signing or broadcast. Do not use Pay for a real Mainnet transaction before final GPT-5.6 Sol High review and the buyer's manual wallet confirmation.

## Stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, `wagmi`, and `viem`.
- Backend: Node.js, Express, and TypeScript.
- Database: Supabase/Postgres, required for PortPay persistence. Phase 2 adds the reproducible invoice migration and server-side repository boundary.
- Contracts: Solidity and Foundry.
- Product network: X Layer Mainnet, chain ID `196`, native gas token `OKB`.
- Internal regression network: X Layer Testnet, chain ID `1952` (not a normal product option).
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
  ├── X Layer Mainnet product configuration (chain 196)
  ├── wagmi/viem configuration
  ├── OKX Wallet injected connector
  └── dev-flag-only chain-1952 regression route

Express API (backend/)
  ├── health/readiness foundation
  ├── Mainnet product and isolated internal testnet configuration
  ├── merchant invoice API and validation
  ├── authenticated merchant integration API and signed payment notifications
  ├── Supabase/Postgres invoice repository
  ├── `OKXDEXMainnetAdapter` authenticated quote/preparation and mainnet reconciliation
  ├── internal-only `TestnetSettlementAdapter` for regression/historical compatibility
  ├── server-side authenticated OKX V6 DEX API client
  ├── deterministic Smart Spend allocation and target rules
  ├── canonical, confirmed settlement-event reconciliation
  └── paid-only receipt and Smart Payment History queries

Foundry workspace (contracts/; historical testnet path retained for regression)
  ├── DemoAAPL ordinary test ERC-20
  ├── PortPaySettlement minimal testnet settlement contract
  └── X Layer Testnet deployment, minting, and funding scripts
```

Invoice metadata, product names, payment-link records, and indexed settlement evidence are persisted offchain in Supabase/Postgres. The normal product configuration targets mainnet tokenized assets and real USD₮0 directly to the merchant. Historical chain-1952 portfolio settlement through `TestnetSettlementAdapter` is not an OKX DEX swap and is unavailable from production routes.

The product routes are intentionally role-separated:

- `/merchant` — merchant dashboard and invoice list.
- `/merchant/invoices/:invoiceId` — merchant status, copyable buyer link, and merchant receipt.
- `/pay/:invoiceId` — hosted X Layer Mainnet checkout and buyer receipt; the manual Pay handoff requires the persisted exact allowance and a fresh server recheck.
- `/docs`, `/docs/getting-started`, `/docs/how-it-works`, `/docs/merchant-integration` — judge and business documentation. Internal testnet docs are hidden unless explicitly enabled in local development.

The merchant API is also role-separated from the browser: server-side merchant credentials create invoices and retrieve verified status, while the hosted `/pay/:invoiceId` page owns wallet/payment behavior.

The adapter boundary is documented for the later phases:

- `OKXDEXMainnetAdapter` — X Layer Mainnet OKX V6 quote/preparation/reconciliation boundary; buyer wallet signing is manual after a same-calldata server recheck, while backend signing/broadcast remain disabled.
- `TestnetSettlementAdapter` — retained exclusively for chain-1952 regression and historical compatibility; never selected by production routes.

The backend does not sign or broadcast transactions. The buyer checkout can submit only the exact persisted swap after a fresh same-calldata readiness recheck and manual OKX Wallet confirmation; it never requests another approval or sends automatically. No real Mainnet swap has been sent, and an invoice is not marked paid from a frontend action. Earlier September 22/23 migration versions are applied live and the separately applied `service_role` ACL correction passed verification. The current September 23 files passed the final seven-migration replay on a verified non-live Neon database; the current ACL matrix, RLS, triggers, indexes, A–E backfill cases, atomic finalization, idempotency, rollback behavior, and cleanup passed, and that replay did not contact live Supabase. The trigger-only `set_invoices_updated_at()` `PUBLIC EXECUTE` caveat is accepted for this release. The separate `20260924000000_mainnet_handoff_invoice_unique.sql` migration has now been applied successfully to the live PortPay Supabase project. Its live precheck found 0 handoff rows and 0 duplicate `invoice_id` values; `UNIQUE(mainnet_handoffs.invoice_id)` is present and valid, existing `preparation_id` uniqueness and the handoff primary key remain intact, RLS/ACL were unchanged, and no evidence rows were modified. The invoice-level uniqueness blocker is cleared. Buyer-signed Mainnet swap execution is implemented, but no real Mainnet swap has been sent; real payment still awaits final GPT-5.6 Sol High review and separate user authorization.

## X Layer Mainnet preparation and buyer-signed Pay handoff

Mainnet preparation is isolated from the proven testnet flow:

```text
chain 196 → OKXDEXMainnetAdapter → wNVDAx / wAAPLx → USD₮0 directly to the merchant
```

The server-side adapter uses the authenticated OKX V6 DEX API at its pinned official origin for quotes, exact approval calldata, and swap transaction preparation. It validates chain `196`, independently verified xStock and USD₮0 addresses, decoded invoice merchant recipient, decoded tokens and amounts, quote freshness, minimum receive amount, router, spender, and exact approval amount. Unsupported router call shapes fail closed. The backend approval-preparation endpoint uses the existing immutable Supabase evidence and full Phase 2 preflight; it never accepts caller-supplied spender, amount, calldata, or swap data as authority. The current proof input is fixed server-side at `4800000000000000` wNVDAx base units (`0.0048`), and the quote must meet the pending invoice's USD₮0 acceptance amount.

The ordinary `/pay/:invoiceId` route is Mainnet by default; there is no network query selector in normal product routes. The buyer connects OKX Wallet on chain `196`; checkout uses a persisted preparation and requires the exact wNVDAx allowance to already exist. PortPay targets 120 seconds of preparation validity starting when the final authenticated swap preparation is produced. The effective expiry is the earlier of `preparedAt + 120 seconds` and the deadline encoded in that exact OKX calldata; the preview quote must still be fresh when the swap response is accepted. Neither displayed expiry nor calldata is extended. If a candidate has less than 120 seconds remaining when Pay is clicked, checkout requests a fresh authenticated preparation before any wallet prompt and then runs final readiness against that exact persisted preparation. When OKX embeds a shorter deadline, this is a just-in-time refresh, not a longer validity claim. The read-only readiness check still requires at least 30 seconds remaining after its checks; if that cannot be met, no wallet prompt or handoff occurs and the invoice remains retryable. The buyer then signs the bound handoff authorization message; the backend repeats the checks and persists the handoff only while still unexpired. Only a successfully persisted handoff starts the one-attempt rule. The subsequent READY response supplies matching persisted transaction fields, which the frontend passes unchanged to OKX Wallet. No new approval is requested, and the buyer manually confirms the swap.

After wallet submission, the frontend records the wallet-returned transaction hash through the existing Mainnet submission route and polls canonical reconciliation. It never fetches another OKX `/swap`, changes the persisted calldata, or automatically sends. Wallet submission alone does not mark an invoice paid; only verified canonical reconciliation does. This implementation is not a live Mainnet payment proof. Do not use the Pay handoff for a real payment before the required final Sol High review and explicit authorization.

READY returns the same persisted preparation after the exact existing allowance passes Stage B. The Pay flow requires that exact allowance and does not offer or request a new token approval; any approval setup is separate from Pay. Before asking the buyer to sign the message bound to the invoice, preparation, calldata, buyer, and expiry, checkout performs its non-consuming read-only final readiness check. If the candidate has less than 120 seconds left at Pay click, checkout refreshes it before any wallet prompt; if OKX's embedded deadline is shorter, the refreshed preparation is used just-in-time and is still subject to the 30-second post-check minimum. If later checks find it too close or expired, it stages a new preparation and waits for another explicit Pay click. Message-signature cancellation, expiry before handoff, or failed handoff creation with no persisted row does not consume the invoice attempt. The buyer separately confirms the exact transaction in the wallet. Each invoice permits only one Mainnet attempt after a handoff is successfully persisted; after that, no second swap prompt is allowed, even after transaction rejection or lost result. A recorded transaction hash can only be recovered and canonically reconciled. If no hash is recorded after a persisted handoff, checkout shows **Payment status unresolved** after reload; the merchant must create a new invoice for another attempt after checking the buyer's wallet. Browser storage cannot authorize another swap.

Current mainnet addresses:

| Asset | Address | Decimals |
| --- | --- | ---: |
| `wNVDAx` | `0xa8ddb5cd96b5222afe198316e9a57caa642850d5` | 18 |
| `wAAPLx` | `0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f` | 18 |
| Official mainnet `USD₮0` | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` | 6 |

The official mainnet Builder Code registry is `0xd6c426f9c077358735622ae5a83468dc0510823b`. A separate mainnet Builder Code is registered and was verified against its configured payout; both are backend-only non-secret configuration.

Configure the following only in the backend environment. Never place OKX credentials in frontend configuration:

```text
X_LAYER_MAINNET_RPC_URL=https://rpc.xlayer.tech
X_LAYER_MAINNET_EXPLORER_URL=https://www.okx.com/web3/explorer/xlayer
MAINNET_WNVDA_ADDRESS=0xa8ddb5cd96b5222afe198316e9a57caa642850d5
MAINNET_WAAPL_ADDRESS=0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f
MAINNET_USDT0_ADDRESS=0x779Ded0c9e1022225f8E0630b35a9b54bE713736
PORTPAY_MAINNET_BUILDER_CODE=5fc2j7wx6trof4eu
PORTPAY_MAINNET_BUILDER_PAYOUT_ADDRESS=0xbabdfef588cf57efcc7c8857960e3ccdd9167589
MAINNET_QUOTE_TTL_SECONDS=120
MAINNET_CONFIRMATION_DEPTH=2
OKX_DEX_API_KEY=
OKX_DEX_SECRET_KEY=
OKX_DEX_PASSPHRASE=
```

The mainnet Builder Code `5fc2j7wx6trof4eu` and payout `0xbabdfef588cf57efcc7c8857960e3ccdd9167589` are public identifiers currently registered and independently verified on chain 196. The adapter prepares ERC-8021 suffixes for approval and swap calldata. The frontend receives the persisted attributed swap transaction only after the complete backend preflight and same-calldata readiness recheck pass. The buyer must manually confirm it in the wallet; the backend never signs or broadcasts.

### Mainnet Phase 2 — registration, preflight, and receipt design

Mainnet Phase 2 includes server-side readiness/submission-observation/reconciliation infrastructure and a buyer-signed Pay handoff. Pay first rechecks the same persisted preparation; READY returns only its exact wallet transaction fields and binding IDs. The connected buyer confirms manually. No new approval is requested, no `/swap` is fetched after READY, and the backend never signs or broadcasts. The handoff remains separate from internal testnet settlement and its reconciliation route; real Mainnet use waits for final review.

If PortPay's mainnet Builder Code must ever be replaced, current official OKX requirements are documented in the [X Layer Builder Codes overview](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/builder-codes/overview) and [integration guide](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/builder-codes/integration):

1. Open the OKX Developer Portal and connect the wallet that should own the mainnet Builder Code.
2. Complete the portal address-verification step.
3. Create a Builder Code on the Builder Code page and record the generated 16-character lowercase code and its displayed payout address.
4. Do not use the testnet code `kob1lkgsg6infkg3` for mainnet.
5. Configure the code and payout address only in the backend environment:

   ```text
   PORTPAY_MAINNET_BUILDER_CODE=<registered-mainnet-code>
   PORTPAY_MAINNET_BUILDER_PAYOUT_ADDRESS=<registered-payout-address>
   ```

6. Before any future wallet request, PortPay reads `payoutAddress(uint256)` from the official mainnet registry `0xd6c426f9c077358735622ae5a83468dc0510823b` on chain `196`. The registry token ID is the deterministic integer conversion of the exact 16-character code. A code is not accepted unless the RPC chain is `196`, the registry returns a nonzero payout, and it matches the configured payout address.

The documented `registerAuto` contract interaction is the X Layer Testnet registration path; mainnet registration is performed through the OKX Developer Portal. PortPay does not call either registration path automatically.

The mainnet preflight validates invoice/quote bindings, chain and tokens, exact amounts, router, spender, recipient, and Builder Code. The official OKX V6 Classic Swap schemas do not document a shared quote/swap `quoteId`; any returned IDs are diagnostic only. The fresh swap response is authoritative for executable route, output, minimum receive, router target, and calldata, which are validated against the invoice/buyer/merchant intent and persisted separately from the price-preview quote. Balances, allowance, and decimals are read at a pinned block; wAAPLx/wNVDAx must report 18 decimals and USD₮0 must report 6. Stage A checks allowance first: anything other than the exact required input (including a larger or unlimited allowance) returns `APPROVAL_REQUIRED` after simulating the exact attributed approval, without estimating or simulating the swap. Only an exact pinned allowance reaches Stage B, which estimates the exact attributed approval and swap calldata, applies a 20% gas margin, simulates the exact swap, and then checks OKB readiness. Immutable preparation evidence includes the final route fingerprint and exact attributed calldata hashes. A fresh READY recheck records an immutable handoff and returns only the exact persisted wallet transaction fields; the backend never signs or broadcasts.

For a laptop-side read-only run using the backend's local `.env`, use PowerShell from the repository root:

```powershell
npm --prefix backend run mainnet:preflight:local
```

This builds the backend TypeScript and runs the compiled CLI with Node. It uses the fixed `0.0048 wNVDAx` input, a synthetic `$1.00 USD₮0` invoice, the existing mainnet preflight wallet fixture, and an in-memory reconciliation repository. Its RPC transport allows only chain/block/balance reads, `eth_call`, `eth_estimateGas`, and gas-price reads; its OKX client is used only for authenticated GET requests. It never signs or broadcasts transactions and does not connect to Supabase. Stage B runs only when the pinned allowance exactly equals the fixed input. The report is a point-in-time preparation result, not transaction authorization.

The fixed proof uses `1.5%` slippage, which is also the adapter's hard maximum; higher values fail closed. Its fresh minimum receive must remain at least `1.000000 USD₮0`. `READY` additionally requires exact allowance, authenticated fresh preparation, direct merchant recipient, verified Builder Code, exact attributed gas estimates and swap `eth_call` to pass, and sufficient OKB. The buyer-signed Pay handoff is implemented, but real Mainnet use awaits final review and separate authorization.

Each immutable preparation stores the preview quote and its digest separately from the final swap response evidence: invoice/participants, chain and token addresses, exact input, final expected/minimum output, router, spender, route path/fingerprint, slippage, Builder Code, exact attributed approval/swap calldata and hashes, pinned preparation block, timestamp, and the earlier of `preparedAt + 120 seconds` or the deadline encoded inside the exact OKX transaction calldata. The quote must still be fresh when the authenticated swap response is accepted. The Classic Swap request schema exposes no caller-controlled transaction-deadline parameter, so PortPay never changes that deadline. These fields are stored in the existing immutable JSON evidence column; no new database migration is required for this binding change.

The mainnet receipt verifier requires byte-for-byte equality with the persisted attributed swap calldata, matching configured/prepared/onchain Builder Codes and payout, a successful chain-196 receipt, buyer sender, prepared router, canonical parent/receipt blocks, configured confirmations, and exact block-pinned balance deltas (`before = receipt block - 1`, `after = receipt block`). The prepared input is a maximum debit, not a guaranteed net spend: the verifier derives the positive net debit from input-token transfer logs, permits only a refund from the prepared router, requires the same debit from canonical balance deltas, and never allows outflow above the prepared amount. Merchant USD₮0 transfer and balance increase must still meet both the prepared minimum and invoice amount. It reports actual net spend. The settlement claim and invoice paid transition now occur in one database RPC transaction with unique invoice/preparation/(chain, transaction) protections; an identical verified retry returns the already-paid result. Earlier September 22/23 migration versions are applied to live Supabase, and the live `service_role` table ACL was separately corrected and verified along with RLS, function privileges, triggers, indexes, and evidence integrity. The current September 23 files passed the final seven-migration replay on verified non-live Neon, including the current ACL matrix and A–E backfill, atomic finalization, idempotency, rollback, and cleanup checks; live Supabase was not contacted during that replay. The trigger-only `set_invoices_updated_at()` `PUBLIC EXECUTE` caveat is accepted for this release. The current September 23 file revisions have not been applied live; do not apply or rerun them live without separate authorization. Mainnet states are separate from testnet; testnet reconciliation is unchanged.

Before the wallet message prompt, `POST /api/invoices/:invoiceId/mainnet/readiness-recheck` accepts a persisted preparation ID, buyer address, and `preflightOnly: true`. On Pay click, if the candidate preparation has under 120 seconds left, the frontend first requests a fresh authenticated preparation before any wallet prompt, then runs final readiness against that newly persisted preparation. The endpoint itself reloads immutable evidence, verifies its hash and invoice/chain/buyer/Builder Code bindings, checks current exact allowance and balances, estimates gas, and calls the exact persisted attributed calldata. It returns no wallet transaction and creates no handoff; it requires at least 30 seconds of remaining preparation lifetime after checks. Since the OKX deadline embedded in calldata may be shorter than the target, expiry is never extended; the fresh preparation is used just-in-time or the check fails closed. After the buyer signs the bound authorization message, the same endpoint is called with the signature; it repeats all checks and the database records the handoff only if still unexpired. If no handoff row was persisted, expiry/failure does not consume the invoice attempt. Only a successfully persisted handoff returns the exact prepared transaction fields needed for the subsequent manual wallet confirmation. After the final fresh preparation is selected, no further OKX `/swap` call occurs during either readiness recheck, and calldata is never mutated. `POST /api/invoices/:invoiceId/mainnet/submitted` accepts preparation ID, handoff ID, and transaction hash; it records the exact RPC-observed transaction, even if observation is after expiry, only when linked to that valid pre-expiry handoff. `POST /api/invoices/:invoiceId/mainnet/reconcile` accepts preparation ID and transaction hash, derives all payment fields from persisted server evidence, invokes the canonical verifier, and finalizes settlement plus invoice paid state atomically. A paid retry succeeds only after the same mainnet network, preparation, transaction, and evidence are reverified. The backend does not sign or broadcast. Real Mainnet use must wait for final GPT-5.6 Sol High review and manual buyer wallet confirmation.

These protections and the manual buyer-signed handoff have unit/regression coverage, but they do not establish a live Mainnet payment proof. The separate mainnet Builder Code and payout are configured and registry-verified, and the live migration/ACL checks passed. The current September 23 migration files passed the final disposable Neon replay described above. No mainnet transaction has been sent by this implementation. Do not treat wallet submission or approval as paid; only canonical reconciliation confirms payment.

Normal product routes are Mainnet-first. The query-string network selector has been removed; internal testnet pages/routes are available only in Vite development when `VITE_ENABLE_INTERNAL_TESTNET=true`, and the backend testnet quote/reconcile routes are available only in test or explicitly enabled non-production development. Production never constructs or registers `TestnetSettlementAdapter`. The backend uses `viem` 2.56 or newer, satisfying the ERC-8021 helper's documented 2.45 minimum.

## Internal X Layer Testnet regression configuration

Chain `1952`, DemoAAPL/DemoNVDA, test USD₮0, and the testnet Builder Code are retained for automated regression, historical receipts, and explicitly enabled non-production tools. They are not a user-selectable product network and must not be used for new production invoices.

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

The current [official OKX integration guide](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/builder-codes/integration) requires `viem` `2.45.0` or higher, `ox/erc8021`, and app-side `dataSuffix` attachment because OKX Wallet does not inject Builder Codes automatically. Historical testnet transactions used the testnet Builder Code on DemoAAPL approval and PortPay settlement requests. Mainnet preparation uses its separate registered code; the manual buyer-signed handoff does not enable backend signing or broadcasting.

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

Frontend variables are prefixed with `VITE_` because Vite exposes them to browser code. Backend variables remain server-side. `VITE_BACKEND_URL`, `PUBLIC_APP_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` must be configured for live invoice persistence. `DATABASE_URL` is retained for Supabase/Postgres migration tooling. Do not expose the service-role key or `PORTPAY_*_API_KEY` values to the frontend. `VITE_ENABLE_INTERNAL_TESTNET` and `PORTPAY_ENABLE_INTERNAL_TESTNET` are local-development-only gates; production ignores the backend flag and does not register testnet settlement routes.
External merchant integrations use the server-only `PORTPAY_TEST_API_KEY` and `PORTPAY_TEST_MERCHANT_ADDRESS` pair. Generate an API key with at least 32 high-entropy characters. Optional signed callbacks use a trusted operator-configured HTTPS `PORTPAY_TEST_WEBHOOK_URL`; literal local/private destinations are rejected. `PORTPAY_TEST_WEBHOOK_SECRET` must contain at least 32 high-entropy characters. Mainnet OKX API credentials belong only to the isolated backend preparation client and are never used by this merchant integration or the testnet path.
Production frontend deployments must set `VITE_BACKEND_URL` at build time; API requests fail clearly when it is omitted. Production backend startup requires explicit `PUBLIC_APP_URL` and `CORS_ORIGIN`. Localhost defaults apply only to development, so check all three public origins when deploying the two-tab demo.

The retained internal testnet backend requires `QUOTE_SIGNER_PRIVATE_KEY`, `DEMO_AAPL_REFERENCE_PRICE_USD` (default `250.00` demo USD), `DEMO_NVDA_REFERENCE_PRICE_USD` (default `180.00` demo USD), and `QUOTE_TTL_SECONDS` (default `300`, allowed range `1`–`300`). These values are not used by the Mainnet product adapter. The private key is server-only and must never be placed in the frontend environment.

The internal testnet Builder Code is `kob1lkgsg6infkg3`, registered to payout `0xbabdfef588cf57efcc7c8857960e3ccdd9167589`; local regression code verifies it on chain 1952. Mainnet uses its separate code and registry configuration above. Builder Codes are public identifiers, not secrets.

For historical testnet contract regression only, copy `contracts/.env.example` to `contracts/.env` when using internal deployment/test scripts. Keep `PRIVATE_KEY` populated only in that local untracked file. Mainnet adapter operation does not use those testnet contract addresses.

### Supabase/Postgres setup

Create or select a Supabase project, then apply these migrations in order through the Supabase SQL editor or the Supabase CLI migration workflow:

1. [`backend/supabase/migrations/20260917000000_create_invoices.sql`](backend/supabase/migrations/20260917000000_create_invoices.sql)
2. [`backend/supabase/migrations/20260917000001_add_settlement_evidence.sql`](backend/supabase/migrations/20260917000001_add_settlement_evidence.sql)
3. [`backend/supabase/migrations/20260920000000_add_smart_spend_metadata.sql`](backend/supabase/migrations/20260920000000_add_smart_spend_metadata.sql)
4. [`backend/supabase/migrations/20260921000001_add_merchant_integration.sql`](backend/supabase/migrations/20260921000001_add_merchant_integration.sql)
5. [`backend/supabase/migrations/20260922000000_mainnet_phase2_reconciliation.sql`](backend/supabase/migrations/20260922000000_mainnet_phase2_reconciliation.sql) — isolated mainnet preparation/receipt tables; previously applied to the live project.
6. [`backend/supabase/migrations/20260923000000_mainnet_submission_tracking.sql`](backend/supabase/migrations/20260923000000_mainnet_submission_tracking.sql) and [`backend/supabase/migrations/20260923000001_mainnet_atomic_handoff_finalization.sql`](backend/supabase/migrations/20260923000001_mainnet_atomic_handoff_finalization.sql) — isolated chain-196 handoff/submission evidence and atomic settlement-plus-invoice finalization. The current files passed the final seven-migration replay on verified non-live Neon; the current ACL matrix, RLS, triggers, indexes, A–E backfill, atomic finalization, idempotency, rollback, and cleanup passed. Live Supabase was not contacted during that replay. Earlier migration versions are applied live; these current file revisions are not. The legacy trigger-only `set_invoices_updated_at()` `PUBLIC EXECUTE` caveat is accepted for this release. The manual buyer-signed handoff is implemented; do not use it for a real payment before final review.
7. [`backend/supabase/migrations/20260924000000_mainnet_handoff_invoice_unique.sql`](backend/supabase/migrations/20260924000000_mainnet_handoff_invoice_unique.sql) — adds database-unique `mainnet_handoffs.invoice_id` after checking for existing duplicate invoice IDs. It was applied successfully to the live PortPay Supabase project after a precheck found 0 handoff rows and 0 duplicate `invoice_id` values. The live unique constraint is present and valid; existing `preparation_id` uniqueness and the handoff primary key remain intact. RLS/ACL were unchanged and no evidence rows were modified. The invoice-level uniqueness blocker is cleared. This migration did not replay the September 23 migrations.

The first migration creates `public.invoices`; the next migrations add historical settlement evidence, Smart Spend metadata, and optional merchant order references. Mainnet migrations add immutable preparation, handoff, submission, and atomic reconciliation records plus `payment_network`. All keep row-level security enabled. PortPay uses the server-only `SUPABASE_SERVICE_ROLE_KEY`; no browser Supabase client is used. Earlier September 22/23 migration versions are applied to live Supabase, and its equivalent schema, least-privilege ACL, RLS, function, trigger, index, and evidence state has been independently verified. The current September 23 migration files passed the final replay on verified non-live Neon. Do not rerun migrations against live Supabase merely because repository documentation changed.

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

With OKX Wallet installed and unlocked, click **Connect OKX Wallet** and connect on X Layer Mainnet (chain 196). The merchant dashboard enables invoice creation only on chain 196 and loads that wallet's persisted invoices from the backend.

After creating an invoice, use **Copy link** to share `/pay/<uuid>`. The merchant can keep `/merchant/invoices/<uuid>` open to monitor status and copy the link again. Opening `/pay/<uuid>` in another tab loads Mainnet checkout. The buyer can review the prepared payment and, only when the persisted preparation has exact allowance and passes fresh readiness recheck, manually confirm the exact transaction in OKX Wallet. Submission alone does not pay or mark the invoice paid; only verified reconciliation does. Real Mainnet use awaits final review and separate authorization. Legacy testnet invoices remain labeled and render their historical receipts, but cannot select the testnet adapter in production.

From the dashboard, **Smart Payment History** has separate merchant and buyer views. Merchant view emphasizes stablecoin received; buyer view emphasizes the asset spent. Both views load only `paid` records from persisted Supabase evidence, show the related invoice and timestamp, and use the explorer matching the stored payment network. Historical testnet receipts remain labeled Legacy X Layer Testnet.

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

The backend exposes the health route, Mainnet invoice API, isolated mainnet preparation/recheck/submission/reconciliation routes, and receipt/history queries. The chain-1952 quote/reconcile routes are registered only in test or explicitly enabled non-production development:

- `POST /api/invoices` with `{ "title", "amountUsdt0", "merchantAddress" }` creates a pending invoice.
- `GET /api/invoices?merchantAddress=<wallet>` lists invoices for the connected merchant wallet.
- `GET /api/invoices/<uuid>` resolves the shareable invoice link target.
- `POST /api/invoices/<uuid>/mainnet/approval-preparation` returns preparation data after authenticated backend preparation/preflight; the Mainnet Pay path reuses the existing exact allowance and does not request another approval.
- `POST /api/invoices/<uuid>/mainnet/readiness-recheck`, `/mainnet/submitted`, and `/mainnet/reconcile` use persisted preparation/handoff evidence. The frontend presents the exact transaction for manual wallet signing only after READY; the backend does not sign or broadcast. Real Mainnet use awaits final review.
- `POST /api/invoices/<uuid>/quote` and `/reconcile` are internal testnet regression routes only; production does not register them.
- `GET /api/history/merchant?merchantAddress=<wallet>` returns paid invoices whose persisted merchant matches the wallet.
- `GET /api/history/buyer?buyerAddress=<wallet>` returns paid invoices whose persisted buyer matches the wallet.
- `POST /api/integration/invoices` creates an invoice for the authenticated server-side merchant credential and accepts an optional `externalOrderReference`.
- `GET /api/integration/invoices/<uuid>/status` returns the authenticated merchant's verified status, hosted payment URL, and settlement hash after payment.

Integration credentials use `Authorization: Bearer <PORTPAY_TEST_API_KEY>` and are never accepted from browser configuration. If a webhook URL and secret are configured, the backend sends a signed `payment.confirmed` event only after the same canonical receipt/confirmation-depth reconciliation used by the dashboard. Webhook delivery has bounded in-process retries and idempotency headers; delivery failure does not change a verified payment back to pending.

The API validates titles, positive USD₮0 amounts with up to 6 decimals, EVM wallet addresses, UUIDs, and transaction hashes. It returns a clear unavailable response when Supabase/Postgres or mainnet preparation configuration is not ready. It never marks an invoice paid from client input alone. Mainnet paid state requires the isolated verifier and atomic reconciliation path; internal testnet reconciliation requires a successful chain-1952 `SettlementExecuted` receipt. History endpoints filter to `paid` server-side.

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

The integration layer calls the same invoice repository and payment state used by the dashboard, above both network-specific adapters. Mainnet is the normal product default. The retained `TestnetSettlementAdapter` is restricted to regression tests, legacy receipts, and explicitly enabled non-production tooling; external merchant integration cannot select it.

### Nested product documentation

The running app includes `/docs` pages for the product overview, getting started, how the settlement flow works, merchant integration, and testnet boundaries. The merchant integration page is the recommended reference for a business that wants PortPay inside its existing checkout.

### Canonical reusable messaging

- Product: “PortPay turns tokenized portfolios into a payment method. Customers spend the assets they already hold. Merchants keep pricing and receiving payments in stablecoins.”
- Business: “Add PortPay to your existing checkout and let customers pay from their tokenized stock portfolio while your business receives stablecoins.”
- Integration: “Businesses can use PortPay as a hosted payment link or integrate the invoice/payment flow directly into their own website.”
- Demo close: “PortPay turns tokenized portfolios into a payment method. Customers spend the assets they already hold, businesses keep receiving stablecoins, and merchants can plug PortPay directly into their existing checkout.”

### Current Mainnet-first product walkthrough

1. Start backend and frontend independently, then open `http://localhost:5173/merchant` in the merchant tab.
2. Connect the merchant OKX Wallet on X Layer Mainnet (chain 196) and create an invoice denominated in real USD₮0.
3. Copy the generated `/pay/<uuid>` link into a separate buyer tab. Checkout presents the invoice and supported mainnet portfolio assets.
4. Connect the buyer OKX Wallet on chain 196. Pay requires the existing exact wNVDAx allowance; the Pay flow does not offer or request a new token approval. Any approval setup is separate from Pay.
5. After final Sol High review, click Pay only when the same-calldata readiness recheck returns READY, then manually confirm the exact transaction in OKX Wallet. This implementation has no live payment proof yet; only verified reconciliation may show the invoice as paid.
6. Historical testnet receipts remain available with their original testnet network and explorer identity; chain 1952, DemoAAPL/DemoNVDA, and test USD₮0 are internal regression/history only.

The product remains explicit about execution status: Mainnet is the only normal product network. The manual Pay handoff is implemented, but real Mainnet use must wait for final Sol High review and deliberate buyer wallet confirmation. Historical testnet assets are not real shares or backed securities and are not part of the normal experience.

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

- Supabase/Postgres credentials and the invoice/history migrations are required for persisted invoices. Earlier September 22/23 migration versions are applied live and the ACL correction/audit passed. The current September 23 files passed the final seven-migration replay on verified non-live Neon; live Supabase was not contacted during that replay, and those current file revisions have not been applied live. The ACL/RLS/trigger/index, A–E backfill, atomic finalization, idempotency, rollback, and cleanup checks passed. The legacy trigger-only `set_invoices_updated_at()` `PUBLIC EXECUTE` caveat is accepted for this release. The manual Mainnet Pay handoff is implemented, but real payment use must wait for final review and separate authorization.
- The recorded deployment addresses and payment evidence are for X Layer Testnet only. The historical Phase 3 deployment transaction hashes were not retained in the committed workspace; the Phase 5 deployment and funding hashes are recorded above.
- A quote signer private key is required server-side; it must correspond to the signer configured in the deployed settlement contract. Whoever controls that key can authorize spending the contract's prefunded USD₮0 balance through valid quotes, so use a dedicated restricted demo key and protect it as a settlement authority. Changing the signer requires a new settlement deployment.
- DemoAAPL and DemoNVDA quote math uses explicit `250.00 USD` and `180.00 USD` demo reference prices. Asset amounts are rounded upward in base units so the quoted amount fully covers the exact USD₮0 invoice; this is demo math, not market data or an oracle.
- Smart Spend defaults to a 50/50 DemoAAPL/DemoNVDA target, uses onchain balances and configured demo prices, prefers an eligible overweight asset that can cover the full invoice, and never auto-executes. It is not financial advice.
- Smart Spend choice and reason in receipts/history are checkout-reported offchain metadata; the backend checks a reported recommended asset against the onchain settlement asset, but cannot independently prove that the buyer used the recommendation or that the reason matched an earlier portfolio snapshot. Settlement asset and amounts are verified from the canonical receipt.
- Settlement liquidity must be funded manually with official testnet USD₮0 before a buyer can pay again.
- The merchant wallet address is supplied by the connected frontend wallet but is not cryptographically authenticated by the Phase 2 API; authentication/authorization is deferred.
- The Supabase migration enables row-level security and the backend uses the server-only service-role key. No browser client or direct anon-key database access is enabled.
- Testnet settlement, demo tokens, and testnet Builder Code are internal regression/historical compatibility only. They are not exposed by normal production routes. The older testnet code typos `kob1klgsg6infkg3` and `2j3pbm1a4djso11j` must not be used.
- The public X Layer Testnet RPC may be rate limited, and wallet connection/balance reads require an installed OKX Wallet browser extension and a connected account.
- Receipt reconciliation requires a canonical receipt block and two confirmations by default; this is a small testnet safety check, not a claim of protocol finality. Receipt/history views are paid-only and currently load on wallet/view changes rather than through a realtime Supabase subscription.
- DemoAAPL and DemoNVDA are ordinary test ERC-20s, not official xStocks or securities backed by company shares. Their contracts and live proofs are historical/internal only.
- Mainnet wallet submission is available only through the manual Pay handoff after same-calldata readiness recheck; the exact existing allowance is reused and no second approval is requested. No automatic send or backend signing/broadcast exists. Real Mainnet use requires final GPT-5.6 Sol High review and manual wallet confirmation.
- Normal routes and new invoices use chain 196 without `?network=mainnet`. Chain 1952 is available only behind explicit local/test gates and for legacy receipt identity. Production does not register `TestnetSettlementAdapter` routes.
- Mainnet receipt history uses the mainnet explorer. Legacy rows with a null `payment_network` remain legacy-testnet compatible unless the invoice is already paid and its transaction hash matches persisted chain-196 settlement evidence tied to its preparation; preparation existence alone never changes network identity. Explicit supported network values are preserved, and unknown non-null values fail closed.

### Disposable migration validation status

- The `20260922000000` → `20260923000000` → `20260923000001` mainnet migration chain passed in order on the confirmed disposable Neon PostgreSQL database. Rollback behavior, unique constraints, privileged-function permissions, exact-retry idempotency, duplicate/concurrent-claim rejection, and the corrected A–E `payment_network` overlap regression passed; all synthetic fixture rows were removed.
- PostgreSQL grants `EXECUTE` on newly created functions to `PUBLIC` by default unless revoked. Supabase may also apply broad default table grants. The current September 23 migration revisions explicitly revoke evidence-table grants from `PUBLIC`, `anon`, `authenticated`, and `service_role` before granting only required access. The live correction changed per-table grants only; future default privileges were not changed. Keep auditing new tables and functions explicitly.
- The current September 23 migration files passed in order on a verified non-live Neon database as part of the seven-migration replay. The current ACL matrix, RLS, triggers, indexes, corrected A–E network-backfill regression, atomic finalization, idempotency, rollback behavior, and cleanup all passed. Live Supabase was not contacted during that replay. The legacy trigger-only `set_invoices_updated_at()` `PUBLIC EXECUTE` caveat is accepted for this release. The earlier migration versions and separate live `service_role` ACL correction were previously applied and verified. The separate `20260924000000_mainnet_handoff_invoice_unique.sql` migration was subsequently applied successfully live: precheck found 0 handoff rows and 0 duplicate `invoice_id` values; its unique constraint is present and valid; preparation uniqueness and the handoff primary key remain intact; RLS/ACL were unchanged; and no evidence rows were modified. The invoice-level uniqueness blocker is cleared. Buyer-signed Mainnet swap execution is implemented, but no real Mainnet swap has been sent; real payment still awaits final review and separate authorization.
- The buyer-signed Pay handoff is implemented; no mainnet transaction has been sent by this implementation. Backend signing/broadcast and automatic sending remain disabled.

## Source-of-truth and phase discipline

`AGENTS.md` defines repository workflow and approval gates. `PORTPAY_SPEC.md` defines the product, architecture, scope, and phased build plan. Phases 0–7 and their historical chain-1952 proofs are complete. Mainnet Phase 1/2 provide the Mainnet-first product configuration, isolated OKX V6 preparation, exact-allowance buyer handoff, and database-backed reconciliation. The manual Pay handoff is implemented; a real Mainnet payment remains subject to final GPT-5.6 Sol High review, buyer confirmation, and canonical backend reconciliation.
