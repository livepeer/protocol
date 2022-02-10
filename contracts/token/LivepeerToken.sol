//SPDX-License-Identifier: MIT
// solhint-disable-next-line
pragma solidity 0.8.9;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ERC20, ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";
import { ERC20Burnable } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

// Copy of https://github.com/livepeer/arbitrum-lpt-bridge/blob/main/contracts/L2/token/LivepeerToken.sol
// Tests at https://github.com/livepeer/arbitrum-lpt-bridge/blob/main/test/unit/L2/livepeerToken.test.ts
contract LivepeerToken is AccessControl, ERC20Burnable, ERC20Permit {
    bytes32 private immutable MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 private immutable BURNER_ROLE = keccak256("BURNER_ROLE");

    event Mint(address indexed to, uint256 amount);
    event Burn(address indexed burner, uint256 amount);

    constructor() ERC20("Livepeer Token", "LPT") ERC20Permit("Livepeer Token") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Function to mint tokens
     * @dev Only callable by addreses with MINTER_ROLE
     * @param _to The address that will receive the minted tokens.
     * @param _amount The amount of tokens to mint.
     */
    function mint(address _to, uint256 _amount) external onlyRole(MINTER_ROLE) {
        _mint(_to, _amount);
        emit Mint(_to, _amount);
    }

    /**
     * @notice Burns a specific amount of msg.sender's tokens
     * @dev Only callable by addresses with BURNER_ROLE
     * @param _amount The amount of tokens to be burned
     */
    function burn(uint256 _amount) public override onlyRole(BURNER_ROLE) {
        super.burn(_amount);
        emit Burn(msg.sender, _amount);
    }

    /**
     * @notice Burns a specific amount of an address' tokens
     * @dev Only callable by addresses with BURNER_ROLE. Requires the address to approve the caller to burn the amount
     * @param _from Address to burn tokens for
     * @param _amount The amount of tokens to be burned
     */
    function burnFrom(address _from, uint256 _amount) public override onlyRole(BURNER_ROLE) {
        super.burnFrom(_from, _amount);
        emit Burn(_from, _amount);
    }
}
