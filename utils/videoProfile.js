import ethUtil from "ethereumjs-util"

export const videoProfileId = name => {
    return ethUtil.sha3(name).slice(0, 4).toString("hex")
}

export const createTranscodingOptions = names => {
    return names.map(name => {
        return videoProfileId(name)
    }).join("")
}
