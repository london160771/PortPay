// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DemoAAPL Test Asset
/// @notice A deliberately ordinary, centrally minted ERC-20 used only for the PortPay testnet demo.
/// @dev This token is not an official xStock and is not backed by Apple shares.
contract DemoAAPL {
    string public constant name = "DemoAAPL Test Asset";
    string public constant symbol = "dAAPL";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    address public immutable owner;

    mapping(address account => uint256 balance) public balanceOf;
    mapping(address account => mapping(address spender => uint256 amount)) public allowance;

    error DemoAAPLInvalidOwner();
    error DemoAAPLNotOwner();
    error DemoAAPLInvalidRecipient();
    error DemoAAPLInsufficientBalance();
    error DemoAAPLInsufficientAllowance();

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert DemoAAPLInvalidOwner();
        owner = initialOwner;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert DemoAAPLNotOwner();
        _;
    }

    /// @notice Mint test asset units to a demo wallet.
    /// @dev Only the deployment wallet can mint. This is intentional testnet-only behavior.
    function mint(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert DemoAAPLInvalidRecipient();

        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        if (currentAllowance < amount) revert DemoAAPLInsufficientAllowance();

        if (currentAllowance != type(uint256).max) {
            allowance[from][msg.sender] = currentAllowance - amount;
            emit Approval(from, msg.sender, currentAllowance - amount);
        }

        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert DemoAAPLInvalidRecipient();
        if (balanceOf[from] < amount) revert DemoAAPLInsufficientBalance();

        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
