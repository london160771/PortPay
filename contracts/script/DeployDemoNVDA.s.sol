// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { DemoNVDA } from "../src/DemoNVDA.sol";

contract DeployDemoNVDA is Script {
    function run() external returns (DemoNVDA token) {
        require(block.chainid == 1952, "X Layer Testnet only");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        token = new DemoNVDA(deployer);
        vm.stopBroadcast();

        console2.log("DemoNVDA deployed at", address(token));
        console2.log("DemoNVDA owner", deployer);
    }
}
