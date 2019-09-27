set -e

# Cleanup ganache when the script exits
trap cleanup EXIT

cleanup() {
    if [ -n "$ganache_pid" ] && ps -p $ganache_pid > /dev/null; then
        # Signal the ganache process to exit
        kill -s TERM $ganache_pid
    fi
}

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
        node_modules/.bin/testrpc-sc -l 0xfffffffffff -p "$ganache_port" -a 310 > /dev/null &
    else
        node_modules/.bin/ganache-cli -k istanbul -l 0x7A1200 -a 310 > /dev/null &
    fi

    ganache_pid=$!
}

if ganache_running; then
    echo "Using existing ganache instance at port $ganache_port"
else
    echo "Starting new ganache instance at port $ganache_port"
    start_ganache
fi

if [ "$SOLIDITY_COVERAGE" = true ]; then
    node_modules/.bin/solidity-coverage
else
    node_modules/.bin/truffle test "$@"
fi