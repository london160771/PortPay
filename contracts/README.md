# PortPay Contracts

This is the independent Solidity/Foundry workspace for PortPay. Phase 1 contains the first clearly labeled testnet portfolio asset, `DemoAAPL`, plus reproducible deployment and minting scripts.

`DemoAAPL` is an ordinary ERC-20 test asset. It is not an official xStock and is not backed by Apple shares. `PortPaySettlement`, `DemoNVDA`, and all payment/settlement behavior belong to later phases and are intentionally not implemented here.

## Windows Foundry setup

Use Git for Windows Bash with the official Foundry installer. This avoids requiring WSL:

```bash
curl -L https://foundry.paradigm.xyz | bash
export PATH="$PATH:$HOME/.foundry/bin"
foundryup
```

Then run `forge fmt --check`, `forge build`, and `forge test` from this directory. In the managed Codex host, use the pinned compiler path shown in the root README because Foundry's optional global local-signature cache cannot resolve that host's restricted Windows profile. The pinned binary is ignored by Git and only needs to be downloaded when that fallback is required.

## X Layer Testnet scripts

Copy `.env.example` to `.env` locally, fill in a burner-wallet `PRIVATE_KEY`, and keep that file untracked. After deployment, copy the printed address into `DEMO_AAPL_ADDRESS` before minting:

```bash
forge script script/DeployDemoAAPL.s.sol:DeployDemoAAPL --rpc-url xlayer_testnet --broadcast
forge script script/MintDemoAAPL.s.sol:MintDemoAAPL --rpc-url xlayer_testnet --broadcast
```

`DEMO_AAPL_MINT_AMOUNT` is expressed in the token's smallest units. These scripts are testnet-only workflow scaffolding; no mainnet deployment is required.
