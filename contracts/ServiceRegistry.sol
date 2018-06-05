pragma solidity ^0.4.17;

import "./ManagerProxyTarget.sol";


/**
 * @title ServiceRegistry
 * @dev Maintains a registry of service metadata associated with service provider addresses (transcoders/orchestrators)
 */
contract ServiceRegistry is ManagerProxyTarget {
    // Store service metadata
    struct Record {
        string serviceURI;   // Service URI endpoint that can be used to send off-chain requests
    }

    // Track records for addresses
    mapping (address => Record) private records;

    // Event fired when a caller updates its service URI endpoint
    event ServiceURIUpdate(address indexed addr, string serviceURI);

    /**
     * @dev ServiceRegistry constructor. Only invokes constructor of base Manager contract with provided Controller address
     * @param _controller Address of a Controller that this contract will be registered with
     */
    function ServiceRegistry(address _controller) public Manager(_controller) {}

    /**
     * @dev Stores service URI endpoint for the caller that can be used to send requests to the caller off-chain 
     * @param _serviceURI Service URI endpoint for the caller
     */
    function setServiceURI(string _serviceURI) external {
        records[msg.sender].serviceURI = _serviceURI;

        ServiceURIUpdate(msg.sender, _serviceURI);
    }

    /**
     * @dev Returns service URI endpoint stored for a given address
     * @param _addr Address for which a service URI endpoint is desired
     */
    function getServiceURI(address _addr) public view returns (string) {
        return records[_addr].serviceURI;
    }
}