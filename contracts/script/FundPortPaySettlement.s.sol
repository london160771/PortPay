// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

interface IERC20Funding {
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IPortPaySettlementFunding {
    function stablecoin() external view returns (address);
}

contract FundPortPaySettlement is Script {
    address private constant OFFICIAL_TESTNET_USDT0 = 0x9e29b3AaDa05Bf2D2c827Af80Bd28Dc0b9b4FB0c;

    function run() external {
        require(block.chainid == 1952, "X Layer Testnet only");

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address settlement = vm.envAddress("PORTPAY_SETTLEMENT_ADDRESS");
        address usdt0 = vm.envAddress("TESTNET_USDT0_ADDRESS");
        uint256 amount = vm.envUint("SETTLEMENT_FUND_AMOUNT");
        require(usdt0 == OFFICIAL_TESTNET_USDT0, "Official testnet USDt0 required");
        require(settlement.code.length > 0, "Settlement contract not deployed");
        require(
            IPortPaySettlementFunding(settlement).stablecoin() == usdt0,
            "Settlement stablecoin mismatch"
        );
        require(amount > 0, "Funding amount must be positive");

        vm.startBroadcast(deployerKey);
        bool success = IERC20Funding(usdt0).transfer(settlement, amount);
        vm.stopBroadcast();
        require(success, "USDt0 funding transfer failed");

        console2.log("PortPaySettlement funded with raw USDt0 amount", amount);
        console2.log("Settlement contract", settlement);
    }
}
