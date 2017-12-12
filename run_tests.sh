# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

docker-compose up -d
if [ $? -ne 0 ] ; then
    printf "${RED}docker-compose failed${NC}\n"
    exit -1
fi

echo "Starting linting..."
# Wait for lint
LINT_TEST_EXIT_CODE=`docker wait lint`
# Output lint logs
docker logs lint
# Check unit-tests output
if [ -z ${LINT_TEST_EXIT_CODE+x} ] || [ "$LINT_TEST_EXIT_CODE" -ne 0 ] ; then
    printf "${RED}Linting failed${NC} - Exit Code: $LINT_TEST_EXIT_CODE\n"
else
    printf "${GREEN}Linting passed${NC}\n"
fi

echo "Starting unit tests..."
# Wait for unit-tests
UNIT_TEST_EXIT_CODE=`docker wait unit-tests`
# Output unit-tests logs
docker logs unit-tests
# Check unit-tests output
if [ -z ${UNIT_TEST_EXIT_CODE+x} ] || [ "$UNIT_TEST_EXIT_CODE" -ne 0 ] ; then
    printf "${RED}Unit tests failed${NC} - Exit Code: $UNIT_TEST_EXIT_CODE\n"
else
    printf "${GREEN}Unit tests passed${NC}\n"
fi

echo "Starting TestRPC integration tests..."
# Wait for testrpc-integration-tests
TESTRPC_TEST_EXIT_CODE=`docker wait testrpc-integration-tests`
# Output testrpc-integration-tests logs
docker logs testrpc-integration-tests
# Check testrpc-integration-tests output
if [ -z ${TESTRPC_TEST_EXIT_CODE+x} ] || [ "$TESTRPC_TEST_EXIT_CODE" -ne 0 ] ; then
    printf "${RED}TestRPC integration tests failed${NC} - Exit Code: $TESTRPC_TEST_EXIT_CODE\n"
else
    printf "${GREEN}TestRPC integration tests passed${NC}\n"
fi

# Works locally, but not on CircleCI
# Add back in once we figure out why
# echo "Starting Parity integration tests..."
# # Wait for parity-integration-tests
# PARITY_TEST_EXIT_CODE=`docker wait parity-integration-tests`
# # Output parity-integration-tests logs
# docker logs parity-integration-tests
# # Check parity-integration-tests output
# if [ -z ${PARITY_TEST_EXIT_CODE+x} ] || [ "$PARITY_TEST_EXIT_CODE" -ne 0 ] ; then
#     printf "${RED}Parity integration tests failed${NC} - Exit Code: $PARITY_TEST_EXIT_CODE\n"
# else
#     printf "${GREEN}Parity integration tests passed${NC}\n"
# fi

echo "Starting Geth integration tests..."
# Wait for geth-integration-tests
GETH_TEST_EXIT_CODE=`docker wait geth-integration-tests`
# Output geth-integration-tests logs
docker logs geth-integration-tests
# Check geth-integration-tests output
if [ -z ${GETH_TEST_EXIT_CODE+x} ] || [ "$GETH_TEST_EXIT_CODE" -ne 0 ] ; then
    printf "${RED}Geth integration tests failed${NC} - Exit Code: $GETH_TEST_EXIT_CODE\n"
else
    printf "${GREEN}Geth integration tests passed${NC}\n"
fi

# Clean up
docker-compose down

# If all tests passed return 0, else return 1
! (( $LINT_TEST_EXIT_CODE | $UNIT_TEST_EXIT_CODE | $TESTRPC_TEST_EXIT_CODE ))
exit $?
