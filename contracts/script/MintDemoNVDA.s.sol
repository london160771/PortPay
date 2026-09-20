// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { DemoNVDA } from "../src/DemoNVDA.sol";

contract MintDemoNVDA is Script {
    function run() external {
        require(block.chainid == 1952, "X Layer Testnet only");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        DemoNVDA token = DemoNVDA(vm.envAddress("DEMO_NVDA_ADDRESS"));
        address recipient = vm.envAddress("DEMO_NVDA_MINT_TO");
        uint256 amount = vm.envUint("DEMO_NVDA_MINT_AMOUNT");

        vm.startBroadcast(deployerKey);
        token.mint(recipient, amount);
        vm.stopBroadcast();

        console2.log("DemoNVDA minted to", recipient);
        console2.log("Raw amount", amount);
    }
}
