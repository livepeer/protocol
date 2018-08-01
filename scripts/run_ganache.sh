if [ "$SOLIDITY_COVERAGE" = true ]; then
    ganache_port=8555
else
    ganache_port=8545
fi

ganache_running() {
    nc -z localhost "$ganache_port"
}

start_ganache() {
    if [ "$SOLIDITY_COVERAGE" = true ]; then
        node_modules/.bin/testrpc-sc -l 0xfffffffffff -p "$ganache_port" -a 100 > /dev/null &
    else
        node_modules/.bin/ganache-cli -l 0x663BE0 -a 100 > /dev/null &
    fi

    ganache_pid=$!
}

if ganache_running; then
    echo "Using existing ganache instance at port $ganache_port"
else
    echo "Starting new ganache instance at port $ganache_port"
    start_ganache
fi
