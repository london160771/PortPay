// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { PortPaySettlement } from "../src/PortPaySettlement.sol";

contract DeployPortPaySettlement is Script {
    address private constant OFFICIAL_TESTNET_USDT0 = 0x9e29b3AaDa05Bf2D2c827Af80Bd28Dc0b9b4FB0c;

    function run() external returns (PortPaySettlement settlement) {
        require(block.chainid == 1952, "X Layer Testnet only");

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address quoteSigner = vm.envAddress("QUOTE_SIGNER_ADDRESS");
        address demoAapl = vm.envAddress("DEMO_AAPL_ADDRESS");
        address demoNvda = vm.envAddress("DEMO_NVDA_ADDRESS");
        address usdt0 = vm.envAddress("TESTNET_USDT0_ADDRESS");
        require(usdt0 == OFFICIAL_TESTNET_USDT0, "Official testnet USDt0 required");

        vm.startBroadcast(deployerKey);
        settlement = new PortPaySettlement(quoteSigner, demoAapl, demoNvda, usdt0);
        vm.stopBroadcast();

        console2.log("PortPaySettlement deployed at", address(settlement));
        console2.log("Quote signer", quoteSigner);
        console2.log("DemoAAPL", demoAapl);
        console2.log("DemoNVDA", demoNvda);
        console2.log("USDt0", usdt0);
    }
}
