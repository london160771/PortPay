# PortPay Agent Instructions

This file is the execution and repository-workflow authority for PortPay. Read it together with `PORTPAY_SPEC.md` before changing the project. Both files are source of truth throughout the build.

**Repository:** <https://github.com/london160771/PortPay>  
**Product:** PortPay — Spend your portfolio. Merchants get stablecoins.  
**Primary product network:** X Layer Mainnet, chain ID `196`
**Internal regression network:** X Layer Testnet, chain ID `1952`

## 1. Non-negotiable workflow

### One phase at a time

Codex must work on exactly one named phase from `PORTPAY_SPEC.md` at a time. Do not start the next phase while the current phase is awaiting review or approval. Do not bundle unrelated cleanup, speculative features, or future mainnet work into the active phase.

Before implementation, identify the active phase and its acceptance criteria. If the requested work conflicts with the spec, stop and update both source-of-truth files first; never resolve a conflict by silently changing architecture or scope.

### Required phase-completion report

When the active phase is complete, Codex must report all of the following in plain language:

- files changed;
- tests added and tests run, including results or failures;
- manual demo steps and whether they passed;
- environment/configuration changes;
- deployed contracts and addresses, or an explicit statement that none were deployed;
- transaction hashes/explorer links when a chain transaction was performed;
- README and source-of-truth updates;
- known limitations, risks, and deferred work;
- which GPT-5.6 Sol High checkpoint applies, if any;
- the exact next phase, without starting it.

After that report, Codex must wait for the user’s approval.

### Approval gate for Git

Codex must **never commit or push before the user approves the completed phase**. A general earlier approval, a request to “keep going,” or approval to implement does not count as approval to commit/push that phase.

The only valid order is:

```text
complete one phase
→ report files/tests/manual demo/config/addresses/limitations
→ wait for explicit user approval
→ commit that phase
→ push that phase
→ report the commit/push result
```

No automatic commit, no automatic push, and no “checkpoint commit” before approval. If approval is not given, leave the work uncommitted and do not push it. Do not use destructive Git commands to hide or discard user work.

## 2. README policy

`README.md` must be created in **Phase 0** and kept current throughout the build.

Update it in the same phase whenever any of the following changes:

- setup or run instructions;
- architecture or data flow;
- features or user flow;
- environment variables;
- contract addresses, token addresses, chain IDs, or Builder Code configuration;
- testnet/mainnet status;
- demo steps or judge path;
- known limitations, security assumptions, or unsupported behavior.

The README must never claim that DemoAAPL/DemoNVDA are real stocks, that testnet settlement is an OKX DEX swap, or that mainnet proof exists when it does not.

## 3. Canonical names and terminology

Use these exact names everywhere:

- `PortPay` — product and repository.
- `PortPaySettlement` — testnet settlement contract.
- `TestnetSettlementAdapter` — testnet adapter.
- `OKXDEXMainnetAdapter` — isolated chain-196 product adapter; a buyer-signed swap handoff is allowed only through the manual Pay flow after a fresh same-calldata server recheck. Backend signing/broadcast and automatic submission remain prohibited; do not use the live path before final review and buyer wallet confirmation.
- `DemoAAPL` — first demo ERC-20.
- `DemoNVDA` — second demo ERC-20 for Smart Spend.
- `USD₮0` — official stablecoin for the explicitly recorded payment network (real USD₮0 on Mainnet; test USD₮0 only for internal chain-1952 regression/history).
- `Smart Spend` — deterministic portfolio-aware asset recommendation.
- `Smart Payment History` — history/receipt feature.
- `Builder Codes` — OKX/X Layer transaction attribution.

`PortfolioPay` is an obsolete early working name. Do not add it to new code, identifiers, UI, docs, screenshots, commit messages, or README text. If it is found in an existing file, normalize it to `PortPay` unless the file is an external historical artifact.

### Current product network policy

PortPay is Mainnet-first. Normal product routes (`/merchant`, `/pay/:invoiceId`, merchant invoice details, receipt, and history) select X Layer Mainnet chain `196` without a query parameter or network switch. Testnet is internal regression, historical receipt compatibility, and explicitly enabled non-production tooling only; production routes must never select `TestnetSettlementAdapter` or show DemoAAPL/DemoNVDA/testnet USD₮0/testnet Builder Code.

This default does not imply that mainnet payments are fully live. The buyer-signed Pay handoff is implemented: it may submit only the exact persisted transaction after a fresh same-calldata server readiness recheck and an explicit buyer wallet signature. It never requests another approval or automatically sends. The invoice-level handoff uniqueness blocker is cleared by the successfully applied and verified live migration `20260924000000_mainnet_handoff_invoice_unique.sql`. Do not use the flow for a real Mainnet payment before the final GPT-5.6 Sol High review passes and the user separately authorizes the payment; only verified backend reconciliation can mark an invoice paid. Backend signing/broadcast remains prohibited. No real Mainnet swap has been sent. Legacy testnet records must retain their correct network/explorer display.

Do not call the X Layer Testnet prefunded-contract flow a “DEX swap.” Use **portfolio settlement** or **testnet simulated RWA conversion**. Reserve “OKX DEX swap” for the optional `OKXDEXMainnetAdapter` path.

## 4. Features that must not be omitted

The MVP is not complete if any of these are missing:

- merchant creates an invoice;
- merchant receives a shareable payment link;
- buyer checkout opens from that link;
- mainnet product payment architecture uses supported tokenized assets and real USD₮0, with execution gated as specified;
- historical DemoAAPL/DemoNVDA and testnet USD₮0 behavior remains available only for internal regression and legacy receipts;
- payment receipt includes what was spent, what was received, and the X Layer transaction;
- Smart Payment History records the payment and relevant reason/status metadata;
- Smart Spend recommends between portfolio assets using deterministic allocation rules;
- `DemoNVDA` is added for the Smart Spend phase, after core settlement;
- OKX/X Layer Builder Codes are attached to eligible PortPay-generated transactions;
- the two-sided merchant/buyer flow remains clear and never claims payment succeeded before verified Mainnet reconciliation;
- `TestnetSettlementAdapter` remains internal to chain-1952 regression and legacy compatibility;
- testnet settlement evidence receives `payment_network = x-layer-testnet` at the shared invoice-reconciliation boundary, not from `TestnetSettlementAdapter` itself;
- `OKXDEXMainnetAdapter` is the chain-196 product adapter behind shared invoice/payment services;
- README and both source-of-truth documents remain current.

## 5. Architecture guardrails

- Normal product configuration uses X Layer Mainnet (`196`), wNVDAx/wAAPLx, real USD₮0, and the separate verified mainnet Builder Code.
- Keep X Layer Testnet (`1952`), test OKB, test USD₮0, DemoAAPL/DemoNVDA, and the testnet Builder Code restricted to automated regression, historical receipts, and explicit internal non-production tooling.
- Use React + Vite, `wagmi` + `viem`, a small Node.js + Express + TypeScript backend, and Supabase/Postgres behind a repository/data-access boundary as described in the spec.
- Keep invoice metadata, product names, demo prices, status indexing, and searchable history offchain; keep ownership, settlement, payment, and compact receipt events onchain.
- Do not build a full AMM, oracle, marketplace, token, DAO, multi-chain system, trading bot, or unnecessary AI layer.
- Smart Spend must be deterministic and explainable for the MVP. It is not financial advice.
- Demo reference prices must be labeled as demo values, not market prices.
- Read and test token decimals; never assume all assets use the same decimal precision.
- The settlement contract must prevent duplicate invoice settlement, validate expiry and participants, and fail atomically.
- Never put private keys, seed phrases, populated `.env` files, or API secrets in the repository.
- Never leak mainnet config/credentials into internal testnet tests, or testnet config/addresses/Builder Code into mainnet preparation.

## 6. Builder Codes rules

Builder Codes are a required integration.

- Use the current official OKX/X Layer registration and encoding instructions.
- Attach the registered PortPay attribution in the app’s eligible transaction-building path; do not rely on wallet auto-injection.
- Use the current ERC-8021 mechanism where applicable.
- Keep environment-specific Builder Code configuration out of committed secrets and document the active non-secret configuration in the README.
- Verify the attribution on testnet and preserve evidence in the phase report.
- Do not mark Builder Codes complete based only on a UI label or an unverified placeholder.

## 7. Testing requirements

Every implementation phase must have tests proportionate to its risk. At minimum, cover:

- invoice creation, unique IDs, expiry, and status transitions;
- quote binding to invoice, merchant, asset, stablecoin, amounts, chain, settlement contract, and expiry;
- ERC-20 approvals, balances, and decimal conversions;
- rounding and exact settlement amounts;
- wrong asset, wrong merchant, invalid quote, expired quote, duplicate/replayed invoice, insufficient balance, insufficient allowance, and failed transfer;
- receipt event contents and history indexing;
- Smart Spend overweight/underweight/at-target decisions, insufficient balance, missing asset, and deterministic reason text;
- Builder Code transaction construction/attachment and manual verification evidence;
- mainnet-first route selection and correct network/explorer rendering for both new mainnet and legacy testnet receipts;
- internal testnet regression coverage remains available without exposing testnet in production UI/routes.

Do not report “working” when only a mocked frontend flow works. Distinguish clearly between unit tests, local integration tests, testnet transactions, and manual UI demonstration.

## 8. Required GPT-5.6 Sol High review reminders

Codex must remind the user in the phase-completion report and pause at each checkpoint below. The implementation model may be GPT-5.6 Luna Max or another configured Codex model, but these review points specifically require GPT-5.6 Sol High review.

### Checkpoint A — after Phase 3 — Core Settlement

After Phase 3 — Core Settlement, before core settlement is treated as finished. Ask for/recommend review of:

- `PortPaySettlement` behavior;
- quote/price trust and expiry;
- ERC-20 decimals and rounding;
- approvals and transfer ordering;
- merchant authorization and invoice binding;
- replay/duplicate protection;
- atomic failure behavior;
- the actual X Layer Testnet transaction and receipt.

### Checkpoint B — after Builder Codes integration

After Phase 6, before Builder Codes are treated as complete. Review:

- registration/configuration;
- ERC-8021/current encoding;
- app-side transaction attachment;
- wallet behavior;
- coverage of every eligible PortPay-generated transaction;
- attribution evidence and README documentation.

### Checkpoint C — before final submission or any mainnet test

After Phase 7 and before final submission, and again before any optional mainnet transaction if needed. Review:

- complete user flow and demo claims;
- contract and adapter boundaries;
- test coverage and known limitations;
- Builder Codes;
- environment/address documentation;
- security assumptions and wallet handling;
- separation between testnet proof and optional mainnet proof.

Do not perform an optional mainnet test until the user explicitly approves it after this review. A mainnet test is never implied by approval of testnet work.

## 9. Phase execution checklist

### Phase 0 — Foundation

- Establish frontend/backend/contracts/test structure.
- Configure X Layer Testnet.
- Scaffold Supabase/Postgres configuration without adding unnecessary application schema.
- Create `README.md`.
- Document initial setup, architecture, env vars, demo plan, and limitations.
- Do not deploy mainnet assets or require mainnet credentials.

### Phase 1 — Wallet + Demo Assets

- Finish the OKX Wallet connection experience and wrong-network handling on X Layer Testnet.
- Implement and test `DemoAAPL` as a clearly labeled ordinary demo ERC-20 test asset; never present it as an official xStock or real Apple-backed security.
- Prepare reproducible X Layer Testnet deployment and minting scripts for `DemoAAPL`.
- Verify the official X Layer Testnet `USD₮0` address against current OKX documentation before using it in runtime configuration.
- Add read-only frontend balance support for `DemoAAPL` and testnet `USD₮0`.
- Do not implement settlement, invoices, checkout, receipts, history, Smart Spend, `DemoNVDA`, or Builder Codes in this phase.

### Phase 2 — Merchant Invoice Flow

- Merchant dashboard and wallet-aware invoice creation.
- Persist invoice metadata in Supabase/Postgres and expose a unique shareable payment link.
- Show pending/paid invoice status and a clean invoice detail/waiting screen.
- The merchant invoice slice is complete in Phase 2. Buyer checkout and manual `DemoAAPL` payment are implemented and verified as part of Phase 3 Core Settlement because they are inseparable from the real settlement path.
- Do not start Phase 4 until the Phase 3 settlement flow has passed its required review checkpoint and approval gate.

### Phase 3 — Core Settlement

- Implement/deploy and test `PortPaySettlement` for the smallest safe testnet settlement flow.
- Configure/fund official testnet `USD₮0` settlement.
- `TestnetSettlementAdapter`.
- Confirm one real testnet payment and merchant receipt.
- Stop for GPT-5.6 Sol High review reminder.

The current implementation boundary is a server-signed EIP-712 quote plus canonical, two-confirmation-by-default `SettlementExecuted` receipt-event reconciliation. The confirmation depth is configurable through `SETTLEMENT_CONFIRMATION_DEPTH`. Do not treat the phase as live-complete until Supabase migrations are applied, the testnet contracts are deployed/funded, and one real X Layer Testnet transaction is verified.

### Phase 4 — Receipts/history

- Confirmation polling/status.
- Buyer/merchant receipt.
- Smart Payment History and explorer link.
- Re-run two-tab demo.

### Phase 5 — Smart Spend

- Add `DemoNVDA`.
- Implement deterministic allocation recommendation.
- Show reason and allow manual or Smart Pay selection.

### Phase 6 — Builder Codes

- Integrate and verify OKX/X Layer Builder Codes.
- Document configuration/evidence.
- The current testnet implementation uses `ox/erc8021` and `dataSuffix` on eligible DemoAAPL approval and PortPay settlement requests. Independent review of registration transaction `0x364e2aecb5cbbe0b206cb254a82f786ce5dd0645668adc0af0ee391fb1ce8b50` found that it registered `kob1lkgsg6infkg3` (the letters `lk`), which is the current local configuration. Checkout verifies this code through an explicit X Layer Testnet public client and chain-1952 check before a buyer-wallet transaction. A real approval and settlement for invoice `eb2eae24-f8c9-47b4-9a7f-20942fd83e6e` were independently decoded and verified with this code, including the canonical settlement receipt and registry payout. Do not use the older unregistered `kob1klgsg6infkg3` or temporary-page value `2j3pbm1a4djso11j`. Phase 6 is ready for GPT-5.6 Sol High Checkpoint B review; approval remains gated on that review.
- Stop for GPT-5.6 Sol High review reminder.

### Phase 7 — Polish/submission (historical implementation phase)

- Polish the clean fintech UI.
- Keep current mainnet execution limitations prominent and preserve clear legacy testnet labels.
- Update README, `PORTPAY_SPEC.md`, and `AGENTS.md` for all material changes.
- Prepare the two-tab judge demo and final evidence.
- Current implementation note (2026-09-21): the merchant and buyer surfaces use a three-step handoff, touch-friendly actions, explicit loading/empty/success/failure states, and isolated development-only Builder Code diagnostics. The presentation pass does not change settlement, quote, Smart Spend, history, or Builder Code logic.
- A separate pre-mainnet readiness pass may add role-separated merchant/buyer routes, nested product documentation, and a minimal authenticated server-to-server merchant integration above the invoice/payment layer. It must not start `OKXDEXMainnetAdapter`, add mainnet configuration, change settlement/security logic, send transactions, or bypass the existing verified reconciliation path.
- Stop for GPT-5.6 Sol High review before final submission or any mainnet test.

### Mainnet Phase 1 — isolated adapter preparation

- Add only isolated chain-196 configuration and server-side authenticated OKX V6 read-only quote/transaction preparation.
- Keep `OKXDEXMainnetAdapter` non-broadcasting on the backend: no wallet funding, deployments, Builder Code registration, backend signing, or backend broadcast. Buyer wallet writes are limited to the existing exact manual approval and the separately specified manual Pay handoff using persisted calldata after readiness recheck; neither is automatic.
- Validate direct merchant-recipient preparation, exact approvals, quote freshness, router/spender binding, and ERC-8021 suffix construction.
- Do not modify `TestnetSettlementAdapter`, testnet addresses, or the proven testnet flow.
- The manual buyer-signed Pay handoff implementation is explicitly authorized. Do not send a transaction on the user's behalf; real Mainnet use must wait for final Sol High review and the buyer's deliberate Pay click and wallet confirmation.

### Mainnet Phase 2 — Builder Code registration, preflight, and receipt design

- Require the separately registered mainnet Builder Code and payout to be configured and independently verified; never substitute the testnet code. Current non-secret mainnet configuration is code `5fc2j7wx6trof4eu`, payout `0xbabdfef588cf57efcc7c8857960e3ccdd9167589`.
- Document the manual portal flow: connect the owning wallet, verify the address, create the mainnet Builder Code, and record the generated code and payout address.
- Do not call the testnet `registerAuto` flow for mainnet and never reuse `kob1lkgsg6infkg3`.
- Verify the separate mainnet code by reading `payoutAddress(uint256)` from registry `0xd6c426f9c077358735622ae5a83468dc0510823b` on chain `196`; require an exact configured payout match.
- Add only deterministic, read-only preflight for chain, invoice/quote binding, tokens, amounts, freshness, slippage, router, spender, calldata, recipient, native value, balances, allowance, OKB gas, Builder Code suffix, and `eth_call` simulations.
- Persist immutable preparation evidence (invoice/quote, parties, chain/tokens/amounts, router/spender, exact attributed approval/swap calldata and hashes, Builder Code/payout, snapshot block, and expiry) before any future wallet approval can be considered.
- Read balances and decimals at a pinned snapshot block; require 18 decimals for wNVDAx/wAAPLx and 6 for mainnet USD₮0. Stage A reads pinned allowance first. If it is not exactly the required input amount, simulate the exact attributed approval, validate non-empty ERC-20 return data is `true`, and return `APPROVAL_REQUIRED`; below, above, and unlimited allowances are rejected, and no swap gas estimate/simulation runs. Stage B is permitted only when pinned allowance equals the exact required amount; estimate gas from the exact attributed approval and swap calls, apply the documented 20% safety margin, simulate the exact swap, then evaluate OKB readiness.
- Do not return mainnet preflight `READY` for any allowance other than exact equality with the quoted input amount. Backend `READY` authorizes only the explicit wallet handoff fields after the same-calldata recheck; it never authorizes backend signing or broadcast.
- The fixed `$1.00` Mainnet proof uses exactly `0.0048 wNVDAx` (`4800000000000000` base units) and `1.5%` slippage; reject any value above `1.5%`. The fresh final minimum receive must be at least the invoice amount (`1.000000 USD₮0`). Surface `READY` only after exact allowance, fresh authenticated preparation, direct merchant receiver, verified Builder Code, exact attributed gas estimation and `eth_call`, and sufficient OKB all pass. Wallet confirmation stays manual and no automatic swap broadcast is enabled.
- For OKX V6 Classic Swap, do not require the quote endpoint's and swap endpoint's `quoteId` values to match: the official quote/swap parameter and response schemas do not document a shared immutable quote ID. A returned quote ID is diagnostic only. The backend preflight must obtain a fresh `/swap` response through its authenticated server-side API client immediately before acceptance; caller-supplied swap preparation is never execution authority. Keep a server-held provenance marker and persist the authenticated response evidence/hash, then bind it to the preview/invoice intent by chain, buyer, merchant receiver, input/output tokens, exact input, slippage, invoice acceptance amount, and freshness. Validate the response's route/path, router target, expected output, minimum receive, zero native value, and decoded calldata. Route legs must be a single ordered connected path: first input is the selected asset, each leg output equals the next leg input, and the final output is official USD₮0. Reject disconnected, reordered, duplicate/unrelated, contradictory, or malformed route metadata; do not accept branches unless the response can be represented and validated as one explicit connected route. A changed route may be accepted only when the fresh response is internally valid and all bound values match; reject changed tokens/input/recipient/slippage and any minimum receive below the invoice amount. Persist preview plus authenticated final executable evidence, including deterministic route fingerprint, preparation time/deadline, and exact attributed calldata hashes; receipt reconciliation still requires byte-for-byte transaction-input equality with the persisted attributed swap calldata.
- Add a mainnet receipt/reconciliation verifier requiring exact persisted attributed calldata, matching configured/prepared/onchain Builder Code and payout, canonical adjacent before/receipt blocks, block-pinned buyer/merchant balance deltas, confirmation depth, and an atomic database claim plus invoice-paid transition.
- OKX's official Classic Swap docs state that a Uni V3 route can consume only part of the input and the router may refund the remainder. Do not infer net debit from `exactIn` or calldata alone. Reconcile actual positive net input-token debit from receipt transfer logs and require it to match the deterministic block-pinned balance delta and remain at or below the prepared input cap. Any refund must be a verifiable transfer from the prepared router to the buyer; unknown, inconsistent, excessive, or malformed movement fails closed. Merchant output must still meet both the prepared minimum and invoice amount.
- Enforce unique settlement per invoice, preparation, and `(chain_id, transaction_hash)` with database constraints. The atomic claim function must insert verified settlement evidence, set invoice status/evidence/payment network to mainnet in the same Postgres transaction, and return an idempotent already-paid result only for the same verified preparation/transaction/evidence. Concurrent or conflicting claims must not both succeed.
- Keep mainnet receipts explicitly not live-ready until these controls, the migrations, a registered mainnet Builder Code, and the required Sol High review are complete.
- Model mainnet payment states separately (`pending`, `prepared`, `ready`, `submitted`, `confirming`, `paid`, `failed`, `expired`) without changing testnet invoice states.
- Missing or unregistered mainnet Builder Code must never produce live-ready status.
- The existing exact buyer-approval preparation remains separately scoped and must never be called from the Pay handoff. The current Pay path requires the exact prepared wNVDAx allowance to already exist, submits no approval, and fails closed otherwise. Any separately authorized approval must remain chain-196, backend-prepared, exact, manually confirmed, attributed, and followed by receipt verification plus an exact allowance reread.
- Buyer-signed Mainnet Pay handoff: on explicit buyer click, normal `/pay/:invoiceId` must call the server readiness recheck for the existing preparation. Only READY may return the minimal persisted transaction fields (`from`, `to`, exact attributed `data`, zero `value`, chain 196) plus preparation/hash/handoff identifiers. The frontend must submit those fields byte-for-byte through the connected wallet without another OKX `/swap`, calldata mutation, fallback, or approval request. The user confirms the transaction manually. After wallet submission, record its hash through the existing submission route and use existing canonical reconciliation; only that verifier/finalizer may mark paid. No private-key handling, backend signing/broadcast, or automatic wallet prompt/send is allowed. Do not use for a real Mainnet payment before final Sol High review.
- Before any future wallet handoff, recheck the same persisted preparation hash, buyer, chain, pending invoice, exact allowance, balances, and exact attributed gas-estimate/`eth_call` results. After every gate passes, the recheck inserts an immutable handoff marker using database-generated time only while the preparation is unexpired; this marker is the objective authorization boundary immediately before READY and a wallet prompt. Do not impose an arbitrary 15-second buffer. The database rejects expired handoffs; later RPC observation is allowed only for the byte-identical transaction linked to a valid pre-expiry marker, and client timestamps are never accepted.
- The current September 23 migration files passed the final replay on a verified non-live Neon database: all seven migrations applied successfully in order, and the current ACL matrix, RLS, triggers, indexes, A–E backfill cases, atomic finalization, idempotency, rollback behavior, and cleanup passed. That replay did not contact live Supabase. The legacy trigger-only `set_invoices_updated_at()` `PUBLIC EXECUTE` caveat is explicitly accepted for this release. The replay does not mean the current September 23 file revisions were applied live; the manual buyer-signed Pay handoff is implemented, but real Mainnet use remains held pending final review and explicit authorization. No testnet schema/data or reconciliation behavior is changed.
- Its `payment_network` backfill must preserve every explicit supported value and every legacy `NULL`. Backfill `x-layer-mainnet` only for an already-paid invoice whose payment transaction hash matches an immutable chain-196 settlement joined to that invoice's chain-196 preparation. A preparation by itself is never payment evidence; do not rewrite known testnet records. Repository reads map `NULL` to legacy testnet compatibility and reject any unknown non-null network value.
- A paid retry is valid only for a mainnet-paid invoice and the same persisted preparation, chain, transaction, and byte-identical verified evidence. It must not accept testnet-paid invoices or substituted client evidence.
- Enforce case-insensitive `(chain_id, transaction_hash)` uniqueness at the database level for mainnet settlement and submission records, in addition to existing uniqueness constraints.
- Privileged reconciliation function creation/replacement and its PUBLIC/role revoke/grant statements must be explicitly enclosed in a PostgreSQL transaction. Validate migration files in sequence against a disposable NON-LIVE PostgreSQL/Supabase instance; never point migration checks at live credentials.
- Handoff authorization is generated by the server/database before preparation expiry and binds one exact preparation/calldata. It authorizes starting the wallet handoff only while fresh; later RPC observation may happen after expiry only for the exact transaction bound to that authorization. Expired, unused preparation cannot initiate a new handoff. Never trust a client timestamp.
- Verify a buyer-signed, non-transaction handoff message bound to the invoice, preparation and calldata hashes, buyer, chain, and expiry before reserving a handoff. The wallet transaction remains the separate payment-consent step. Enforce one handoff per invoice with the separate database-unique `mainnet_handoffs.invoice_id` index; retain the handoff UUID primary key and preparation uniqueness. Duplicate invoice lookup must fail closed. The handoff is the single Mainnet payment attempt: after it exists, never return another swap wallet transaction for that invoice, regardless of wallet rejection, browser loss, or missing hash. A recorded submission/hash can only be recovered and canonically reconciled; without one, show the payment as unresolved and require a new invoice for another attempt. Do not create another preparation/handoff, request another OKX `/swap`, or request approval. Browser storage cannot authorize another swap.
- Live database prerequisites previously verified: the earlier September 22/23 migration versions are present, the per-table `service_role` ACL correction was applied separately, and RLS, function privileges, triggers, uniqueness indexes, and evidence integrity passed read-only verification. The current September 23 file revisions have passed the final seven-migration replay on verified non-live Neon, including the current ACL matrix, A–E backfill cases, atomic finalization, idempotency, rollback, and cleanup; that replay did not contact live Supabase. The trigger-only `set_invoices_updated_at()` `PUBLIC EXECUTE` caveat is accepted for this release. The separate `20260924000000_mainnet_handoff_invoice_unique.sql` migration has been applied successfully live: precheck found 0 handoff rows and 0 duplicate `invoice_id` values; `UNIQUE(mainnet_handoffs.invoice_id)` is present and valid; existing `preparation_id` uniqueness and the handoff primary key remain intact; RLS/ACL were unchanged; and no evidence rows were modified. The invoice-level uniqueness blocker is cleared. Buyer-signed Mainnet swap execution is implemented, but no real Mainnet swap has been sent; a real payment remains prohibited pending final review and separate user authorization. Any future live migration application requires separate explicit user direction and a clean pre-live evidence-ledger check.
- The buyer-signed Mainnet Pay handoff is implemented as described above. Before the final Sol High review, do not conduct a real Mainnet payment. Preserve the fresh same-calldata recheck, existing exact allowance, manual wallet confirmation, post-submit observation/reconciliation, and all verifier gates. Never add automatic submission or backend signing/broadcast.
- Do not modify `TestnetSettlementAdapter`, chain-1952 addresses, testnet Builder Code, or testnet reconciliation.

### Optional Phase 8 — tiny mainnet proof

- Only after the isolated Mainnet Phase 1 preparation, with explicit user approval, available funds, verified official xStock route, and completed pre-mainnet Sol High review.
- Use `OKXDEXMainnetAdapter`.
- Keep it tiny and separately documented.
- Do not let it replace or weaken the testnet demo.

## 10. Phase report template

Use this structure when a phase is complete:

```text
Phase completed: <name>

Files changed:
- ...

Tests:
- <command/test> — PASS/FAIL

Manual demo:
- <steps> — PASS/FAIL

Environment/configuration:
- ...

Contracts and addresses:
- ...

Transactions/evidence:
- ...

README/source-of-truth updates:
- ...

Known limitations:
- ...

Required GPT-5.6 Sol High review:
- <REQUIRED / NOT YET REQUIRED>
- Review focus: ...

Next phase:
- <name only; do not start it before approval>

Approval required:
Please approve this completed phase before I commit and push it.
```

The final line is operational, not optional. Wait for explicit approval, then commit and push only the approved phase.

## 11. Change-control rule

If a requested change affects a locked feature, canonical name, contract responsibility, adapter, network strategy, Builder Codes requirement, README policy, review checkpoint, or non-goal, update both `PORTPAY_SPEC.md` and `AGENTS.md` before implementation. Do not leave contradictory instructions in place.
