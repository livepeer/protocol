pragma solidity ^0.4.17;

import "../token/ILivepeerToken.sol";
import "../token/ITokenDistribution.sol";

import "zeppelin-solidity/contracts/ownership/Ownable.sol";


contract TokenDistributionMock is Ownable, ITokenDistribution {
    // End time of the distribution
    uint256 endTime;
    // Is the distribution over
    bool over;

    // LivepeerToken contract
    ILivepeerToken public token;
    // Address of LivepeerToken faucet
    address public faucet;

    function TokenDistributionMock(address _token, address _faucet, uint256 _endTime) public {
        token = ILivepeerToken(_token);
        faucet = _faucet;
        endTime = _endTime;
        over = false;
    }

    function finalize() external onlyOwner {
        require(!isOver());

        over = true;

        // Send this contract's balance to the faucet
        uint256 balance = token.balanceOf(this);
        token.transfer(faucet, balance);
    }

    function isOver() public view returns (bool) {
        return over;
    }

    function getEndTime() public view returns (uint256) {
        return endTime;
    }
}
