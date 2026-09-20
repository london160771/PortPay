// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { DemoAAPL } from "../src/DemoAAPL.sol";

contract MintDemoAAPL is Script {
    function run() external {
        require(block.chainid == 1952, "X Layer Testnet only");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        DemoAAPL token = DemoAAPL(vm.envAddress("DEMO_AAPL_ADDRESS"));
        address recipient = vm.envAddress("DEMO_AAPL_MINT_TO");
        uint256 amount = vm.envUint("DEMO_AAPL_MINT_AMOUNT");

        vm.startBroadcast(deployerKey);
        token.mint(recipient, amount);
        vm.stopBroadcast();

        console2.log("DemoAAPL minted to", recipient);
        console2.log("Raw amount", amount);
    }
}
