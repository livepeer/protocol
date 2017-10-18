FROM parity/parity:nightly

WORKDIR /
COPY chain-spec.json /parity/chain-spec.json
COPY config.toml /parity/config.toml
COPY keys/* /parity/keys/InstantSealChain/
RUN echo "\n\n\n" > /parity/password.txt

ENTRYPOINT /parity/parity --config /parity/config.toml

# Build Docker image: docker build -t parity-dev .
# Run: docker run -d -p 8545:8545 --name parity-dev parity-dev