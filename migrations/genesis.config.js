const BigNumber = require("bignumber.js")

const TOKEN_UNIT = 10 ** 18

module.exports = {
    initialSupply: new BigNumber(10000000).mul(TOKEN_UNIT),
    crowdSupply: new BigNumber(6343700).mul(TOKEN_UNIT),
    companySupply: new BigNumber(500000).mul(TOKEN_UNIT),
    teamSupply: new BigNumber(1235000).mul(TOKEN_UNIT),
    investorsSupply: new BigNumber(1900000).mul(TOKEN_UNIT),
    communitySupply: new BigNumber(21300).mul(TOKEN_UNIT),
    bankMultisig: "0x6941627cba3518385e75de75d25a189185672bfe",
    governanceMultisig: "0x04746b890d090ae3c4c5df0101cfd089a4faca6c",
    timeToGrantsStart: new BigNumber(60).times(60).times(4),
    merkleMine: {
        genesisRoot: "0x53f35a304a1e1e20d6648e09bb3073ccd44a5bf1638a01355897a71e801879f8",
        totalGenesisRecipients: 2598071,
        balanceThreshold: 100000000000000000,
        genesisBlock: 5264265,
        blocksToCliff: 500000,
        callerAllocationPeriod: 2500000
    },
    teamTimeToCliff: 0,
    teamVestingDuration: new BigNumber(60).times(60).times(24).times(365).times(3),
    teamGrants: [
        {
            receiver: "0x907D3231DFd3b45C1075B87ff92335325fEd3632",
            amount: new BigNumber(500000).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x13eF0bA91DF06e789cFdDC8C72c704948242C801",
            amount: new BigNumber(500000).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x64EC217e384CF06Bb8cf73cb3fcbc0A42DBA8071",
            amount: new BigNumber(60000).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x02a7Db34a9415642BC8d9899E29b43E070546A00",
            amount: new BigNumber(25000).mul(TOKEN_UNIT)
        },
        {
            receiver: "0xc7d6d54a4360b42fa0759e12de990bfd4b13d3c3",
            amount: new BigNumber(20000).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x867C90A7F48FB39b2f3cCbdd33e5002477b935AE",
            amount: new BigNumber(25000).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x5c64a6C5b93917B51a073e7Bc92e6C02de2DE85b",
            amount: new BigNumber(50000).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x85a48E017c2f09037046656F2dbB063c3C1d3CE2",
            amount: new BigNumber(55000).mul(TOKEN_UNIT)
        }
    ],
    investorsTimeToCliff: 0,
    investorsVestingDuration: new BigNumber(60).times(60).times(24).times(365).times(3).div(2),
    investorGrants: [
        {
            receiver: "0x2e0EEaEB1aF7565bd5381aaEDEb8EEB0B1082d02",
            amount: new BigNumber(228432).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x58EaE5A835a2DA8815028CC56b4a1490f3D49D5E",
            amount: new BigNumber(348039).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x0C199ebd4D61A28861B47792ADf200DE2b48bC82",
            amount: new BigNumber(211765).mul(TOKEN_UNIT)
        },
        {
            receiver: "0xCe12D21f23501d6Edfd215157ecD8ACAd3A3E399",
            amount: new BigNumber(26471).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x26d869Da43ac69E9505101C87019b08d06159B25",
            amount: new BigNumber(15882).mul(TOKEN_UNIT)
        },
        {
            receiver: "0xEfaCaC60b2E24cdB3A414e5692e6d326029055e8",
            amount: new BigNumber(34803).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x662DfAF8267114A29533FfC3C1EBa18687AA077e",
            amount: new BigNumber(52941).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x4FAb6DfAA87ED82D9b9255416cE472Db42DC657C",
            amount: new BigNumber(26471).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x94d9A128875c2928BD212ee7eDF980389b008DBD",
            amount: new BigNumber(48726).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x9fD4a0c0f41e7192C8bBCf8197f5Fbb0f4C5AeCb",
            amount: new BigNumber(34804).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x395b0b569118Cd826B53b5A6246Adb5795b8D28C",
            amount: new BigNumber(100000).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x4122fb56891A6771dd5785cff5Ebcf98f134DDCB",
            amount: new BigNumber(8333).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x8d55189f170B1B5Ccb9DE214e0ECCdB30325C1F4",
            amount: new BigNumber(25000).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x67936306C1490dB7C491B0fE56BCf067eDE1Fd28",
            amount: new BigNumber(83333).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x9dbF125B97DD49915E54C63eed81545edc1B20dB",
            amount: new BigNumber(166667).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x8d95adcFdC1aBEB7385C298C09b8592DcB6dF6eC",
            amount: new BigNumber(33333).mul(TOKEN_UNIT)
        },
        {
            receiver: "0xd355d1390c4a077D85AfaC1B2C1faE1624a30E52",
            amount: new BigNumber(83333).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x5af1B322A9Cb01Ca2104a6c2b94400fc3F8fE1Ef",
            amount: new BigNumber(183333).mul(TOKEN_UNIT)
        },
        {
            receiver: "0xeB73C744B95c75709F362E42769ffeFc71952432",
            amount: new BigNumber(66667).mul(TOKEN_UNIT)
        },
        {
            receiver: "0xD48A50d038A842d4D6408Ae8478DBCC22562E392",
            amount: new BigNumber(83333).mul(TOKEN_UNIT)
        },
        {
            receiver: "0xA23F2B0920B6A7c321f286B03d15dd621F314863",
            amount: new BigNumber(16667).mul(TOKEN_UNIT)
        },
        {
            receiver: "0xF775B7B3dbf427603d7E0075b7ce13892b13Dd9c",
            amount: new BigNumber(16667).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x94aD4001c7a411fA8D55044508170e65ca9f77cA",
            amount: new BigNumber(5000).mul(TOKEN_UNIT)
        }
    ],
    communityGrants: [
        {
            receiver: "0x85a48E017c2f09037046656F2dbB063c3C1d3CE2",
            amount: new BigNumber(2000).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x11Ab5Ec22AE6772CD3a704717b3c9d7B8224631b",
            amount: new BigNumber(500).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x064d7f14CA21C9616d419e6d60Fe1d4EF0BD8315",
            amount: new BigNumber(7500).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x191ce48c50b96006c32c338aecb8fd8caa954132",
            amount: new BigNumber(500).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x5d030bfd0287007b7626648668b027c7922a1315",
            amount: new BigNumber(500).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x07525F33E00e5494bCBaba5d69f752ba0ED1A657",
            amount: new BigNumber(1000).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x066bcbeb88e398bbc5d960ba2079dfe118593811",
            amount: new BigNumber(500).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x22b544d19ffe43c6083327271d9f39020da30c65",
            amount: new BigNumber(1000).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x6bA604963046512Cc0143693E9A52Faa2eB41ec2",
            amount: new BigNumber(750).mul(TOKEN_UNIT)
        },
        {
            receiver: "0xe507c8882dab3277577937f868dc14d5b1f16b1a",
            amount: new BigNumber(500).mul(TOKEN_UNIT)
        },
        {
            receiver: "0xbd91c9df3c30f0e43b19b1dd05888cf9b647b781",
            amount: new BigNumber(750).mul(TOKEN_UNIT)
        },
        {
            receiver: "0xf0f4AF7eD1Dd8e1B71883A92F8C484C3f286f5f7",
            amount: new BigNumber(300).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x3bb3f97618929f4f493cfcd2918427634ed14ee4",
            amount: new BigNumber(500).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x7d3e2d29C0F77d35e470942e10aeD8f3a6A596fe",
            amount: new BigNumber(1000).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x4122fb56891A6771dd5785cff5Ebcf98f134DDCB",
            amount: new BigNumber(1000).mul(TOKEN_UNIT)
        },
        {
            receiver: "0x144c7b90f5A9888676931f6F829761A1F3D948c7",
            amount: new BigNumber(3000).mul(TOKEN_UNIT)
        }
    ]
}
