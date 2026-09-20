// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { DemoNVDA } from "../src/DemoNVDA.sol";

contract DemoNVDATest is Test {
    address private owner = address(0xA11CE);
    address private recipient = address(0xB0B);
    DemoNVDA private token;

    function setUp() public {
        token = new DemoNVDA(owner);
    }

    function testMetadataAndOwnerMint() public {
        assertEq(token.name(), "DemoNVDA");
        assertEq(token.symbol(), "dNVDA");
        assertEq(token.decimals(), 18);

        vm.prank(owner);
        token.mint(recipient, 2 ether);
        assertEq(token.balanceOf(recipient), 2 ether);
        assertEq(token.totalSupply(), 2 ether);
    }

    function testNonOwnerCannotMint() public {
        vm.expectRevert(DemoNVDA.NotOwner.selector);
        token.mint(recipient, 1 ether);
    }

    function testTransferAndAllowance() public {
        vm.prank(owner);
        token.mint(recipient, 1 ether);
        address spender = address(0xCAFE);
        vm.prank(recipient);
        token.approve(spender, 0.25 ether);
        vm.prank(spender);
        token.transferFrom(recipient, owner, 0.25 ether);
        assertEq(token.balanceOf(recipient), 0.75 ether);
        assertEq(token.balanceOf(owner), 0.25 ether);
    }
}
