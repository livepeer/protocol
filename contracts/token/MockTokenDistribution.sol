pragma solidity ^0.4.17;

import "./ILivepeerToken.sol";

import "zeppelin-solidity/contracts/ownership/Ownable.sol";


contract MockTokenDistribution is Ownable {
    // End time of the distribution
    uint256 endTime;

    // LivepeerToken contract
    ILivepeerToken public token;
    // Address of LivepeerToken faucet
    address public faucet;

    function MockTokenDistribution(address _token, address _faucet, uint256 _endTime) public {
        token = ILivepeerToken(_token);
        faucet = _faucet;
        endTime = _endTime;
    }

    function finalize() external onlyOwner {
        // Distribution must be over
        require(isOver());

        // Send this contract's balance to the faucet
        uint256 balance = token.balanceOf(this);
        token.transfer(faucet, balance);
    }

    function isActive() public view returns (bool) {
        return now < endTime;
    }

    function isOver() public view returns (bool) {
        return now >= endTime;
    }

    function getEndTime() public view returns (uint256) {
        return endTime;
    }
}
