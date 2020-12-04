pragma solidity ^0.5.11;

/**
 * @title ServiceRegistry
 * @notice Maintains a registry of service metadata associated with service provider addresses (transcoders/orchestrators)
 */
contract IServiceRegistry  {
    // Event fired when a caller updates its service URI endpoint
    event ServiceURIUpdate(address indexed addr, string serviceURI);

    function setServiceURI(string calldata _serviceURI) external;
    function getServiceURI(address _addr) public view returns (string memory);
}