// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PortPaySettlement
/// @notice Minimal X Layer Testnet portfolio-settlement contract.
/// @dev This contract is deliberately not a DEX, AMM, marketplace, or general vault.
interface IERC20Settlement {
    function balanceOf(address account) external view returns (uint256);

    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract PortPaySettlement {
    uint256 public constant X_LAYER_TESTNET_CHAIN_ID = 1952;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant SETTLEMENT_QUOTE_TYPEHASH = keccak256(
        "SettlementQuote(bytes32 invoiceId,address buyer,address merchant,address asset,uint256 assetAmount,address stablecoin,uint256 stablecoinAmount,uint256 chainId,address settlementContract,uint256 expiry)"
    );
    bytes32 private constant NAME_HASH = keccak256("PortPaySettlement");
    bytes32 private constant VERSION_HASH = keccak256("1");
    uint256 private constant MAX_VALID_ECDSA_S =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    address public immutable quoteSigner;
    address public immutable demoAsset;
    address public immutable stablecoin;
    bytes32 public immutable domainSeparator;

    mapping(bytes32 invoiceId => bool settled) public settledInvoices;
    uint256 private reentrancyState = 1;

    struct SettlementQuote {
        bytes32 invoiceId;
        address buyer;
        address merchant;
        address asset;
        uint256 assetAmount;
        address stablecoin;
        uint256 stablecoinAmount;
        uint256 chainId;
        address settlementContract;
        uint256 expiry;
    }

    event SettlementExecuted(
        bytes32 indexed invoiceId,
        address indexed buyer,
        address indexed merchant,
        address asset,
        uint256 assetAmount,
        address stablecoin,
        uint256 stablecoinAmount,
        uint256 expiry,
        bytes32 quoteId
    );

    error InvalidConstructorConfiguration();
    error WrongChain(uint256 actualChainId);
    error InvalidInvoiceId();
    error InvalidParticipant();
    error InvalidToken();
    error InvalidQuoteContext();
    error QuoteExpired();
    error InvalidCaller();
    error QuoteAlreadySettled();
    error InvalidSignature();
    error InsufficientSettlementLiquidity(uint256 available, uint256 required);
    error AssetTransferFailed();
    error StablecoinTransferFailed();
    error UnexpectedTransferAmount();
    error Reentrancy();

    constructor(address quoteSigner_, address demoAsset_, address stablecoin_) {
        if (
            block.chainid != X_LAYER_TESTNET_CHAIN_ID || quoteSigner_ == address(0)
                || demoAsset_ == address(0) || stablecoin_ == address(0)
                || demoAsset_ == stablecoin_ || demoAsset_.code.length == 0
                || stablecoin_.code.length == 0
        ) {
            revert InvalidConstructorConfiguration();
        }

        quoteSigner = quoteSigner_;
        demoAsset = demoAsset_;
        stablecoin = stablecoin_;
        domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                NAME_HASH,
                VERSION_HASH,
                X_LAYER_TESTNET_CHAIN_ID,
                address(this)
            )
        );
    }

    function quoteDigest(SettlementQuote calldata quote) external view returns (bytes32) {
        return _hashTypedDataV4(_hashQuote(quote));
    }

    function settle(SettlementQuote calldata quote, bytes calldata signature)
        external
        returns (bytes32 quoteId)
    {
        if (reentrancyState != 1) revert Reentrancy();
        reentrancyState = 2;

        if (block.chainid != X_LAYER_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (msg.sender != quote.buyer) revert InvalidCaller();
        if (quote.invoiceId == bytes32(0)) revert InvalidInvoiceId();
        if (quote.buyer == address(0) || quote.merchant == address(0)) {
            revert InvalidParticipant();
        }
        if (quote.asset != demoAsset || quote.stablecoin != stablecoin) revert InvalidToken();
        if (
            quote.assetAmount == 0 || quote.stablecoinAmount == 0 || quote.chainId != block.chainid
                || quote.settlementContract != address(this)
        ) {
            revert InvalidQuoteContext();
        }
        if (block.timestamp > quote.expiry) revert QuoteExpired();
        if (settledInvoices[quote.invoiceId]) revert QuoteAlreadySettled();

        quoteId = _hashTypedDataV4(_hashQuote(quote));
        if (_recover(quoteId, signature) != quoteSigner) revert InvalidSignature();

        uint256 available = IERC20Settlement(stablecoin).balanceOf(address(this));
        if (available < quote.stablecoinAmount) {
            revert InsufficientSettlementLiquidity(available, quote.stablecoinAmount);
        }
        // Mark before external token calls; a failure reverts the marker atomically.
        settledInvoices[quote.invoiceId] = true;
        _transferAssetExact(quote.buyer, quote.assetAmount);
        _transferStablecoinExact(quote.merchant, quote.stablecoinAmount);

        emit SettlementExecuted(
            quote.invoiceId,
            quote.buyer,
            quote.merchant,
            quote.asset,
            quote.assetAmount,
            quote.stablecoin,
            quote.stablecoinAmount,
            quote.expiry,
            quoteId
        );
        reentrancyState = 1;
    }

    function _transferAssetExact(address buyer, uint256 amount) private {
        uint256 buyerAssetBefore = IERC20Settlement(demoAsset).balanceOf(buyer);
        uint256 settlementAssetBefore = IERC20Settlement(demoAsset).balanceOf(address(this));
        if (!_callOptionalReturn(
                demoAsset,
                abi.encodeCall(IERC20Settlement.transferFrom, (buyer, address(this), amount))
            )) {
            revert AssetTransferFailed();
        }
        uint256 buyerAssetAfter = IERC20Settlement(demoAsset).balanceOf(buyer);
        uint256 settlementAssetAfter = IERC20Settlement(demoAsset).balanceOf(address(this));
        if (
            buyerAssetAfter > buyerAssetBefore || buyerAssetBefore - buyerAssetAfter != amount
                || settlementAssetAfter < settlementAssetBefore
                || settlementAssetAfter - settlementAssetBefore != amount
        ) revert UnexpectedTransferAmount();
    }

    function _transferStablecoinExact(address merchant, uint256 amount) private {
        uint256 merchantStablecoinBefore = IERC20Settlement(stablecoin).balanceOf(merchant);
        if (!_callOptionalReturn(
                stablecoin, abi.encodeCall(IERC20Settlement.transfer, (merchant, amount))
            )) {
            revert StablecoinTransferFailed();
        }
        uint256 merchantStablecoinAfter = IERC20Settlement(stablecoin).balanceOf(merchant);
        if (
            merchantStablecoinAfter < merchantStablecoinBefore
                || merchantStablecoinAfter - merchantStablecoinBefore != amount
        ) revert UnexpectedTransferAmount();
    }

    function _hashQuote(SettlementQuote calldata quote) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SETTLEMENT_QUOTE_TYPEHASH,
                quote.invoiceId,
                quote.buyer,
                quote.merchant,
                quote.asset,
                quote.assetAmount,
                quote.stablecoin,
                quote.stablecoinAmount,
                quote.chainId,
                quote.settlementContract,
                quote.expiry
            )
        );
    }

    function _hashTypedDataV4(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        if (uint256(s) > MAX_VALID_ECDSA_S) return address(0);
        return ecrecover(digest, v, r, s);
    }

    function _callOptionalReturn(address token, bytes memory data) private returns (bool) {
        (bool success, bytes memory returndata) = token.call(data);
        if (!success) return false;
        if (returndata.length == 0) return true;
        if (returndata.length != 32) return false;
        return abi.decode(returndata, (bool));
    }
}
