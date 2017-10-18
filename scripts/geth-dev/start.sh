geth --datadir /geth/.livepeer/testnet init /geth/genesis.json
cp /geth/keys/* /geth/.livepeer/testnet/keystore/
geth --datadir /geth/.livepeer/testnet --networkid 7777 --nodiscover --rpc --rpcaddr 0.0.0.0 --rpcapi eth,net,web3,personal --mine --targetgaslimit 6700000 --unlock 0,1,2,3 --password /geth/password.txt
