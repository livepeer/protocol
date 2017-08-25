pragma solidity ^0.4.13;

import "../LivepeerToken.sol";

contract LivepeerTokenFaucet {
    LivepeerToken public token;

    uint256 public requestAmount;
    uint256 public requestWait;
    mapping (address => uint256) public nextValidRequest;

    event Request(address indexed to, uint256 amount);

    function LivepeerTokenFaucet(address _token, uint256 _requestAmount, uint256 _requestWait) {
        token = LivepeerToken(_token);
        requestAmount = _requestAmount;
        requestWait = _requestWait;
    }

    function request() external {
        require(block.timestamp >= nextValidRequest[msg.sender]);

        nextValidRequest[msg.sender] = block.timestamp + requestWait * 1 hours;
        token.transfer(msg.sender, requestAmount);

        Request(msg.sender, requestAmount);
    }
}
