// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Phase0Foundation } from "../src/Phase0Foundation.sol";

contract Phase0FoundationTest {
    function testPortPayFoundationConstants() public {
        Phase0Foundation foundation = new Phase0Foundation();
        require(
            keccak256(bytes(foundation.PRODUCT_NAME())) == keccak256(bytes("PortPay")),
            "wrong product name"
        );
        require(foundation.X_LAYER_TESTNET_CHAIN_ID() == 1952, "wrong chain id");
    }
}
