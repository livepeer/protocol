ganache_running() {
    nc -z localhost 8545
}

start_ganache() {
    node_modules/.bin/ganache-cli -l 0x663BE0 > /dev/null &

    ganache_pid=$!
}

if ganache_running; then
    echo "Using existing ganache instance at port 8545"
else
    echo "Starting new ganache instance at port 8545"
    start_ganache
fi
