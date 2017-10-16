geth --datadir ~/.lpTest init genesis.json
cp keys/* ~/.lpTest/keystore/
geth --datadir ~/.lpTest --networkid 7777 --rpc --rpcaddr 0.0.0.0 --rpcapi eth,net,web3,personal --mine --targetgaslimit 6700000 --unlock 0,1,2,3 --password password.txt
