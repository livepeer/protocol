FROM ethereum/client-go:latest

WORKDIR /app/
COPY genesis.json /app/genesis.json
COPY keys /app/keys
COPY password.txt /app/password.txt
COPY start.sh /app/start.sh

RUN chmod +x start.sh
ENTRYPOINT ./start.sh