const fs = require("fs")
const ethUtil = require("ethereumjs-util")
const shell = require("shelljs")
const ipfsAPI = require("ipfs-api")

const getSegmentData = (hash, segFile) => {
    const ipfs = ipfsAPI("/ip4/127.0.0.1/tcp/5001")

    return ipfs.files.get(hash).then(stream => {
        return new Promise((resolve, reject) => {
            stream.on("data", file => {
                if (file.path !== hash) {
                    reject(new Error("Incorrect IPFS hash"))
                } else {
                    file.content.pipe(fs.createWriteStream(segFile))
                    file.content.on("end", () => resolve(hash))
                }
            })
        })
    })
}

const ffmpeg = (segFile, outFile) => {
    return new Promise(resolve => {
        const ffmpegCmd = `ffmpeg -i ${segFile} -c:v libx264 -s 426:240 -r 30 -mpegts_copyts 1 -minrate 700k -maxrate 700k -bufsize 700k -threads 1 ${outFile}`

        shell.exec(ffmpegCmd, {silent: true}, (code, stdout, stderr) => {
            resolve(code)
        })
    })
}

const createTranscodedDataHash = outFile => {
    return new Promise((resolve, reject) => {
        fs.readFile(outFile, (err, data) => {
            if (err) {
                reject(err)
            } else {
                resolve(ethUtil.bufferToHex(ethUtil.sha3(data)))
            }
        })
    })
}

const transcode = (hash, segFile, outFile) => {
    return getSegmentData(hash, segFile).then(() => {
        console.log("Retrieved data from IPFS")
        return ffmpeg(segFile, outFile)
    }).then(() => {
        console.log("Transcoding complete")
        return createTranscodedDataHash(outFile)
    })
}

// const testConsistency = hash => {
//     const results = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => {
//         return transcode(hash, `seg${i}.ts`, `out${i}.ts`)
//     })

//     return Promise.all(results)
// }

transcode(process.argv[2], "seg.ts", "out.ts").then(console.log)
// testConsistency(process.argv[2]).then(console.log)
