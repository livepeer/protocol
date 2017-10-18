FROM ethereum/client-go:latest

WORKDIR /
COPY genesis.json /geth/genesis.json
COPY keys/* /geth/keys/
COPY start.sh start.sh
RUN echo "" > /geth/password.txt

RUN chmod +x start.sh
ENTRYPOINT ./start.sh

# Build Docker image: docker build -t geth-dev .
# Run: docker run -d -p 8545:8545 --name geth-dev geth-dev