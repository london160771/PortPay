// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { DemoAAPL } from "../src/DemoAAPL.sol";
import { PortPaySettlement } from "../src/PortPaySettlement.sol";

contract MockSettlementToken {
    string public name = "Mock USDt0";
    string public symbol = "mUSDt0";
    uint8 public immutable decimals;
    uint256 public totalSupply;
    mapping(address account => uint256) public balanceOf;
    mapping(address account => mapping(address spender => uint256)) public allowance;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external virtual returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        external
        virtual
        returns (bool)
    {
        require(allowance[from][msg.sender] >= amount, "allowance");
        require(balanceOf[from] >= amount, "balance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract FeeOnTransferToken is MockSettlementToken {
    constructor(uint8 decimals_) MockSettlementToken(decimals_) { }

    function transfer(address to, uint256 amount) external override returns (bool) {
        require(balanceOf[msg.sender] >= amount && amount > 0, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount - 1;
        totalSupply -= 1;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        external
        override
        returns (bool)
    {
        require(
            allowance[from][msg.sender] >= amount && balanceOf[from] >= amount && amount > 0,
            "balance or allowance"
        );
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - 1;
        totalSupply -= 1;
        return true;
    }
}

contract RejectingStablecoin is MockSettlementToken {
    constructor() MockSettlementToken(6) { }

    function transfer(address, uint256) external pure override returns (bool) {
        return false;
    }
}

contract PortPaySettlementTest is Test {
    uint256 private constant SIGNER_PRIVATE_KEY = 0xA11CE;
    uint256 private constant OTHER_PRIVATE_KEY = 0xB0B;
    address private buyer;
    address private merchant = address(0xCAFE);
    address private quoteSigner;
    DemoAAPL private demoAapl;
    MockSettlementToken private usdt0;
    PortPaySettlement private settlement;

    function setUp() public {
        vm.chainId(1952);
        buyer = vm.addr(OTHER_PRIVATE_KEY);
        quoteSigner = vm.addr(SIGNER_PRIVATE_KEY);
        demoAapl = new DemoAAPL(address(this));
        usdt0 = new MockSettlementToken(6);
        settlement = new PortPaySettlement(quoteSigner, address(demoAapl), address(usdt0));

        demoAapl.mint(buyer, 1 ether);
        usdt0.mint(address(settlement), 100 ether);
    }

    function testSettlesExactAmountsAndEmitsStructuredReceipt() public {
        PortPaySettlement.SettlementQuote memory quote = _quote(
            keccak256("invoice-1"), 80_000_000_000_000_000, 20_000_000, block.timestamp + 300
        );
        bytes memory signature = _sign(quote, SIGNER_PRIVATE_KEY);
        bytes32 expectedQuoteId = settlement.quoteDigest(quote);

        vm.prank(buyer);
        demoAapl.approve(address(settlement), quote.assetAmount);

        vm.expectEmit(true, true, true, true, address(settlement));
        emit PortPaySettlement.SettlementExecuted(
            quote.invoiceId,
            buyer,
            merchant,
            address(demoAapl),
            quote.assetAmount,
            address(usdt0),
            quote.stablecoinAmount,
            quote.expiry,
            expectedQuoteId
        );

        vm.prank(buyer);
        bytes32 quoteId = settlement.settle(quote, signature);

        assertEq(quoteId, expectedQuoteId);
        assertEq(demoAapl.balanceOf(buyer), 920_000_000_000_000_000);
        assertEq(demoAapl.balanceOf(address(settlement)), quote.assetAmount);
        assertEq(usdt0.balanceOf(merchant), quote.stablecoinAmount);
        assertTrue(settlement.settledInvoices(quote.invoiceId));
    }

    function testRejectsDuplicateInvoiceSettlement() public {
        PortPaySettlement.SettlementQuote memory quote = _quote(
            keccak256("invoice-duplicate"),
            80_000_000_000_000_000,
            20_000_000,
            block.timestamp + 300
        );
        bytes memory signature = _sign(quote, SIGNER_PRIVATE_KEY);

        vm.startPrank(buyer);
        demoAapl.approve(address(settlement), quote.assetAmount * 2);
        settlement.settle(quote, signature);
        vm.expectRevert(PortPaySettlement.QuoteAlreadySettled.selector);
        settlement.settle(quote, signature);
        vm.stopPrank();
    }

    function testRejectsExpiredQuote() public {
        PortPaySettlement.SettlementQuote memory quote = _quote(
            keccak256("invoice-expired"), 80_000_000_000_000_000, 20_000_000, block.timestamp - 1
        );

        vm.prank(buyer);
        demoAapl.approve(address(settlement), quote.assetAmount);
        bytes memory signature = _sign(quote, SIGNER_PRIVATE_KEY);
        vm.prank(buyer);
        vm.expectRevert(PortPaySettlement.QuoteExpired.selector);
        settlement.settle(quote, signature);
    }

    function testRejectsWrongSigner() public {
        PortPaySettlement.SettlementQuote memory quote = _quote(
            keccak256("invoice-wrong-signer"),
            80_000_000_000_000_000,
            20_000_000,
            block.timestamp + 300
        );

        vm.prank(buyer);
        demoAapl.approve(address(settlement), quote.assetAmount);
        bytes memory signature = _sign(quote, OTHER_PRIVATE_KEY);
        vm.prank(buyer);
        vm.expectRevert(PortPaySettlement.InvalidSignature.selector);
        settlement.settle(quote, signature);
    }

    function testInsufficientAllowanceFailsAtomically() public {
        PortPaySettlement.SettlementQuote memory quote = _quote(
            keccak256("invoice-allowance"),
            80_000_000_000_000_000,
            20_000_000,
            block.timestamp + 300
        );
        uint256 buyerBalanceBefore = demoAapl.balanceOf(buyer);
        bytes memory signature = _sign(quote, SIGNER_PRIVATE_KEY);

        vm.prank(buyer);
        vm.expectRevert(PortPaySettlement.AssetTransferFailed.selector);
        settlement.settle(quote, signature);

        assertEq(demoAapl.balanceOf(buyer), buyerBalanceBefore);
        assertFalse(settlement.settledInvoices(quote.invoiceId));
        assertEq(usdt0.balanceOf(merchant), 0);
    }

    function testInsufficientLiquidityFailsBeforeTakingAsset() public {
        PortPaySettlement.SettlementQuote memory quote = _quote(
            keccak256("invoice-liquidity"), 80_000_000_000_000_000, 101 ether, block.timestamp + 300
        );
        uint256 buyerBalanceBefore = demoAapl.balanceOf(buyer);
        bytes memory signature = _sign(quote, SIGNER_PRIVATE_KEY);

        vm.prank(buyer);
        demoAapl.approve(address(settlement), quote.assetAmount);
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                PortPaySettlement.InsufficientSettlementLiquidity.selector,
                100 ether,
                quote.stablecoinAmount
            )
        );
        settlement.settle(quote, signature);

        assertEq(demoAapl.balanceOf(buyer), buyerBalanceBefore);
        assertFalse(settlement.settledInvoices(quote.invoiceId));
    }

    function testRejectsWrongAssetAndMerchantContext() public {
        PortPaySettlement.SettlementQuote memory quote = _quote(
            keccak256("invoice-context"), 80_000_000_000_000_000, 20_000_000, block.timestamp + 300
        );
        quote.asset = address(usdt0);
        bytes memory wrongAssetSignature = _sign(quote, SIGNER_PRIVATE_KEY);

        vm.prank(buyer);
        vm.expectRevert(PortPaySettlement.InvalidToken.selector);
        settlement.settle(quote, wrongAssetSignature);

        quote.asset = address(demoAapl);
        quote.merchant = address(0);
        bytes memory zeroMerchantSignature = _sign(quote, SIGNER_PRIVATE_KEY);
        vm.prank(buyer);
        vm.expectRevert(PortPaySettlement.InvalidParticipant.selector);
        settlement.settle(quote, zeroMerchantSignature);
    }

    function testRejectsNonContractTokenAddressesAtDeployment() public {
        vm.expectRevert(PortPaySettlement.InvalidConstructorConfiguration.selector);
        new PortPaySettlement(quoteSigner, address(0x1234), address(usdt0));
        vm.expectRevert(PortPaySettlement.InvalidConstructorConfiguration.selector);
        new PortPaySettlement(quoteSigner, address(demoAapl), address(0x1234));
    }

    function testFeeOnBuyerAssetTransferRevertsAtomically() public {
        FeeOnTransferToken feeAsset = new FeeOnTransferToken(18);
        PortPaySettlement feeSettlement =
            new PortPaySettlement(quoteSigner, address(feeAsset), address(usdt0));
        feeAsset.mint(buyer, 1 ether);
        usdt0.mint(address(feeSettlement), 20_000_000);
        PortPaySettlement.SettlementQuote memory quote = _quote(
            keccak256("invoice-fee-asset"),
            80_000_000_000_000_000,
            20_000_000,
            block.timestamp + 300
        );
        quote.asset = address(feeAsset);
        quote.settlementContract = address(feeSettlement);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(SIGNER_PRIVATE_KEY, feeSettlement.quoteDigest(quote));
        vm.prank(buyer);
        feeAsset.approve(address(feeSettlement), quote.assetAmount);
        vm.prank(buyer);
        vm.expectRevert(PortPaySettlement.UnexpectedTransferAmount.selector);
        feeSettlement.settle(quote, abi.encodePacked(r, s, v));
        assertEq(feeAsset.balanceOf(buyer), 1 ether);
        assertEq(usdt0.balanceOf(merchant), 0);
        assertFalse(feeSettlement.settledInvoices(quote.invoiceId));
    }

    function testFeeOnMerchantSettlementRevertsAtomically() public {
        FeeOnTransferToken feeStablecoin = new FeeOnTransferToken(6);
        PortPaySettlement feeSettlement =
            new PortPaySettlement(quoteSigner, address(demoAapl), address(feeStablecoin));
        feeStablecoin.mint(address(feeSettlement), 20_000_000);
        PortPaySettlement.SettlementQuote memory quote = _quote(
            keccak256("invoice-fee-stablecoin"),
            80_000_000_000_000_000,
            20_000_000,
            block.timestamp + 300
        );
        quote.stablecoin = address(feeStablecoin);
        quote.settlementContract = address(feeSettlement);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(SIGNER_PRIVATE_KEY, feeSettlement.quoteDigest(quote));
        vm.prank(buyer);
        demoAapl.approve(address(feeSettlement), quote.assetAmount);
        vm.prank(buyer);
        vm.expectRevert(PortPaySettlement.UnexpectedTransferAmount.selector);
        feeSettlement.settle(quote, abi.encodePacked(r, s, v));
        assertEq(demoAapl.balanceOf(buyer), 1 ether);
        assertEq(feeStablecoin.balanceOf(merchant), 0);
        assertFalse(feeSettlement.settledInvoices(quote.invoiceId));
    }

    function testStablecoinTransferFailureRevertsAssetAndInvoiceMarker() public {
        RejectingStablecoin rejectingStablecoin = new RejectingStablecoin();
        PortPaySettlement rejectingSettlement =
            new PortPaySettlement(quoteSigner, address(demoAapl), address(rejectingStablecoin));
        rejectingStablecoin.mint(address(rejectingSettlement), 20_000_000);
        PortPaySettlement.SettlementQuote memory quote = _quote(
            keccak256("invoice-reject-transfer"),
            80_000_000_000_000_000,
            20_000_000,
            block.timestamp + 300
        );
        quote.stablecoin = address(rejectingStablecoin);
        quote.settlementContract = address(rejectingSettlement);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(SIGNER_PRIVATE_KEY, rejectingSettlement.quoteDigest(quote));
        vm.prank(buyer);
        demoAapl.approve(address(rejectingSettlement), quote.assetAmount);
        vm.prank(buyer);
        vm.expectRevert(PortPaySettlement.StablecoinTransferFailed.selector);
        rejectingSettlement.settle(quote, abi.encodePacked(r, s, v));
        assertEq(demoAapl.balanceOf(buyer), 1 ether);
        assertEq(rejectingStablecoin.balanceOf(merchant), 0);
        assertFalse(rejectingSettlement.settledInvoices(quote.invoiceId));
    }

    function testTamperingWithMerchantOrContractInvalidatesSignedQuote() public {
        PortPaySettlement.SettlementQuote memory quote = _quote(
            keccak256("invoice-tamper"), 80_000_000_000_000_000, 20_000_000, block.timestamp + 300
        );
        bytes memory signature = _sign(quote, SIGNER_PRIVATE_KEY);
        vm.prank(buyer);
        demoAapl.approve(address(settlement), quote.assetAmount);
        quote.merchant = address(0xBEEF);
        vm.prank(buyer);
        vm.expectRevert(PortPaySettlement.InvalidSignature.selector);
        settlement.settle(quote, signature);
        quote.merchant = merchant;
        quote.settlementContract = address(0xBEEF);
        vm.prank(buyer);
        vm.expectRevert(PortPaySettlement.InvalidQuoteContext.selector);
        settlement.settle(quote, signature);
    }

    function _quote(
        bytes32 invoiceId,
        uint256 assetAmount,
        uint256 stablecoinAmount,
        uint256 expiry
    ) private view returns (PortPaySettlement.SettlementQuote memory) {
        return PortPaySettlement.SettlementQuote({
            invoiceId: invoiceId,
            buyer: buyer,
            merchant: merchant,
            asset: address(demoAapl),
            assetAmount: assetAmount,
            stablecoin: address(usdt0),
            stablecoinAmount: stablecoinAmount,
            chainId: 1952,
            settlementContract: address(settlement),
            expiry: expiry
        });
    }

    function _sign(PortPaySettlement.SettlementQuote memory quote, uint256 privateKey)
        private
        view
        returns (bytes memory)
    {
        bytes32 digest = settlement.quoteDigest(quote);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
