const dotenv = require('dotenv')
dotenv.config()

export default {
  hardhat: {
    chain: 31_337,
    rpc: 'http://localhost:8545',
    holographId: 4_294_967_295,
    tokenName: 'Hardhat',
    tokenSymbol: 'HRD',
    lzEndpoint: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  },
  localhost: {
    chain: 1338,
    rpc: 'http://localhost:8545',
    holographId: 4_294_967_295,
    tokenName: 'Localhost',
    tokenSymbol: 'LH',
    lzEndpoint: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  },
  localhost2: {
    chain: 1339,
    rpc: 'http://localhost:9545',
    holographId: 4_294_967_294,
    tokenName: 'Localhost 2',
    tokenSymbol: 'LH2',
    lzEndpoint: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  },
  cxip: {
    chain: 1337,
    rpc: 'https://rpc.cxip.dev',
    holographId: 4_000_000_000,
    tokenName: 'Cxip Token',
    tokenSymbol: 'CXIP',
    lzEndpoint: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  },
  eth: {
    chain: 1,
    rpc: 'https://eth.getblock.io/mainnet/?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    webSocket: 'wss://eth.getblock.io/mainnet/?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    holographId: 1,
    tokenName: 'Ethereum',
    tokenSymbol: 'ETH',
    lzEndpoint: '0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675'.toLowerCase(),
  },
  eth_rinkeby: {
    chain: 4,
    rpc: 'https://eth.getblock.io/rinkeby/?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    webSocket: 'wss://eth-rinkeby.alchemyapi.io/v2/' + process.env.ALCHEMY_RINKEBY_KEY,
    holographId: 4_000_000_001,
    tokenName: 'Ethereum Rinkeby',
    tokenSymbol: 'RIN',
    lzEndpoint: '0x79a63d6d8BBD5c6dfc774dA79bCcD948EAcb53FA'.toLowerCase(),
  },
  eth_ropsten: {
    chain: 3,
    rpc: 'https://eth.getblock.io/ropsten/?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    webSocket: 'wss://eth.getblock.io/ropsten/?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    holographId: 4_000_000_009, // need to set in chain libraries !
    tokenName: 'Ethereum Ropsten',
    tokenSymbol: 'ROP',
    lzEndpoint: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  },
  eth_kovan: {
    chain: 42,
    rpc: 'https://kovan.infura.io/v3/0ab4cbfce2414f41a4313644412ccf14',
    holographId: 4_000_000_010, // need to set in chain libraries !
    tokenName: 'Ethereum Kovan',
    tokenSymbol: 'KOV',
    lzEndpoint: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  },
  eth_goerli: {
    chain: 5,
    rpc: 'https://eth.getblock.io/goerli/?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    webSocket: 'wss://eth.getblock.io/goerli/?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    holographId: 4_000_000_011, // need to set in chain libraries !
    tokenName: 'Ethereum Goerli',
    tokenSymbol: 'ETH',
    lzEndpoint: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  },
  bsc: {
    chain: 56,
    rpc: 'https://bsc.getblock.io/mainnet/?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    webSocket: 'wss://bsc.getblock.io/mainnet/?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    holographId: 2,
    tokenName: 'BNB',
    tokenSymbol: 'BNB',
    lzEndpoint: '0x3c2269811836af69497E5F486A85D7316753cf62'.toLowerCase(),
  },
  bsc_testnet: {
    chain: 97,
    rpc: 'https://bsc.getblock.io/testnet/?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    webSocket: 'wss://bsc.getblock.io/testnet/?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    holographId: 4_000_000_002,
    tokenName: 'BNB Testnet',
    tokenSymbol: 'tBNB',
    lzEndpoint: '0x6Fcb97553D41516Cb228ac03FdC8B9a0a9df04A1'.toLowerCase(),
  },
  avax: {
    chain: 43_114,
    rpc: 'https://avax.getblock.io/mainnet/ext/bc/C/rpc?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    webSocket: 'wss://avax.getblock.io/mainnet/ext/bc/C/rpc?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    holographId: 3,
    tokenName: 'Avalanche',
    tokenSymbol: 'AVAX',
    lzEndpoint: '0x3c2269811836af69497E5F486A85D7316753cf62'.toLowerCase(),
  },
  fuji: {
    chain: 43_113,
    rpc: 'https://avax.getblock.io/testnet/ext/bc/C/rpc?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    holographId: 4_000_000_003,
    tokenName: 'Avalanche Fuji',
    tokenSymbol: 'AVAX',
    lzEndpoint: '0x93f54D755A063cE7bB9e6Ac47Eccc8e33411d706'.toLowerCase(),
  },
  matic: {
    chain: 137,
    rpc: 'https://matic.getblock.io/mainnet/?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    webSocket: 'wss://matic.getblock.io/mainnet/?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    holographId: 4,
    tokenName: 'Polygon',
    tokenSymbol: 'MATIC',
    lzEndpoint: '0x3c2269811836af69497E5F486A85D7316753cf62'.toLowerCase(),
  },
  mumbai: {
    chain: 80_001,
    rpc: 'https://matic.getblock.io/testnet/?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    webSocket: 'wss://polygon-mumbai.g.alchemy.com/v2/' + process.env.ALCHEMY_MUMBAI_KEY,
    holographId: 4_000_000_004,
    tokenName: 'Polygon Mumbai',
    tokenSymbol: 'MATIC',
    lzEndpoint: '0xf69186dfBa60DdB133E91E9A4B5673624293d8F8'.toLowerCase(),
  },
  ftm: {
    chain: 250,
    rpc: 'https://ftm.getblock.io/mainnet/?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    webSocket: 'wss://ftm.getblock.io/mainnet/?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    holographId: 5,
    tokenName: 'Fantom',
    tokenSymbol: 'FTM',
    lzEndpoint: '0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7'.toLowerCase(),
  },
  ftm_testnet: {
    chain: 4002,
    rpc: 'https://rpc.testnet.fantom.network',
    holographId: 4_000_000_005,
    tokenName: 'Fantom Testnet',
    tokenSymbol: 'FTM',
    lzEndpoint: '0x7dcAD72640F835B0FA36EFD3D6d3ec902C7E5acf'.toLowerCase(),
  },
  arbitrum: {
    chain: 42_161,
    rpc: 'https://arbitrum.getblock.io/mainnet/?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    webSocket: 'wss://arbitrum.getblock.io/mainnet/?api_key=7bf62a30-d403-4afc-99dc-462dfbfb10de',
    holographId: 6,
    tokenName: 'Arbitrum',
    tokenSymbol: 'ETH',
    lzEndpoint: '0x3c2269811836af69497E5F486A85D7316753cf62'.toLowerCase(),
  },
  arbitrum_rinkeby: {
    chain: 421_611,
    rpc: 'https://rinkeby.arbitrum.io/rpc',
    holographId: 4_000_000_006,
    tokenName: 'Arbitrum Rinkeby',
    tokenSymbol: 'ARETH',
    lzEndpoint: '0x4D747149A57923Beb89f22E6B7B97f7D8c087A00'.toLowerCase(),
  },
  optimism: {
    chain: 10,
    rpc: 'https://mainnet.optimism.io',
    holographId: 7,
    tokenName: 'Optimism',
    tokenSymbol: 'ETH',
    lzEndpoint: '0x3c2269811836af69497E5F486A85D7316753cf62'.toLowerCase(),
  },
  optimism_kovan: {
    chain: 69,
    rpc: 'https://kovan.optimism.io',
    holographId: 4_000_000_007,
    tokenName: 'Optimism Kovan',
    tokenSymbol: 'KOR',
    lzEndpoint: '0x72aB53a133b27Fa428ca7Dc263080807AfEc91b5'.toLowerCase(),
  },
  gno: {
    chain: 100,
    rpc: 'https://rpc.gnosischain.com',
    holographId: 8,
    tokenName: 'Gnosis Chain',
    tokenSymbol: 'GNO',
    lzEndpoint: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  },
  gno_sokol: {
    chain: 77,
    rpc: 'https://sokol.poa.network',
    holographId: 4_000_000_008,
    tokenName: 'Gnosis Chain Sokol',
    tokenSymbol: 'xDAI',
    lzEndpoint: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  },
  cronos: {
    chain: 25,
    rpc: 'https://evm.cronos.org',
    holographId: 9, // need to set in chain libraries !
    tokenName: 'Cronos',
    tokenSymbol: 'CRO',
    lzEndpoint: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  },
  cronos_testnet: {
    chain: 338,
    rpc: 'https://evm-t3.cronos.org',
    holographId: 4_000_000_012, // need to set in chain libraries !
    tokenName: 'Cronos testnet',
    tokenSymbol: 'tCRO',
    lzEndpoint: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  },
  aurora: {
    chain: 1_313_161_554,
    rpc: 'https://mainnet.aurora.dev',
    holographId: 10, // need to set in chain libraries !
    tokenName: 'Aurora ETH',
    tokenSymbol: 'ETH',
    lzEndpoint: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  },
  aurora_testnet: {
    chain: 1_313_161_555,
    rpc: 'https://testnet.aurora.dev',
    holographId: 4_000_000_013, // need to set in chain libraries !
    tokenName: 'Aurora testnet ETH',
    tokenSymbol: 'tETH',
    lzEndpoint: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  },
}
