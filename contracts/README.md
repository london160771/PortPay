# PortPay Contracts

This is the independent Solidity/Foundry workspace for PortPay. Phase 3 contains the first clearly labeled testnet portfolio asset, `DemoAAPL`, the minimal `PortPaySettlement` contract, and reproducible deployment, minting, and settlement-funding scripts.

`DemoAAPL` is an ordinary ERC-20 test asset. It is not an official xStock and is not backed by Apple shares. `PortPaySettlement` is a narrowly configured X Layer Testnet portfolio-settlement contract; it is not a DEX, AMM, marketplace, or general vault. `DemoNVDA`, Smart Spend, receipts/history, Builder Codes, and mainnet settlement remain later-phase work.

## Windows Foundry setup

Use the official Foundry installer or the pinned Windows release under `contracts/.tools/foundry` used by this checkout. This avoids requiring WSL:

```bash
curl -L https://foundry.paradigm.xyz | bash
export PATH="$PATH:$HOME/.foundry/bin"
foundryup
```

Then run `forge fmt --check`, `forge build`, and `forge test` from this directory. In the managed Codex host, use `& .\\.tools\\foundry\\forge.exe` with the pinned compiler path shown in the root README because Foundry's optional global local-signature cache cannot resolve that host's restricted Windows profile. Both tool directories are ignored by Git and contain no application source.

## X Layer Testnet scripts

Copy `.env.example` to `.env` locally, fill in a burner-wallet `PRIVATE_KEY`, and keep that file untracked. After deployment, copy the printed address into `DEMO_AAPL_ADDRESS` before minting:

```bash
forge script script/DeployDemoAAPL.s.sol:DeployDemoAAPL --rpc-url xlayer_testnet --broadcast
forge script script/MintDemoAAPL.s.sol:MintDemoAAPL --rpc-url xlayer_testnet --broadcast
forge script script/DeployPortPaySettlement.s.sol:DeployPortPaySettlement --rpc-url xlayer_testnet --broadcast
forge script script/FundPortPaySettlement.s.sol:FundPortPaySettlement --rpc-url xlayer_testnet --broadcast
```

`DEMO_AAPL_MINT_AMOUNT` and `SETTLEMENT_FUND_AMOUNT` are expressed in each token's smallest units. `QUOTE_SIGNER_ADDRESS` must correspond to the backend's `QUOTE_SIGNER_PRIVATE_KEY`. The settlement deployment and funding scripts require official testnet USD₮0 at `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`; funding also checks the deployed settlement's stablecoin getter. These scripts reject non-1952 deployments and are testnet-only; no mainnet deployment is required.
