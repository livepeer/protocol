pragma solidity ^0.4.17;

import "../token/ITokenDistribution.sol";
import "zeppelin-solidity/contracts/math/SafeMath.sol";
import "zeppelin-solidity/contracts/ownership/Ownable.sol";


contract TokenDistributionMock is ITokenDistribution, Ownable {
    using SafeMath for uint256;

    // End time of the distribution
    uint256 endTime;
    // Is the distribution over
    bool over;

    function TokenDistributionMock(uint256 _timeToEnd) public {
        endTime = now.add(_timeToEnd);
        over = false;
    }

    function finalize() external onlyOwner {
        require(!isOver());

        over = true;
    }

    function isOver() public view returns (bool) {
        return over;
    }

    function getEndTime() public view returns (uint256) {
        return endTime;
    }
}
