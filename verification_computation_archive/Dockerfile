FROM mhart/alpine-node:8
MAINTAINER Yondon Fu "yondon@livepeer.org"

COPY index.js setup.sh package.json go-ipfs_v0.4.10_linux-386.tar.gz ffmpeg-release-64bit-static.tar.xz /tmp/
WORKDIR /tmp/

RUN apk --no-cache add ca-certificates bash xz-libs git
RUN npm install

ENTRYPOINT bash setup.sh && node index.js $ARG0 $ARG1