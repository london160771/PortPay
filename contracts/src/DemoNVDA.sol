// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DemoNVDA
/// @notice Ordinary centrally minted demo ERC-20 for PortPay Smart Spend testnet demos.
/// @dev This is not an official xStock and is not backed by NVIDIA shares.
contract DemoNVDA {
    string public constant name = "DemoNVDA";
    string public constant symbol = "dNVDA";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    address public immutable owner;

    mapping(address account => uint256) public balanceOf;
    mapping(address account => mapping(address spender => uint256)) public allowance;

    error NotOwner();
    error InvalidRecipient();
    error InsufficientBalance();
    error InsufficientAllowance();

    constructor(address owner_) {
        if (owner_ == address(0)) revert InvalidRecipient();
        owner = owner_;
    }

    function mint(address recipient, uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        if (recipient == address(0)) revert InvalidRecipient();
        totalSupply += amount;
        balanceOf[recipient] += amount;
        emit Transfer(address(0), recipient, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount)
        external
        returns (bool)
    {
        uint256 currentAllowance = allowance[sender][msg.sender];
        if (currentAllowance < amount) revert InsufficientAllowance();
        allowance[sender][msg.sender] = currentAllowance - amount;
        _transfer(sender, recipient, amount);
        return true;
    }

    function _transfer(address sender, address recipient, uint256 amount) private {
        if (recipient == address(0)) revert InvalidRecipient();
        if (balanceOf[sender] < amount) revert InsufficientBalance();
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(sender, recipient, amount);
    }

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}
