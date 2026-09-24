# PortPay — Source-of-Truth Product and Technical Specification

**Status:** Current source of truth
**Last updated:** 2026-09-24
**Repository:** <https://github.com/london160771/PortPay>  
**Builder Kit reference:** <https://www.okx.com/learn/okx-dev-day-builder-kit>

This document is the product, architecture, scope, and phase-plan authority for PortPay. `AGENTS.md` is the execution and repository-workflow authority. If implementation, README, or conversation notes conflict with these documents, stop and resolve the documents first; do not silently invent a third interpretation.

## 1. Product identity

**Product:** PortPay  
**Tagline:** Spend your portfolio. Merchants get stablecoins.  
**Short description:** PortPay lets buyers pay with tokenized portfolio assets while merchants receive stablecoins on X Layer.

### Current network policy (2026-09-24)

PortPay is now **Mainnet-first**. X Layer Mainnet (chain ID `196`) is the only network shown or selected by normal product routes. `/merchant`, `/pay/:invoiceId`, merchant invoice details, receipts, and history resolve to the mainnet product configuration without a query-string network selector. Mainnet uses supported wNVDAx/wAAPLx assets, real USD₮0, and the separately registered mainnet Builder Code.

This product default does **not** mean mainnet payments are fully live. The buyer-signed Pay handoff is implemented: it may submit only the exact persisted transaction after a fresh same-calldata server readiness recheck and explicit buyer wallet signature. It does not request another approval or send automatically. The invoice-level handoff uniqueness blocker is cleared by the successfully applied and verified live migration `20260924000000_mainnet_handoff_invoice_unique.sql`. Real Mainnet use must still wait for final GPT-5.6 Sol High review and separate user authorization; only verified backend reconciliation may mark an invoice paid. Backend signing/broadcast remains prohibited. No real Mainnet swap has been sent.

X Layer Testnet (chain ID `1952`), `TestnetSettlementAdapter`, DemoAAPL/DemoNVDA, test USD₮0, and the testnet Builder Code are retained only for automated regression, historical receipt compatibility, and explicitly enabled internal development/test tooling. They must not appear in normal production routes or product UI. Legacy testnet payment records remain readable and retain their testnet explorer/network identity.

The testnet adapter returns verified settlement facts without assigning the invoice network. The shared invoice-reconciliation boundary attaches `x-layer-testnet` only after confirming both a chain-1952 invoice and `TestnetSettlementAdapter`; this metadata boundary does not alter adapter settlement behavior.

### Problem

Users may hold tokenized stocks or other portfolio assets onchain, but merchants want a simple stablecoin amount. Today, paying with a portfolio asset usually requires the buyer to sell or swap it manually before sending a separate stablecoin payment. That is too much friction for ordinary commerce.

### Solution

A merchant creates an invoice denominated in stablecoins. The buyer opens a payment link, selects a supported portfolio asset, and confirms payment. PortPay settles the payment so the merchant receives the requested stablecoin and both sides receive a verifiable receipt.

The product is a payment layer, not a marketplace, exchange, trading bot, or investment adviser.

## 2. Scope that is locked for the MVP

The following are required features, not optional ideas:

1. **Merchant invoice and payment-link flow** — a merchant enters a product or service name and stablecoin amount, creates an invoice, and receives a shareable payment link. A QR presentation may be added if it is trivial, but the payment link is required.
2. **Buyer checkout** — the buyer opens the link, connects a wallet, sees the amount due and supported assets, selects an asset, reviews the quote, and approves payment.
3. **Mainnet portfolio payment architecture** — the buyer-signed handoff is implemented using isolated `OKXDEXMainnetAdapter` preparation and the persisted transaction; real Mainnet use remains held pending final review, required migrations in the target environment, and explicit authorization.
4. **Merchant stablecoin receipt** — the merchant dashboard updates to show payment received, amount received, asset spent, status, and transaction link.
5. **Smart Spend** — deterministic portfolio-aware recommendation of which supported asset to spend. This begins with `DemoAAPL` and adds `DemoNVDA` only after the core payment flow works.
6. **Smart Payment History** — a clear history of what the buyer spent, what the merchant received, why Smart Spend made a recommendation, payment status, and the X Layer transaction.
7. **OKX/X Layer Builder Codes** — PortPay-generated eligible transactions must carry the registered Builder Code attribution using the current OKX/X Layer Builder Codes mechanism, including ERC-8021 requirements where applicable.
8. **Two-sided flow** — a merchant creates an invoice and shares hosted buyer checkout; the UI must not imply a completed payment before wallet submission and verified canonical reconciliation.

### Asset/network history and retained regression scope

- **Phase 1 — Wallet + Demo Assets:** prepare one ordinary EVM ERC-20 demo asset named `DemoAAPL` and the wallet/balance foundation needed to use it later.
- **Phase 3 — Core Settlement:** implement the smallest safe `PortPaySettlement` flow around the configured demo asset and official testnet `USD₮0`.
- **Smart Spend phase:** add a second ordinary EVM ERC-20 demo asset named `DemoNVDA` so a recommendation has a meaningful choice.
- **Do not initially create:** `DemoSPY`, a large asset catalog, official testnet xStocks, or a liquidity pool.
- `DemoAAPL` and `DemoNVDA` are clearly labeled demo assets and must never be presented as backed by Apple or NVIDIA shares.
- Mainnet product assets are wNVDAx/wAAPLx and official X Layer Mainnet USD₮0.
- DemoAAPL/DemoNVDA and official testnet USD₮0 remain internal regression/history assets only. Do not create a replacement stablecoin.

## 3. Product experience

### Required screens

1. **Landing page**
   - Explains: “Spend tokenized assets. Merchants receive stablecoins.”
   - Primary actions: **Create Invoice** and **Pay Invoice**.
   - Uses a clean fintech/payment visual language with minimal Web3 jargon.

2. **Merchant dashboard**
   - Wallet connection.
   - Total payments and recent invoices.
   - Invoice status and amount received in `USD₮0`.
   - Entry point to create an invoice.

3. **Create Invoice**
   - Product or service name.
   - Amount due in `USD₮0`.
   - Optional expiry consistent with the settlement contract’s quote expiry.
   - Creates a payment link and exposes a copy/share action.

4. **Buyer checkout**
   - Invoice/product name and amount due.
   - Wallet connection.
   - Supported balances: mainnet wNVDAx/wAAPLx and real USD₮0 where useful for display.
   - Manual asset selection and Smart Spend recommendation when Smart Spend is available.
   - A clear quote such as:

     ```text
     You spend: 0.0800 wNVDAx
     Merchant receives: 20.00 USD₮0
     Network: X Layer Mainnet
     ```

   - Mainnet network and supported-asset labels; no demo/testnet assets in normal UI.
   - Reuse the existing exact allowance; the manual Pay action is available only after a fresh server readiness recheck returns READY. No payment is confirmed until canonical backend reconciliation succeeds.

5. **Payment receipt and Smart Payment History**
   - Success state with buyer asset amount, merchant stablecoin amount, invoice, status, timestamp, and transaction hash.
   - **View on X Layer Explorer** action.
   - Buyer and merchant history views where practical.
   - For Smart Spend payments, show the recommendation and a short deterministic reason, for example: “DemoNVDA was 11 percentage points above its target allocation.”

### Canonical two-tab demo

The intended demo is not one user pretending to be both sides in one tab:

1. **Merchant tab:** connect merchant wallet, create an invoice for a small amount such as `20 USD₮0`, copy the payment link, and leave the dashboard open.
2. **Buyer tab:** open the payment link, connect the buyer wallet, choose `DemoAAPL` manually or use Smart Spend when available, review the quote, and approve/pay.
3. **Merchant tab:** show the dashboard changing to **Payment received**, including the `USD₮0` amount, asset spent, and X Layer transaction.
4. Open the receipt/history view to show the same transaction from the product side.

## 4. Smart Spend

Smart Spend is a required MVP feature, but it does not require an AI model.

### Initial behavior

- Read the buyer’s balances and current portfolio allocation from the connected wallet and the demo reference prices.
- Compare current allocation with user-configured target allocation or simple target rules.
- Prefer an overweight position, protect an underweight position, and explain the choice.
- Show the recommended asset, the reason, and the estimated amount required.
- Let the buyer choose **Pay manually** or **Smart Pay** after reviewing the recommendation.

Example:

```text
DemoAAPL: 23% current / 30% target
DemoNVDA: 46% current / 35% target

Recommended: DemoNVDA
Reason: DemoNVDA is currently 11 percentage points above target.
```

`DemoNVDA` is introduced in the Smart Spend phase, not as a prerequisite for the first successful settlement. The recommendation is a demo allocation aid, not financial advice, and the UI must say so.

## 5. Smart Payment History

Smart Payment History is more than a list of hashes. Each completed or attempted payment record should capture, when available:

- invoice ID and product/service name;
- buyer and merchant wallet addresses;
- requested stablecoin and amount;
- asset spent and amount;
- demo reference price used for the quote;
- Smart Spend recommendation and reason, or “manual selection”;
- status: created, awaiting payment, pending, confirmed, expired, failed, or rejected;
- transaction hash, block/explorer link, and timestamps;
- contract and network identifiers;
- `payment_network` and network-correct explorer identity. Legacy testnet/demo records remain clearly labeled as historical testnet records; new normal product records use mainnet.

The history should make it easy to answer: **what did the buyer spend, what did the merchant receive, why was that asset selected, and which X Layer transaction proves it?**

## 6. Technical architecture

### Locked baseline stack

- **Frontend:** React + Vite.
- **Wallet and chain client:** `wagmi` + `viem`.
- **Backend:** Node.js + Express + TypeScript.
- **MVP persistence:** Supabase/Postgres behind a repository/data-access boundary. Supabase is the required hosted Postgres provider for PortPay; SQLite is not an implementation option.
- **Product chain:** X Layer Mainnet, chain ID `196`.
- **Internal regression chain:** X Layer Testnet, chain ID `1952`, not exposed by production routes or normal UI.

### Components

| Component | Responsibility |
|---|---|
| React client | Landing, merchant dashboard, invoice creation, buyer checkout, receipt, history, wallet UX |
| Node backend | Invoice/payment-link metadata, demo reference prices, quote creation/validation, status indexing, history metadata |
| `DemoAAPL` | Small ordinary EVM ERC-20 test asset for the first complete flow |
| `DemoNVDA` | Second small ordinary EVM ERC-20 test asset added for Smart Spend |
| `PortPaySettlement` | Minimal onchain testnet settlement contract |
| Official testnet `USD₮0` | Merchant settlement asset; do not replace with an app-created stablecoin |
| `TestnetSettlementAdapter` | Internal chain-1952 regression and legacy-compatibility adapter; never selected by normal production routes |
| `OKXDEXMainnetAdapter` | Isolated chain-196 adapter for supported tokenized assets and direct real-USD₮0 merchant routing; the buyer wallet handoff is manual and same-calldata-rechecked, with real Mainnet use held until final review |
| Builder Code integration | App-side attribution for eligible PortPay-generated transactions |

### Canonical names

Use these names exactly in code, docs, UI copy, and reports:

- Product: `PortPay`.
- Main settlement contract: `PortPaySettlement`.
- Testnet adapter: `TestnetSettlementAdapter`.
- Future mainnet adapter: `OKXDEXMainnetAdapter`.
- First demo asset: `DemoAAPL`.
- Smart Spend asset: `DemoNVDA`.
- Mainnet stablecoin: `USD₮0`.
- Internal regression tokens: `DemoAAPL`, `DemoNVDA`, and testnet `USD₮0`.

`PortfolioPay` is an obsolete working name from early ideation. Do not introduce it in new files, identifiers, UI, contract names, or README text.

## 7. Retained internal testnet settlement design

Public OKX DEX routing is not assumed to be available for X Layer Testnet. The retained chain-1952 regression implementation uses **portfolio settlement**, also describable as **testnet simulated RWA conversion**, rather than a DEX swap. It is not the normal product payment path and must not be selected by production routes.

### Testnet flow

```text
Buyer wallet
    |
    | approve DemoAAPL
    v
PortPaySettlement
    | receives DemoAAPL
    | transfers prefunded official USD₮0
    v
Merchant wallet
```

The contract must:

- accept only configured demo asset addresses and the configured official testnet `USD₮0` address;
- bind a payment to a unique invoice ID/nonce;
- validate merchant, token, amounts, chain/contract context, and quote expiry;
- prevent replay or duplicate settlement for the same invoice;
- transfer the buyer asset using a safe ERC-20 `transferFrom` path after approval;
- transfer the exact quoted `USD₮0` amount to the merchant;
- emit a receipt event containing invoice ID, buyer, merchant, asset, asset amount, stablecoin, stablecoin amount, and relevant quote/payment identifiers;
- fail atomically if a required transfer or validation fails.

The contract is not a general-purpose vault. Do not add arbitrary user withdrawals, a marketplace, an AMM, or a broad asset registry for the MVP.

### Price and quote rules

- The backend may maintain deterministic demo reference prices such as `DemoAAPL = 250 USD` and `DemoNVDA = 180 USD`.
- The UI must label these as **demo reference prices**, not market prices or oracle data.
- Do not build an oracle system for the MVP.
- A quote must be short-lived and bound to invoice ID, asset, stablecoin, amounts, merchant, chain ID, settlement contract, and expiry. The implementation may use a signed quote or another explicit validation mechanism, but must not trust arbitrary client-supplied amounts.
- Read token decimals from contract metadata/configuration and test conversions carefully. Do not assume that every stablecoin uses the same decimals as the demo ERC-20s.
- Contract and integration tests must cover rounding, insufficient balance, insufficient allowance, expired quotes, replayed invoice IDs, wrong asset, wrong merchant, and duplicate submissions.

### What is onchain vs. offchain

**Onchain:** asset ownership, stablecoin settlement, the actual payment, and the compact receipt event.  
**Offchain:** merchant/profile metadata, product names, payment-link records, invoice UI metadata, demo prices, status indexing, and searchable Smart Payment History metadata.

## 8. OKX/X Layer Builder Codes

Builder Codes are a required OKX integration, not a cosmetic mention.

- Register/use the correct PortPay Builder Code according to current OKX instructions.
- Apply it to every eligible PortPay-generated transaction in the app’s transaction-building path, including testnet transactions where the current Builder Kit supports them.
- Use the current ERC-8021 encoding/attribution mechanism where applicable.
- Do not assume OKX Wallet will inject the attribution automatically; the app must attach it according to the official mechanism.
- Keep the Builder Code identifier/configuration outside source control when it is environment-specific, and document the active value and verification steps in `README.md`.
- Add a test or manual verification that the submitted transaction carries the expected attribution.
- Do not invent a placeholder code and call the integration complete.

## 9. Mainnet product path and execution gate

The mainnet path is the normal PortPay product configuration and remains isolated from the retained testnet regression path.

`OKXDEXMainnetAdapter` uses the OKX DEX Swap API on X Layer Mainnet to prepare a route from a supported tokenized asset into real USD₮0 directly to the merchant, with shared invoice, receipt, and history layers above it. Mainnet is selected by normal routes; the adapter boundary remains network-specific.

### Mainnet Phase 1 — isolated adapter preparation

The backend mainnet adapter remains non-signing and non-broadcasting. It prepares authenticated chain-196 quotes and transaction data, validates direct merchant-recipient execution, and prepares ERC-8021 suffixes. It must not fund wallets, deploy contracts, register a mainnet Builder Code, or modify the proven testnet settlement path. The buyer-signed Pay handoff is implemented separately: it can pass only the exact persisted transaction to the connected wallet after a fresh same-calldata readiness recheck. The buyer must confirm manually; real Mainnet use stays held until final review and explicit user authorization.

Any future mainnet swap proof is allowed only when all of the following are true:

- the user explicitly approves the mainnet test and provides/approves the funds;
- the official xStock asset and OKX route are currently available and verified;
- GPT-5.6 Sol High has completed the required pre-mainnet review;
- wallet, slippage, approval, amount, contract, and failure handling are documented;
- the README clearly distinguishes mainnet proof from the testnet demo.

The buyer-signed Pay handoff is implemented but is not a claim that Mainnet settlement is live. A buyer may manually submit only the persisted transaction returned by a fresh server recheck; there is no automatic send or backend signing/broadcast. Real Mainnet use must wait for final GPT-5.6 Sol High review, and an invoice remains pending until canonical reconciliation verifies settlement. Testnet remains available only for automated regression, historical receipts, and explicit internal tooling.

### Mainnet Phase 2 — Builder Code registration, preflight, and receipt design

Mainnet Phase 2 introduced the isolated preflight/reconciliation architecture; the current buyer-signed Pay handoff uses that persisted preparation without changing the testnet flow. The backend remains non-signing/non-broadcasting. The design includes:

- official mainnet Builder Code registration guidance and independent registry/payout verification;
- a deterministic chain-196 preflight for prepared OKX approval and swap transactions;
- read-only buyer asset, allowance, OKB gas, and merchant USD₮0 balance checks;
- read-only `eth_call` simulation of the exact attributed approval and swap calldata;
- a future mainnet receipt/reconciliation verifier and separate payment-state model.

The existing narrow buyer-wallet approval preparation remains separate: the current Mainnet Pay flow must not call it or request an approval. Pay requires the exact prepared wNVDAx allowance to already exist. If separately used, `POST /api/invoices/:invoiceId/mainnet/approval-preparation` accepts only the connected buyer address, uses the pending invoice and backend-fixed proof input `4800000000000000` wNVDAx base units, obtains fresh authenticated OKX data, runs the existing complete preflight, and persists immutable preparation. It returns approval bytes only after Stage A simulation yields `APPROVAL_REQUIRED`; client-supplied amount, token, spender, quote, or calldata are never authority. The buyer must manually confirm through the connected wallet, and the frontend verifies the successful receipt and exact reread allowance. Testnet remains inaccessible from normal production routes.

The official OKX Builder Codes documentation requires mainnet builders to use the OKX Developer Portal: connect the owning wallet, verify the address, and create the Builder Code. The documented `registerAuto` contract path is for X Layer Testnet registration; PortPay must not call it for mainnet. The official mainnet registry is `0xd6c426f9c077358735622ae5a83468dc0510823b`. PortPay converts the exact 16-character code to the deterministic registry token ID and reads `payoutAddress(uint256)` on chain `196`. A configured mainnet code is accepted only when its registry payout matches `PORTPAY_MAINNET_BUILDER_PAYOUT_ADDRESS`. These non-secret config values must match the separately registered, independently verified mainnet code/payout; never reuse the testnet code.

Preflight must fail closed unless chain `196`, buyer, merchant, invoice, input/output tokens, exact input, minimum output, slippage, quote freshness, router, spender, approval calldata, swap calldata, zero native value, read-only balances, gas, simulations, and a verified mainnet Builder Code all pass. Read balances and token decimals at a pinned block and require 18 decimals for wNVDAx/wAAPLx and 6 for mainnet USD₮0. Stage A reads allowance at the pinned block first. Unless it equals the exact input amount, simulate only the exact attributed approval, validate any non-empty ERC-20 return data (`true` required), and return `APPROVAL_REQUIRED`; below, above, and unlimited allowances are rejected, and no swap gas estimate or simulation runs. Stage B is reachable only when the pinned allowance equals the exact input; it estimates gas from the exact attributed approval and swap calldata, applies a 20% safety margin, simulates the exact swap, and evaluates OKB readiness. Persist immutable preparation evidence before any future wallet approval can be considered. The readiness endpoint returns exact persisted wallet fields only after the additional handoff recheck; backend `READY` never signs or broadcasts.

The fixed `$1.00` Mainnet proof uses exactly `0.0048 wNVDAx` (`4800000000000000` base units) and `1.5%` slippage; the adapter rejects values above `1.5%`. The final fresh swap's `minimumReceive` must remain at least the invoice amount (`1.000000 USD₮0`). A proof is `READY` only with the exact pinned allowance, a fresh authenticated preparation, verified direct merchant receiver and Builder Code, successful exact attributed gas estimation and `eth_call`, and sufficient buyer OKB. Wallet confirmation remains manual; no automatic swap broadcast is enabled.

For OKX V6 Classic Swap, the quote and swap references do not share a documented immutable `quoteId`: the official quote response lists route/economic fields, and the swap API accepts the swap intent and returns a fresh `routerResult` plus executable `tx`; neither reference documents `quoteId` as a cross-endpoint correlation guarantee. Treat any returned `quoteId` as diagnostic metadata only. Backend preflight must fetch a fresh `/swap` response through its authenticated server-side API client immediately before accepting/persisting the preparation; caller-supplied swap objects are not execution authority. Keep an unforgeable server-process provenance marker for the freshly produced preparation and persist the authenticated response evidence plus a deterministic hash of that response. Bind it to the invoice/preview intent by chain, buyer, merchant receiver, input/output token addresses, exact input, slippage, invoice acceptance amount, and freshness. The authenticated swap response is authoritative for route, router target, expected output, minimum receive, zero native value, and exact calldata. Decode and validate those fields, requiring the decoded recipient and amounts to match. Every route leg must form one ordered connected path: the first input is the selected asset, each leg output equals the next leg input, and the last output is official USD₮0. Reject disconnected, reordered, duplicate/unrelated, contradictory, or malformed route metadata; accept multi-hop routing only when the response explicitly represents one connected route. Accept a changed route only when the fresh authenticated response is internally valid and all bound economic/participant fields still match; reject token/input changes, recipient changes, unacceptable slippage, nonzero native value, and minimum receive below the invoice amount. Store both preview and authenticated final swap evidence, including the deterministic connected-route fingerprint, preparation timestamp/deadline, authenticated response hash, and exact attributed approval/swap calldata hashes. Receipt reconciliation must continue to compare transaction input byte-for-byte with the persisted attributed swap calldata and use the final preparation's router and minimum receive.

The mainnet receipt verifier must require byte-for-byte match between transaction input and persisted attributed swap calldata; configured, prepared, and transaction-decoded Builder Code must match exactly, and the registry payout must match. It must verify successful chain-196 receipt, buyer sender, prepared OKX router, canonical receipt and parent blocks, configured confirmation depth, exact balance deltas read at `receiptBlock - 1` and `receiptBlock`, merchant output meeting both the persisted minimum and invoice amount, quote/invoice binding, and an atomic database claim plus invoice-paid transition. Caller-supplied balances are never authority. Frontend success state is never sufficient. Mainnet states remain separate (`pending`, `prepared`, `ready`, `submitted`, `confirming`, `paid`, `failed`, `expired`); testnet behavior is unchanged.

OKX's official [Classic Swap API documentation](https://web3.okx.com/en/onchainos/dev-docs/trade/dex-swap) explicitly warns that a Uni V3 route may consume only part of the payment token and that the router refunds the remainder when pool liquidity is depleted. Therefore `exactIn`, encoded `fromTokenAmount`, or absence of refund metadata does not prove the buyer's net debit equals the requested input. Treat prepared input as a maximum debit. Reconcile the actual positive net debit from transaction-specific input-token `Transfer` logs, allow only a router-to-buyer refund, require the net to match the canonical block-pinned before/after balance delta, and reject malformed, unexplained, non-router, or excessive token movement. Accept payment only when the merchant's verified stablecoin transfer and balance increase meet both `minimumReceive` and the invoice amount. Record actual net debit in the receipt/history; never report the maximum as spent when a refund occurred.

The Phase 2 reconciliation migration is `backend/supabase/migrations/20260922000000_mainnet_phase2_reconciliation.sql`; it must be applied before mainnet reconciliation is used. The manual buyer-signed handoff is implemented, but a real Mainnet payment remains prohibited until all controls pass final review, the mainnet Builder Code is registered/configured and verified, required migrations are applied, and the user explicitly authorizes the payment. No migration may be applied to the live database without separate user direction.

Mainnet reconciliation uses a separate `/api/invoices/:invoiceId/mainnet/reconcile` path and does not reuse the chain-1952 route or `TestnetSettlementAdapter`. The request carries only invoice ID, preparation ID, and transaction hash; the server derives all authority from immutable preparation/submission evidence. PortPay's Mainnet preparation TTL defaults to 120 seconds (maximum 120), starting at the final authenticated swap preparation timestamp. The quote must still be fresh when that response is accepted. Executable preparation expiry is `min(preparedAt + TTL, encoded calldata deadline)`; PortPay must never extend the displayed expiry or mutate the transaction deadline. The Classic Swap request schema has no caller-controlled deadline parameter. On Pay click, if the candidate preparation has less than 120 seconds remaining, checkout requests a fresh authenticated preparation before any wallet prompt and uses that exact persisted preparation for final readiness. If the underlying calldata deadline is shorter than 120 seconds, this is a just-in-time refresh, not a 120-second validity claim. The read-only final readiness check receives buyer identity and validates the same persisted preparation, exact allowance, balances, Builder Code, exact attributed gas estimate, and exact calldata simulation; it still requires at least 30 seconds of preparation lifetime after all checks. If that cannot be met, it fails closed without a prompt or handoff. This check never creates a handoff or consumes the invoice attempt. After the buyer signs the bound handoff message, the server repeats all gates and atomically stores a server/database-timestamped handoff authorization only while the preparation is strictly unexpired. Client timestamps are never trusted. `/mainnet/submitted` accepts only preparation ID, handoff ID, and transaction hash, and records the submission only after chain-196 RPC returns the exact buyer/router/zero-value transaction and attributed calldata. RPC observation and confirmation may occur after offchain expiry only if a matching handoff authorization was recorded before expiry. No such authorization means no new handoff or reconciliation.

Preparation must still bind the exact-input request amount, route, and calldata, but it must not label that amount as a guaranteed net spend. Partial execution and router refunds are accepted only when their exact input-token net effect is objectively visible and internally consistent as specified above. Unsupported or ambiguous execution mode/route evidence, unexpected refund source, or any mismatch between logs and canonical balance deltas fails closed.

The pre-prompt read-only readiness check and the signed handoff recheck are separate steps over one final persisted preparation. If the candidate has under 120 seconds left when Pay is clicked, checkout first requests a fresh authenticated preparation, before any wallet prompt; from the moment that final fresh preparation is selected, both rechecks use its exact immutable calldata and do not call `/swap` again. Its expiry is the earlier of `preparedAt + 120 seconds` and the deadline embedded in OKX calldata; the preview quote must be fresh when the final authenticated response is accepted. When the onchain deadline is shorter, the preparation is refreshed just-in-time and is never presented as valid beyond the encoded deadline. The pre-prompt check revalidates its hash and invoice/buyer/chain/Builder Code bindings, pending status, fresh balances and exact allowance, then re-estimates/re-simulates the exact persisted attributed calldata. It returns no wallet transaction and creates no handoff; it requires at least 30 seconds of remaining preparation lifetime after checks. If the readiness check cannot meet that minimum, checkout refreshes/reprepares before any wallet prompt; the invoice remains retryable and no handoff exists. After the authorization message is signed, the second recheck repeats all gates and inserts the immutable handoff only while the preparation is strictly unexpired; the database insert has no arbitrary seconds buffer. If expiry wins during insertion and no handoff row is persisted, the invoice remains retryable with a fresh preparation. Only after the successful persisted handoff does the one-invoice/one-attempt rule begin. The response then returns the persisted wallet transaction fields and identifiers, which the frontend passes unchanged to the connected wallet. A later exact transaction observation is allowed only when bound to that pre-expiry authorization. An unused/expired preparation cannot create a new handoff. A retry for an already paid invoice is idempotent only after confirming mainnet payment network and the exact same preparation, transaction, and verified evidence; it must not accept a testnet-paid invoice or caller-supplied substituted evidence. Neither recheck calls `/swap`, replaces or mutates calldata, signs, or broadcasts. The buyer must confirm manually; no additional approval is requested. Real Mainnet use must wait for final GPT-5.6 Sol High review.

After the read-only pre-prompt readiness check passes, the buyer signs a non-transaction message bound to the invoice, persisted preparation and calldata hashes, buyer, chain, and expiry. The server verifies that signature and repeats the gates before reserving a handoff; the later transaction signature remains the buyer's payment consent. Migration `20260924000000_mainnet_handoff_invoice_unique.sql` was applied successfully to the live PortPay Supabase project. Its live precheck found 0 handoff rows and 0 duplicate `invoice_id` values; `UNIQUE(mainnet_handoffs.invoice_id)` is present and valid, existing `preparation_id` uniqueness and the handoff primary key remain intact, RLS/ACL were unchanged, and no evidence rows were modified. The invoice-level uniqueness blocker is cleared. Duplicate lookup fails closed. One invoice permits one Mainnet handoff and one swap wallet prompt only after the handoff row is successfully persisted. If preparation expires or handoff insertion fails without persisting a row, the invoice attempt remains unused and checkout may refresh/reprepare before another wallet prompt. Once the handoff exists, the server never returns wallet transaction fields for that invoice again. A recorded submission/hash may only be recovered and canonically reconciled. Without a recorded hash after a persisted handoff, the outcome is unresolved after a reload or lost transaction result; transaction rejection cannot reopen Pay. No new handoff, `/swap`, or approval is allowed after persistence. The merchant must create a new invoice for another attempt. Browser storage is only a recovery aid and cannot authorize another swap.

Submission and handoff storage is added by `backend/supabase/migrations/20260923000000_mainnet_submission_tracking.sql` and `backend/supabase/migrations/20260923000001_mainnet_atomic_handoff_finalization.sql`. The earlier September 22/23 migration versions are applied to the PortPay live project, and the live `service_role` table-privilege correction was applied separately; the full live RLS, function privilege, trigger, unique-index, and evidence-integrity audit passed. The current September 23 migration files passed the final replay against a verified non-live Neon database: all seven migrations applied successfully in order, and the current ACL matrix, RLS, triggers, indexes, A–E backfill cases, atomic finalization, idempotency, rollback behavior, and cleanup passed. The replay did not contact live Supabase. The legacy trigger-only `set_invoices_updated_at()` `PUBLIC EXECUTE` caveat is explicitly accepted for this release. The current September 23 file revisions have not been applied live; the buyer-signed handoff is implemented but real Mainnet use remains held pending final review and explicit authorization. The migrations add only chain-196 evidence structures and `invoices.payment_network`; they enforce immutable preparation/handoff/submission evidence, server/database-time freshness binding, uniqueness, and intended service-role-only RPC/table access. The atomic reconciliation function inserts verified settlement evidence and updates the invoice's paid status, payment network, and receipt fields in one PostgreSQL transaction. A retry of the exact same verified evidence is idempotent and returns the already-paid result; conflicts or update failure roll the transaction back. No testnet reconciliation logic or data is changed. The `payment_network` backfill preserves every explicit supported value and every legacy `NULL`; it labels a legacy row `x-layer-mainnet` only when the invoice is already paid and its payment transaction matches an immutable chain-196 settlement joined to that invoice's chain-196 preparation. A preparation alone is never payment evidence, and known testnet records are not rewritten. Repository reads map `NULL` to legacy testnet compatibility and reject unknown non-null network values.

No mainnet wallet funding, Builder Code registration transaction, deployment, private-key execution, backend transaction-send API, or backend broadcast is permitted in this implementation. The buyer-signed Pay handoff is implemented: the buyer may submit only the existing persisted, rechecked transaction through a manual wallet confirmation, with no new approval or automatic send. Do not conduct a real Mainnet payment before final Sol High review. The approval itself is not payment, and only verified canonical reconciliation marks an invoice paid.

## 10. Environment variables and addresses

The exact deployed addresses are configuration, not assumptions. Once known, they must be recorded in `README.md` and the appropriate environment example without secrets.

Expected configuration includes:

```text
VITE_CHAIN_ID=196
X_LAYER_MAINNET_RPC_URL=
X_LAYER_MAINNET_EXPLORER_URL=
MAINNET_WNVDAx_ADDRESS=0xa8ddb5cd96b5222afe198316e9a57caa642850d5
MAINNET_WAAPLx_ADDRESS=0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f
MAINNET_USDT0_ADDRESS=0x779Ded0c9e1022225f8E0630b35a9b54bE713736
X_LAYER_TESTNET_RPC_URL=
X_LAYER_TESTNET_EXPLORER_URL=
TESTNET_USDT0_ADDRESS=0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c
DEMO_AAPL_ADDRESS=
DEMO_NVDA_ADDRESS=
PORTPAY_SETTLEMENT_ADDRESS=
PORTPAY_BUILDER_CODE=
PORTPAY_MAINNET_BUILDER_CODE=5fc2j7wx6trof4eu
PORTPAY_MAINNET_BUILDER_PAYOUT_ADDRESS=0xbabdfef588cf57efcc7c8857960e3ccdd9167589
MAINNET_QUOTE_TTL_SECONDS=120
MAINNET_CONFIRMATION_DEPTH=2
DEMO_PRICE_SOURCE=
DATABASE_URL=
SUPABASE_URL=
SUPABASE_ANON_KEY=
```

The testnet `USD₮0` address above is retained only for internal regression. Mainnet uses the separate mainnet addresses shown above; never cross-load addresses between networks. Mainnet-only OKX API credentials remain server-side and must never be required by internal testnet tests or committed.

Never commit private keys, seed phrases, API secrets, or populated `.env` files. Use burner/demo wallets and testnet funds only during the required phases.

## 11. Explicit non-goals and guardrails

Do not expand the MVP into:

- a marketplace or product catalog;
- a full DEX or AMM/liquidity pool;
- a price oracle or live market-data infrastructure;
- a trading bot, portfolio manager, or investment-advice product;
- a token, DAO, governance system, or yield product;
- a multi-chain deployment;
- official testnet xStock issuance;
- a large asset catalog;
- unnecessary AI or an AI-generated recommendation that replaces deterministic Smart Spend math;
- hidden mainnet dependencies;
- broad custody or arbitrary vault-withdrawal functionality.

## 12. Definition of done

The historical testnet MVP proof is complete when:

- a merchant can create an invoice and payment link;
- a separate buyer tab can open checkout and connect a wallet;
- the buyer paid with `DemoAAPL` on X Layer Testnet;
- `PortPaySettlement` transfers official testnet `USD₮0` to the merchant;
- the transaction confirms and is linked to the X Layer explorer;
- the merchant sees a stablecoin receipt;
- Smart Payment History records the payment and its reason/metadata;
- `DemoNVDA` and deterministic Smart Spend work in the later feature phase;
- eligible transactions carry Builder Code attribution;
- tests cover settlement math, decimals, replay protection, expiry, permissions, and failure cases;
- the README documents setup, architecture, features, environment variables, deployed addresses, demo steps, and known limitations;
- the historical two-tab testnet demo is reproducible from a clean checkout.

The current product network policy is Mainnet-first. The manual buyer-signed Pay handoff is implemented but real Mainnet use remains held until final Sol High review. Checkout must disclose this limitation, submit only after READY from the same-calldata server recheck, reuse the exact existing allowance, and rely on canonical reconciliation before showing paid status.

## 13. Mandatory phased build plan

Only one phase may be active at a time. Phase names below record the historical build sequence; their chain-1952 implementation remains an internal regression and legacy compatibility path, not the current product default.

### Phase 0 — Foundation and repository setup

- Confirm the GitHub remote/repository: <https://github.com/london160771/PortPay>.
- Create the app skeleton, frontend/backend boundaries, contracts directory, test configuration, and testnet configuration.
- Scaffold Supabase/Postgres configuration for the backend without adding unnecessary application schema before it is needed.
- Create `README.md` in this phase.
- Put setup, architecture, initial feature scope, environment variables, current addresses (if any), demo outline, and known limitations in the README.

### Phase 1 — Wallet + Demo Assets

- Finish the OKX Wallet connection experience and wrong-network handling on X Layer Testnet.
- Implement and test `DemoAAPL` as a clearly labeled ordinary EVM ERC-20 demo asset; never present it as an official xStock or real Apple-backed security.
- Prepare reproducible X Layer Testnet deployment and minting scripts for `DemoAAPL`.
- Verify the official X Layer Testnet `USD₮0` address against current OKX documentation before using it in runtime configuration.
- Add read-only frontend balance support for `DemoAAPL` and testnet `USD₮0`.
- Do not implement settlement, invoices, checkout, receipts, history, Smart Spend, `DemoNVDA`, or Builder Codes in this phase.

### Phase 2 — Merchant Invoice Flow

- Implement the merchant dashboard and wallet-aware invoice/payment-link flow.
- Persist invoice metadata in Supabase/Postgres with reproducible migrations.
- Support `pending` and `paid` invoice status display without fabricating onchain payment state.
- The merchant invoice slice is complete in Phase 2. Buyer checkout and manual `DemoAAPL` payment are implemented and verified as part of Phase 3 Core Settlement because they are inseparable from the real settlement path.
- Do not start Phase 4 until the Phase 3 settlement flow has passed its required review checkpoint and approval gate.

### Phase 3 — Core Settlement

- Implement/deploy and test `PortPaySettlement` for the smallest safe settlement flow.
- Configure official testnet `USD₮0` and test OKB.
- Fund the settlement contract with testnet `USD₮0`.
- Wire `TestnetSettlementAdapter`.
- Complete one real X Layer Testnet settlement and merchant receipt.

The Phase 3 implementation uses a server-signed EIP-712 quote bound to the invoice, buyer, merchant, configured demo asset, official testnet `USD₮0`, exact integer amounts, chain ID, settlement contract, and short expiry. The backend marks an invoice `paid` only after checking that the receipt belongs to the canonical block, has the configured confirmation depth, and contains one matching `SettlementExecuted` event. The default confirmation depth is two blocks and is configurable through `SETTLEMENT_CONFIRMATION_DEPTH`. Live contract deployment, Supabase migration application, funding, and the real testnet transaction remain environment-dependent verification steps.

**Mandatory GPT-5.6 Sol High review checkpoint:** immediately after Phase 3 — Core Settlement is working and before treating the core flow as finished. Review contract behavior, decimals, quote validation, duplicate/replay protection, approvals, merchant authorization, failure handling, and the actual testnet transaction.

### Phase 4 — Receipts and Smart Payment History

- Add confirmation polling/status handling.
- Add buyer/merchant receipts and explorer links.
- Add Smart Payment History with asset spent, stablecoin received, status, transaction, and quote/reason metadata.
- Re-run the two-tab demo.

### Phase 5 — Smart Spend and DemoNVDA

- Deploy/configure `DemoNVDA`.
- Add portfolio balances/targets and deterministic recommendation logic.
- Show recommendation reason and support manual selection plus Smart Pay.
- Test overweight, underweight, equal-target, rounding, insufficient-balance, and unavailable-asset cases.

### Phase 6 — OKX/X Layer Builder Codes

- Complete Builder Code registration/configuration for the project.
- Attach the code through the app’s eligible transaction path using the current OKX/ERC-8021 mechanism.
- Verify attribution on testnet and document it in the README.

Current implementation note (2026-09-21): the frontend uses `ox/erc8021` with `viem` `2.45.0` or higher and attaches `dataSuffix` to DemoAAPL approval and PortPay settlement requests. Independent review of the supplied registration transaction shows that `kob1lkgsg6infkg3` (`lk`) is registered to the buyer payout address and is the current local configuration. Checkout verifies the code through an explicit X Layer Testnet public client and chain-1952 check before a wallet request. A real attributed approval and settlement were verified for invoice `eb2eae24-f8c9-47b4-9a7f-20942fd83e6e`; both decode to `kob1lkgsg6infkg3`, and the settlement receipt reconciled to `paid`. The older `kob1klgsg6infkg3` (`kl`) and temporary page’s `2j3pbm1a4djso11j` are not registered. Testnet evidence is recorded in `README.md`.

**Mandatory GPT-5.6 Sol High review checkpoint:** immediately after Builder Codes integration. Review encoding/attachment, transaction construction, wallet behavior, attribution evidence, and whether every eligible PortPay-generated transaction is covered.

### Phase 7 — Product polish and final submission readiness (historical implementation phase)

- Polish landing, dashboard, checkout, receipt, and history UX.
- Keep the visual language clean and fintech-like.
- Keep mainnet execution limitations prominent and preserve clear legacy testnet labels.
- Update README and both source-of-truth documents for any material changes.
- Prepare the reproducible two-tab judge demo and submission evidence.

Current implementation note (2026-09-21): the product surfaces now present a three-step merchant/buyer journey, prioritize amount-due and exact-quote clarity, keep Smart Spend visibly optional, lead receipts with confirmed payment and explorer evidence, and isolate development-only Builder Code diagnostics from normal buyer errors. These changes are presentation-only; settlement, quote validation, Smart Spend math, history persistence, and Builder Code attachment remain unchanged.

**Mandatory GPT-5.6 Sol High review checkpoint:** before final submission and before any mainnet test. Review the complete implementation, contracts, Builder Codes, documentation, security assumptions, demo claims, and known limitations.

### Merchant integration readiness pass (completed historical work)

The completed pass added role-separated merchant and buyer routes, nested product documentation, and a minimal server-to-server merchant integration above the invoice/payment layer. Merchant API authentication, external order references, and signed payment notifications remain server-side and reuse the verified invoice/reconciliation path.

### Mainnet Phase 1 — isolated adapter preparation

The backend mainnet adapter remains non-signing and non-broadcasting. It prepares authenticated chain-196 quotes and transaction data, validates direct merchant-recipient execution, and prepares ERC-8021 suffixes. It must not fund wallets, deploy contracts, register a mainnet Builder Code, or modify the proven testnet settlement path. The buyer-signed Pay handoff is implemented separately: it can pass only the exact persisted transaction to the connected wallet after a fresh same-calldata readiness recheck. The buyer must confirm manually; real Mainnet use stays held until final review, required migrations in the target environment, and explicit user authorization.

### Mainnet Phase 2 — Builder Code registration, preflight, and receipt design

- Document the official OKX Developer Portal registration steps without registering automatically.
- Verify a future mainnet code and payout through `payoutAddress(uint256)` on the official chain-196 registry.
- Run deterministic read-only preflight, exact calldata simulations, and balance/allowance/gas checks before any future wallet prompt.
- Define canonical mainnet receipt/reconciliation checks and isolated payment states without changing testnet reconciliation.
- Use only the separately registered, independently verified mainnet code/payout configuration; never reuse the testnet Builder Code.
- Keep backend signing, backend transaction-send endpoints, and broadcasts disabled. The manual buyer-signed Pay handoff may submit only the exact persisted preparation after a fresh same-calldata recheck and explicit wallet confirmation; no new approval is requested. Real Mainnet use remains held until final review and explicit user authorization. Readiness/submission/reconciliation endpoints do not sign or broadcast.
- Treat preparation expiry as a gate on new wallet handoffs only. The recheck persists a DB-timestamped handoff authorization before expiry; later RPC observation of the exact transaction can reconcile after expiry only when bound to that authorization. Do not trust client timestamps. An expired preparation with no valid handoff cannot be newly initiated or reconciled.
- Use a separate mainnet submission/reconciliation path that accepts only invoice/preparation IDs, a persisted pre-expiry handoff ID, and transaction hash, loads all authority from persisted evidence, and changes invoice status only through the atomic mainnet settlement/invoice RPC after verifier success. Leave testnet reconciliation untouched.
- Treat the prepared exact-input amount as a maximum buyer debit, not a guaranteed net spend. Accept partial consumption/refund only when router-originated refund and actual positive net debit are fully evidenced by transaction-specific token transfers and equal the canonical pinned balance delta; reject unexplained, non-router, or excessive movement. Merchant USD₮0 must still meet the prepared minimum and invoice floor.
- Target 120 seconds from the final authenticated swap preparation: executable expiry is `min(preparedAt + 120 seconds, deadline encoded in OKX calldata)`, while the preview quote must still be fresh when accepted. Never extend displayed expiry or calldata. If a candidate has under 120 seconds remaining on Pay click, fetch one fresh authenticated preparation before any wallet prompt and then recheck that exact persisted preparation. If the OKX-encoded deadline is shorter than 120 seconds, use the result just-in-time without claiming a longer window. The read-only same-preparation readiness check requires at least 30 seconds remaining after checks; if that fails, refresh before prompting and keep the invoice retryable. After the buyer signs, repeat all gates and insert the immutable database-timestamped handoff only if still unexpired; the database insert has no fixed-seconds buffer. If insertion fails because expiry wins and no row exists, the invoice remains retryable with a fresh preparation. Only a successfully persisted handoff starts the one-invoice/one-attempt rule. A submission observed later is valid only for the exact persisted preparation/calldata bound to that pre-expiry handoff. Once the final fresh preparation is selected, the rechecks never call `/swap` again or mutate/replace calldata; no client timestamp is trusted.
- Keep Mainnet handoff strictly buyer-signed and manual: the existing Pay action uses only persisted transaction fields after same-calldata readiness recheck, then records/observes the wallet-submitted hash through existing endpoints. No backend signing/broadcast, automatic send, new approval, or replacement `/swap` is allowed. Do not conduct a real Mainnet payment before final Sol High review.

### Optional Phase 8 — Tiny mainnet proof

Only after all mainnet safety controls and migrations are validated, the final Sol High review passes, and the user separately explicitly authorizes it. Enable `OKXDEXMainnetAdapter` for one deliberately tiny supported-tokenized-asset-to-stablecoin proof if route, funds, Builder Code registration, and all safety conditions are available. Testnet remains regression-only and is not a prerequisite for the product.

## 14. Change-control rule

Any change to a locked feature, asset progression, adapter name, chain strategy, contract responsibility, Builder Code requirement, phase gate, or scope guardrail must first update both `PORTPAY_SPEC.md` and `AGENTS.md`, then wait for user approval before implementation proceeds. The README must be updated in the same phase whenever setup, architecture, features, environment variables, contracts, addresses, demo steps, or known limitations change.
