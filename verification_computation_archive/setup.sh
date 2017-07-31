tar xvfz go-ipfs_v0.4.10_linux-386.tar.gz
mv go-ipfs/ipfs /usr/local/bin/ipfs

tar -xf ffmpeg-release-64bit-static.tar.xz
mv ffmpeg-3.3.2-64bit-static/ffmpeg /usr/local/bin/ffmpeg

ipfs init
ipfs config Addresses.API /ip4/127.0.0.1/tcp/5001
ipfs daemon &

sleep 10

# echo "IPFS daemon ready"
