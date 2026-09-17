// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Phase0Foundation} from "../src/Phase0Foundation.sol";

contract Phase0FoundationTest {
    function testPortPayFoundationConstants() public pure {
        require(
            keccak256(bytes(Phase0Foundation.PRODUCT_NAME())) == keccak256(bytes("PortPay")),
            "wrong product name"
        );
        require(Phase0Foundation.X_LAYER_TESTNET_CHAIN_ID() == 1952, "wrong chain id");
    }
}
