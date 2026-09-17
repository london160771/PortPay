// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { DemoAAPL } from "../src/DemoAAPL.sol";

contract DeployDemoAAPL is Script {
    function run() external returns (DemoAAPL token) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        token = new DemoAAPL(deployer);
        vm.stopBroadcast();

        console2.log("DemoAAPL deployed at", address(token));
        console2.log("DemoAAPL owner", deployer);
    }
}
