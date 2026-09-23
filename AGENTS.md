# PortPay Agent Instructions

This file is the execution and repository-workflow authority for PortPay. Read it together with `PORTPAY_SPEC.md` before changing the project. Both files are source of truth throughout the build.

**Repository:** <https://github.com/london160771/PortPay>  
**Product:** PortPay — Spend your portfolio. Merchants get stablecoins.  
**Primary network:** X Layer Testnet, chain ID `1952`  
**Optional future network:** X Layer Mainnet, chain ID `196`

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
- `OKXDEXMainnetAdapter` — optional future mainnet adapter.
- `DemoAAPL` — first demo ERC-20.
- `DemoNVDA` — second demo ERC-20 for Smart Spend.
- `USD₮0` — official X Layer Testnet settlement stablecoin.
- `Smart Spend` — deterministic portfolio-aware asset recommendation.
- `Smart Payment History` — history/receipt feature.
- `Builder Codes` — OKX/X Layer transaction attribution.

`PortfolioPay` is an obsolete early working name. Do not add it to new code, identifiers, UI, docs, screenshots, commit messages, or README text. If it is found in an existing file, normalize it to `PortPay` unless the file is an external historical artifact.

Do not call the X Layer Testnet prefunded-contract flow a “DEX swap.” Use **portfolio settlement** or **testnet simulated RWA conversion**. Reserve “OKX DEX swap” for the optional `OKXDEXMainnetAdapter` path.

## 4. Features that must not be omitted

The MVP is not complete if any of these are missing:

- merchant creates an invoice;
- merchant receives a shareable payment link;
- buyer checkout opens from that link;
- buyer pays with `DemoAAPL` on X Layer Testnet;
- merchant receives official testnet `USD₮0`;
- payment receipt includes what was spent, what was received, and the X Layer transaction;
- Smart Payment History records the payment and relevant reason/status metadata;
- Smart Spend recommends between portfolio assets using deterministic allocation rules;
- `DemoNVDA` is added for the Smart Spend phase, after core settlement;
- OKX/X Layer Builder Codes are attached to eligible PortPay-generated transactions;
- the two-tab merchant/buyer demo works;
- `TestnetSettlementAdapter` is the testnet path;
- `OKXDEXMainnetAdapter` remains the named future upgrade path;
- an optional tiny mainnet proof remains possible later but is not a testnet prerequisite;
- README and both source-of-truth documents remain current.

## 5. Architecture guardrails

- Start on X Layer Testnet (`1952`) with test OKB gas and official testnet `USD₮0`.
- Deploy only the small demo ERC-20 assets needed: `DemoAAPL` first, `DemoNVDA` later.
- Use React + Vite, `wagmi` + `viem`, a small Node.js + Express + TypeScript backend, and Supabase/Postgres behind a repository/data-access boundary as described in the spec.
- Keep invoice metadata, product names, demo prices, status indexing, and searchable history offchain; keep ownership, settlement, payment, and compact receipt events onchain.
- Do not build a full AMM, oracle, marketplace, token, DAO, multi-chain system, trading bot, or unnecessary AI layer.
- Smart Spend must be deterministic and explainable for the MVP. It is not financial advice.
- Demo reference prices must be labeled as demo values, not market prices.
- Read and test token decimals; never assume all assets use the same decimal precision.
- The settlement contract must prevent duplicate invoice settlement, validate expiry and participants, and fail atomically.
- Never put private keys, seed phrases, populated `.env` files, or API secrets in the repository.
- Never make mainnet funds or mainnet API credentials a hidden dependency of the testnet flow.

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
- clean two-tab manual demo on X Layer Testnet.

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

### Phase 7 — Polish/submission

- Polish the clean fintech UI.
- Make testnet/demo limitations prominent.
- Update README, `PORTPAY_SPEC.md`, and `AGENTS.md` for all material changes.
- Prepare the two-tab judge demo and final evidence.
- Current implementation note (2026-09-21): the merchant and buyer surfaces use a three-step handoff, touch-friendly actions, explicit loading/empty/success/failure states, and isolated development-only Builder Code diagnostics. The presentation pass does not change settlement, quote, Smart Spend, history, or Builder Code logic.
- A separate pre-mainnet readiness pass may add role-separated merchant/buyer routes, nested product documentation, and a minimal authenticated server-to-server merchant integration above the invoice/payment layer. It must not start `OKXDEXMainnetAdapter`, add mainnet configuration, change settlement/security logic, send transactions, or bypass the existing verified reconciliation path.
- Stop for GPT-5.6 Sol High review before final submission or any mainnet test.

### Mainnet Phase 1 — isolated adapter preparation

- Add only isolated chain-196 configuration and server-side authenticated OKX V6 read-only quote/transaction preparation.
- Keep `OKXDEXMainnetAdapter` preparation-only: no wallet funding, approvals, deployments, Builder Code registration, broadcasts, or mainnet transactions.
- Validate direct merchant-recipient preparation, exact approvals, quote freshness, router/spender binding, and ERC-8021 suffix construction.
- Do not modify `TestnetSettlementAdapter`, testnet addresses, or the proven testnet flow.
- Do not enable live mainnet execution until the user explicitly approves it after the required Sol High review.

### Mainnet Phase 2 — Builder Code registration, preflight, and receipt design

- Keep `PORTPAY_MAINNET_BUILDER_CODE` and `PORTPAY_MAINNET_BUILDER_PAYOUT_ADDRESS` empty until the user completes the official OKX Developer Portal mainnet registration.
- Document the manual portal flow: connect the owning wallet, verify the address, create the mainnet Builder Code, and record the generated code and payout address.
- Do not call the testnet `registerAuto` flow for mainnet and never reuse `kob1lkgsg6infkg3`.
- Verify the separate mainnet code by reading `payoutAddress(uint256)` from registry `0xd6c426f9c077358735622ae5a83468dc0510823b` on chain `196`; require an exact configured payout match.
- Add only deterministic, read-only preflight for chain, invoice/quote binding, tokens, amounts, freshness, slippage, router, spender, calldata, recipient, native value, balances, allowance, OKB gas, Builder Code suffix, and `eth_call` simulations.
- Persist immutable preparation evidence (invoice/quote, parties, chain/tokens/amounts, router/spender, exact attributed approval/swap calldata and hashes, Builder Code/payout, snapshot block, and expiry) before any future wallet approval can be considered.
- Read balances and decimals at a pinned snapshot block; require 18 decimals for wNVDAx/wAAPLx and 6 for mainnet USD₮0. Stage A reads pinned allowance first. If it is not exactly the required input amount, simulate the exact attributed approval, validate non-empty ERC-20 return data is `true`, and return `APPROVAL_REQUIRED`; below, above, and unlimited allowances are rejected, and no swap gas estimate/simulation runs. Stage B is permitted only when pinned allowance equals the exact required amount; estimate gas from the exact attributed approval and swap calls, apply the documented 20% safety margin, simulate the exact swap, then evaluate OKB readiness.
- Do not return mainnet preflight `READY` for any allowance other than exact equality with the quoted input amount. `READY` remains preparation-only and never authorizes broadcast.
- Add a write-free future receipt/reconciliation verifier requiring exact persisted attributed calldata, matching configured/prepared/onchain Builder Code and payout, canonical adjacent before/receipt blocks, block-pinned exact buyer/merchant balance deltas, confirmation depth, and atomic repository-backed claims.
- Enforce unique settlement per invoice and unique `(chain_id, transaction_hash)` with database constraints and one atomic claim. A duplicate/retried claim is non-mutating and must not produce a second `paid` result.
- Keep mainnet receipts explicitly not live-ready until these controls, the migration, a registered mainnet Builder Code, and the required Sol High review are complete.
- Model mainnet payment states separately (`pending`, `prepared`, `ready`, `submitted`, `confirming`, `paid`, `failed`, `expired`) without changing testnet invoice states.
- Missing or unregistered mainnet Builder Code must never produce live-ready status.
- Do not add private-key execution, wallet send methods, write API endpoints, transaction broadcast, funding, approval, swap, deployment, or any mainnet transaction.
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
