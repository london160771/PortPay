# PortPay — Source-of-Truth Product and Technical Specification

**Status:** Baseline source of truth  
**Last updated:** 2026-09-17  
**Repository:** <https://github.com/london160771/PortPay>  
**Builder Kit reference:** <https://www.okx.com/learn/okx-dev-day-builder-kit>

This document is the product, architecture, scope, and phase-plan authority for PortPay. `AGENTS.md` is the execution and repository-workflow authority. If implementation, README, or conversation notes conflict with these documents, stop and resolve the documents first; do not silently invent a third interpretation.

## 1. Product identity

**Product:** PortPay  
**Tagline:** Spend your portfolio. Merchants get stablecoins.  
**Short description:** PortPay lets buyers pay with tokenized portfolio assets while merchants receive stablecoins on X Layer.

### Problem

Users may hold tokenized stocks or other portfolio assets onchain, but merchants want a simple stablecoin amount. Today, paying with a portfolio asset usually requires the buyer to sell or swap it manually before sending a separate stablecoin payment. That is too much friction for ordinary commerce.

### Solution

A merchant creates an invoice denominated in stablecoins. The buyer opens a payment link, selects a supported portfolio asset, and confirms payment. PortPay settles the payment so the merchant receives the requested stablecoin and both sides receive a verifiable receipt.

The product is a payment layer, not a marketplace, exchange, trading bot, or investment adviser.

## 2. Scope that is locked for the MVP

The following are required features, not optional ideas:

1. **Merchant invoice and payment-link flow** — a merchant enters a product or service name and stablecoin amount, creates an invoice, and receives a shareable payment link. A QR presentation may be added if it is trivial, but the payment link is required.
2. **Buyer checkout** — the buyer opens the link, connects a wallet, sees the amount due and supported assets, selects an asset, reviews the quote, and approves payment.
3. **Testnet portfolio settlement** — the buyer pays with a demo tokenized asset and the merchant receives official X Layer Testnet `USD₮0`.
4. **Merchant stablecoin receipt** — the merchant dashboard updates to show payment received, amount received, asset spent, status, and transaction link.
5. **Smart Spend** — deterministic portfolio-aware recommendation of which supported asset to spend. This begins with `DemoAAPL` and adds `DemoNVDA` only after the core payment flow works.
6. **Smart Payment History** — a clear history of what the buyer spent, what the merchant received, why Smart Spend made a recommendation, payment status, and the X Layer transaction.
7. **OKX/X Layer Builder Codes** — PortPay-generated eligible transactions must carry the registered Builder Code attribution using the current OKX/X Layer Builder Codes mechanism, including ERC-8021 requirements where applicable.
8. **Two-sided demo** — the judge can see a merchant tab create an invoice and a separate buyer tab complete checkout, then return to the merchant tab to see the receipt.

### Asset progression

- **Phase 1 — Wallet + Demo Assets:** prepare one ordinary EVM ERC-20 demo asset named `DemoAAPL` and the wallet/balance foundation needed to use it later.
- **Phase 3 — Core Settlement:** implement the smallest safe `PortPaySettlement` flow around the configured demo asset and official testnet `USD₮0`.
- **Smart Spend phase:** add a second ordinary EVM ERC-20 demo asset named `DemoNVDA` so a recommendation has a meaningful choice.
- **Do not initially create:** `DemoSPY`, a large asset catalog, official testnet xStocks, or a liquidity pool.
- `DemoAAPL` and `DemoNVDA` are clearly labeled demo assets and must never be presented as backed by Apple or NVIDIA shares.
- Use official X Layer Testnet `USD₮0` for merchant settlement. Do not create a replacement stablecoin for the MVP.
- Use test OKB for gas through the official X Layer Testnet faucet/process.

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
   - Supported balances: initially `DemoAAPL`; later `DemoNVDA` and `USD₮0` where useful for display.
   - Manual asset selection and Smart Spend recommendation when Smart Spend is available.
   - A clear quote such as:

     ```text
     You spend: 0.0800 DemoAAPL
     Merchant receives: 20.00 USD₮0
     Network: X Layer Testnet
     Demo reference price: 250.00 USD
     ```

   - Explicit **Demo asset — not backed by real shares** and **Testnet** labels.
   - Approve and pay action followed by confirmation state.

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
- a clear testnet/demo label.

The history should make it easy to answer: **what did the buyer spend, what did the merchant receive, why was that asset selected, and which X Layer transaction proves it?**

## 6. Technical architecture

### Locked baseline stack

- **Frontend:** React + Vite.
- **Wallet and chain client:** `wagmi` + `viem`.
- **Backend:** Node.js + Express + TypeScript.
- **MVP persistence:** Supabase/Postgres behind a repository/data-access boundary. Supabase is the required hosted Postgres provider for PortPay; SQLite is not an implementation option.
- **Chain:** X Layer Testnet first, chain ID `1952`.
- **Future chain:** X Layer Mainnet, chain ID `196`, only in the optional mainnet phase.

### Components

| Component | Responsibility |
|---|---|
| React client | Landing, merchant dashboard, invoice creation, buyer checkout, receipt, history, wallet UX |
| Node backend | Invoice/payment-link metadata, demo reference prices, quote creation/validation, status indexing, history metadata |
| `DemoAAPL` | Small ordinary EVM ERC-20 test asset for the first complete flow |
| `DemoNVDA` | Second small ordinary EVM ERC-20 test asset added for Smart Spend |
| `PortPaySettlement` | Minimal onchain testnet settlement contract |
| Official testnet `USD₮0` | Merchant settlement asset; do not replace with an app-created stablecoin |
| `TestnetSettlementAdapter` | Adapter that executes the prefunded testnet settlement-contract flow |
| `OKXDEXMainnetAdapter` | Future adapter for the OKX DEX Swap API and real mainnet xStock routes |
| Builder Code integration | App-side attribution for eligible PortPay-generated transactions |

### Canonical names

Use these names exactly in code, docs, UI copy, and reports:

- Product: `PortPay`.
- Main settlement contract: `PortPaySettlement`.
- Testnet adapter: `TestnetSettlementAdapter`.
- Future mainnet adapter: `OKXDEXMainnetAdapter`.
- First demo asset: `DemoAAPL`.
- Smart Spend asset: `DemoNVDA`.
- Official testnet stablecoin: `USD₮0`.

`PortfolioPay` is an obsolete working name from early ideation. Do not introduce it in new files, identifiers, UI, contract names, or README text.

## 7. Testnet settlement design

Public OKX DEX routing is not assumed to be available for X Layer Testnet. Therefore the testnet MVP uses **portfolio settlement**, also describable as **testnet simulated RWA conversion**, rather than a DEX swap.

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

## 9. Mainnet upgrade path — optional and later

The mainnet path is intentionally separated from the required testnet MVP.

`OKXDEXMainnetAdapter` is the future replacement for `TestnetSettlementAdapter`. It may use the OKX DEX Swap API on X Layer Mainnet to route a real eligible xStock/unified tokenized stock into the merchant’s requested stablecoin, then produce the same PortPay receipt/history shape.

The optional mainnet proof is allowed only when all of the following are true:

- the user explicitly approves the mainnet test and provides/approves the funds;
- the official xStock asset and OKX route are currently available and verified;
- GPT-5.6 Sol High has completed the required pre-mainnet review;
- wallet, slippage, approval, amount, contract, and failure handling are documented;
- the README clearly distinguishes mainnet proof from the testnet demo.

No mainnet money is required for the MVP. Do not make mainnet a hidden dependency of testnet development.

## 10. Environment variables and addresses

The exact deployed addresses are configuration, not assumptions. Once known, they must be recorded in `README.md` and the appropriate environment example without secrets.

Expected configuration includes:

```text
VITE_CHAIN_ID=1952
X_LAYER_TESTNET_RPC_URL=
X_LAYER_TESTNET_EXPLORER_URL=
TESTNET_USDT0_ADDRESS=0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c
DEMO_AAPL_ADDRESS=
DEMO_NVDA_ADDRESS=
PORTPAY_SETTLEMENT_ADDRESS=
PORTPAY_BUILDER_CODE=
DEMO_PRICE_SOURCE=
DATABASE_URL=
SUPABASE_URL=
SUPABASE_ANON_KEY=
```

The `USD₮0` address above is the address recorded during the planning research and must be checked against current official X Layer documentation before deployment/use. Do not silently substitute a different stablecoin. Mainnet-only OKX API credentials and mainnet addresses must not be required by the testnet path and must never be committed.

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

The required MVP is complete only when:

- a merchant can create an invoice and payment link;
- a separate buyer tab can open checkout and connect a wallet;
- the buyer can pay with `DemoAAPL` on X Layer Testnet;
- `PortPaySettlement` transfers official testnet `USD₮0` to the merchant;
- the transaction confirms and is linked to the X Layer explorer;
- the merchant sees a stablecoin receipt;
- Smart Payment History records the payment and its reason/metadata;
- `DemoNVDA` and deterministic Smart Spend work in the later feature phase;
- eligible transactions carry Builder Code attribution;
- tests cover settlement math, decimals, replay protection, expiry, permissions, and failure cases;
- the README documents setup, architecture, features, environment variables, deployed addresses, demo steps, and known limitations;
- the final two-tab demo is reproducible from a clean checkout.

## 13. Mandatory phased build plan

Only one phase may be active at a time. Phase names below are canonical.

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

### Phase 2 — Checkout

- Implement the merchant invoice/payment-link flow.
- Implement buyer checkout and manual `DemoAAPL` payment.

### Phase 3 — Core Settlement

- Implement/deploy and test `PortPaySettlement` for the smallest safe settlement flow.
- Configure official testnet `USD₮0` and test OKB.
- Fund the settlement contract with testnet `USD₮0`.
- Wire `TestnetSettlementAdapter`.
- Complete one real X Layer Testnet settlement and merchant receipt.

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

**Mandatory GPT-5.6 Sol High review checkpoint:** immediately after Builder Codes integration. Review encoding/attachment, transaction construction, wallet behavior, attribution evidence, and whether every eligible PortPay-generated transaction is covered.

### Phase 7 — Product polish and final submission readiness

- Polish landing, dashboard, checkout, receipt, and history UX.
- Keep the visual language clean and fintech-like.
- Make Testnet/demo labels and limitations impossible to miss.
- Update README and both source-of-truth documents for any material changes.
- Prepare the reproducible two-tab judge demo and submission evidence.

**Mandatory GPT-5.6 Sol High review checkpoint:** before final submission and before any mainnet test. Review the complete implementation, contracts, Builder Codes, documentation, security assumptions, demo claims, and known limitations.

### Optional Phase 8 — Tiny mainnet proof

Only after the Phase 7 Sol High review and separate explicit user approval. Implement/use `OKXDEXMainnetAdapter` for one deliberately tiny real xStock-to-stablecoin proof if the route, funds, and safety conditions are available. This phase is optional and must not delay or weaken the testnet submission.

## 14. Change-control rule

Any change to a locked feature, asset progression, adapter name, chain strategy, contract responsibility, Builder Code requirement, phase gate, or scope guardrail must first update both `PORTPAY_SPEC.md` and `AGENTS.md`, then wait for user approval before implementation proceeds. The README must be updated in the same phase whenever setup, architecture, features, environment variables, contracts, addresses, demo steps, or known limitations change.
