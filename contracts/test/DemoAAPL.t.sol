// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { DemoAAPL } from "../src/DemoAAPL.sol";

contract DemoAAPLAttacker {
    function attemptMint(DemoAAPL token, address recipient) external {
        token.mint(recipient, 1 ether);
    }
}

contract DemoAAPLSpender {
    function spend(DemoAAPL token, address from, address to, uint256 amount) external {
        token.transferFrom(from, to, amount);
    }
}

contract DemoAAPLTest {
    DemoAAPL private token;
    address private constant RECIPIENT = address(0xBEEF);

    function setUp() public {
        token = new DemoAAPL(address(this));
    }

    function testMetadataClearlyIdentifiesDemoAsset() public view {
        require(
            keccak256(bytes(token.name())) == keccak256(bytes("DemoAAPL Test Asset")),
            "unexpected name"
        );
        require(keccak256(bytes(token.symbol())) == keccak256(bytes("dAAPL")), "unexpected symbol");
        require(token.decimals() == 18, "unexpected decimals");
        require(token.owner() == address(this), "unexpected owner");
    }

    function testOwnerCanMintAndSupplyMatchesBalance() public {
        uint256 amount = 25 ether;
        token.mint(RECIPIENT, amount);

        require(token.totalSupply() == amount, "supply mismatch");
        require(token.balanceOf(RECIPIENT) == amount, "balance mismatch");
    }

    function testNonOwnerCannotMint() public {
        DemoAAPLAttacker attacker = new DemoAAPLAttacker();
        (bool success,) = address(attacker)
            .call(abi.encodeWithSelector(attacker.attemptMint.selector, token, RECIPIENT));
        require(!success, "non-owner mint succeeded");
    }

    function testTransferAndAllowance() public {
        uint256 amount = 10 ether;
        token.mint(address(this), amount);
        require(token.transfer(RECIPIENT, 3 ether), "transfer failed");
        require(token.balanceOf(RECIPIENT) == 3 ether, "recipient balance mismatch");

        DemoAAPLSpender spender = new DemoAAPLSpender();
        require(token.approve(address(spender), 4 ether), "approval failed");
        require(token.allowance(address(this), address(spender)) == 4 ether, "allowance mismatch");

        spender.spend(token, address(this), RECIPIENT, 4 ether);
        require(token.balanceOf(RECIPIENT) == 7 ether, "transferFrom balance mismatch");
        require(token.allowance(address(this), address(spender)) == 0, "allowance not consumed");

        (bool success,) = address(token)
            .call(
                abi.encodeWithSelector(
                    token.transferFrom.selector, address(this), RECIPIENT, 1 ether
                )
            );
        require(!success, "unauthorized transferFrom succeeded");
    }

    function testRejectsInvalidTransfersAndMintRecipient() public {
        (bool mintSuccess,) =
            address(token).call(abi.encodeWithSelector(token.mint.selector, address(0), 1 ether));
        require(!mintSuccess, "zero address mint succeeded");

        (bool transferSuccess,) = address(token)
            .call(abi.encodeWithSelector(token.transfer.selector, address(0), 1 ether));
        require(!transferSuccess, "zero address transfer succeeded");
    }
}
