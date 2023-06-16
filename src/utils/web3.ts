import {BigNumber} from 'ethers'

const HOLOGRAPH_ENVIRONMENT = process.env.HOLONET_ENVIRONMENT || 'develop'
export const IS_MAINNET = HOLOGRAPH_ENVIRONMENT === 'mainnet'
export const DISCONNECT_ACTION = 'disconnect_action'

export const CHAIN_IDS = {
  ethereum: 1,
  goerli: 5,
  polygon: 137,
  mumbai: 80_001,
  bsc: 56,
  testbsc: 97,
  avalanche: 43_114,
  fuji: 43_113,
  fantom: 250,
  optimism: 10,
  optimismGoerli: 420,
  [DISCONNECT_ACTION]: 0,
} as const

export const ABI_ENVIRONMENT_VALUES = {
  develop: 'develop',
  testnet: 'testnet',
  mainnet: 'mainnet',
} as const

const C = CHAIN_IDS

export const CHAIN_NAMES = {
  [C.ethereum]: 'ethereum',
  [C.goerli]: 'goerli',
  [C.polygon]: 'polygon',
  [C.mumbai]: 'mumbai',
  [C.bsc]: 'bsc',
  [C.testbsc]: 'testbsc',
  [C.avalanche]: 'avalanche',
  [C.fantom]: 'fantom',
  [C.fuji]: 'fuji',
  [C.optimism]: 'optimism',
  [C.optimismGoerli]: 'optimismGoerli',
  [C[DISCONNECT_ACTION]]: DISCONNECT_ACTION,
} as const

// TODO: Improve naming of this variable/refactor soon
export const CHAIN_FULL_NAMES = {
  [C.ethereum]: 'Ethereum',
  [C.goerli]: 'Goerli',
  [C.polygon]: 'Polygon',
  [C.mumbai]: 'Mumbai',
  [C.bsc]: 'BNB Chain',
  [C.testbsc]: 'BNB Chain',
  [C.avalanche]: 'Avalanche',
  [C.fantom]: 'Fantom',
  [C.fuji]: 'Fuji',
  [C.optimism]: 'Optimism',
  [C.optimismGoerli]: 'Optimism',
  [C[DISCONNECT_ACTION]]: DISCONNECT_ACTION,
}

export const CHAIN_NAMES_TO_IDS = {
  [CHAIN_NAMES[C.ethereum]]: C.ethereum,
  [CHAIN_NAMES[C.goerli]]: C.goerli,
  [CHAIN_NAMES[C.polygon]]: C.polygon,
  [CHAIN_NAMES[C.mumbai]]: C.mumbai,
  [CHAIN_NAMES[C.bsc]]: C.bsc,
  [CHAIN_NAMES[C.testbsc]]: C.testbsc,
  [CHAIN_NAMES[C.avalanche]]: C.avalanche,
  [CHAIN_NAMES[C.fantom]]: C.fantom,
  [CHAIN_NAMES[C.fuji]]: C.fuji,
  [CHAIN_NAMES[C.optimism]]: C.optimism,
  [CHAIN_NAMES[C.optimismGoerli]]: C.optimismGoerli,
  [CHAIN_NAMES[C[DISCONNECT_ACTION]]]: C[DISCONNECT_ACTION],
} as const

export const CHAIN_NETWORKS = {
  [C.ethereum]: 'ethereum',
  [C.goerli]: 'ethereum',
  [C.polygon]: 'polygon',
  [C.mumbai]: 'polygon',
  [C.bsc]: 'bsc',
  [C.testbsc]: 'bsc',
  [C.avalanche]: 'avalanche',
  [C.fantom]: 'fantom',
  [C.fuji]: 'avalanche',
  [C.optimism]: 'optimism',
  [C.optimismGoerli]: 'optimism',
} as const

export const OPEN_SEA_NFT_URL_PREFIX = {
  [C.ethereum]: 'https://opensea.io/assets/ethereum',
  [C.goerli]: 'https://testnets.opensea.io/assets/goerli',
  [C.polygon]: 'https://opensea.io/assets/matic',
  [C.mumbai]: 'https://testnets.opensea.io/assets/mumbai',
  [C.avalanche]: 'https://opensea.io/assets/avalanche',
  [C.fuji]: 'https://testnets.opensea.io/assets/avalanche-fuji',
  [C.bsc]: 'https://opensea.io/assets/bsc',
  [C.testbsc]: 'https://testnets.opensea.io/assets/bsc-testnet',
  [C.optimism]: 'https://opensea.io/assets/optimism',
  [C.optimismGoerli]: 'https://testnets.opensea.io/assets/optimism-goerli',
} as const

declare global {
  type ChainIds = keyof typeof CHAIN_NAMES
  type ChainNames = keyof typeof CHAIN_IDS
  type SupportedChainIds = (typeof SUPPORTED_CHAIN_IDS)[number]
  type SupportedMainnetChainIds = (typeof SUPPORTED_MAINNET_CHAIN_IDS)[number]
  type SupportedTestnetChainIds = (typeof SUPPORTED_TESTNET_CHAIN_IDS)[number]
  type SupportedChainNames = (typeof SUPPORTED_CHAIN_NAMES)[number]
  type SupportedNetworkNames = (typeof SUPPORTED_NETWORK_NAMES)[number]
  type DropdownChainIds = (typeof DROPDOWN_CHAIN_IDS)[number]
  type DropdownChainNames = (typeof DROPDOWN_CHAIN_NAMES)[number]
  type DisabledChainIds = (typeof DISABLED_CHAIN_IDS)[number]
}

export const DEFAULT_CHAIN_ID = IS_MAINNET ? C.ethereum : C.goerli
export const DEFAULT_CHAIN_NAME = CHAIN_NAMES[DEFAULT_CHAIN_ID]
export const SUPPORTED_MAINNET_CHAIN_IDS = [C.ethereum, C.polygon, C.avalanche, C.bsc, C.optimism]
export const SUPPORTED_TESTNET_CHAIN_IDS = [C.goerli, C.mumbai, C.fuji, C.testbsc, C.optimismGoerli]

export const SUPPORTED_CHAIN_IDS: Array<SupportedMainnetChainIds | SupportedTestnetChainIds> = IS_MAINNET
  ? SUPPORTED_MAINNET_CHAIN_IDS
  : SUPPORTED_TESTNET_CHAIN_IDS
export const SUPPORTED_CHAIN_NAMES = SUPPORTED_CHAIN_IDS.map(id => CHAIN_NAMES[id])
export const SUPPORTED_NETWORK_NAMES = SUPPORTED_CHAIN_IDS.map(id => CHAIN_NETWORKS[id])
export const DISABLED_CHAIN_IDS = []
export const DISABLED_CHAIN_NAMES = DISABLED_CHAIN_IDS.map(id => CHAIN_NAMES[id])

export const DROPDOWN_CHAIN_IDS = [...SUPPORTED_CHAIN_IDS, C.disconnect_action]
export const DROPDOWN_CHAIN_NAMES = DROPDOWN_CHAIN_IDS.map(id => CHAIN_NAMES[id])

export const DUMMY_WALLET = {
  privateKey: '494cf7d8741e5fea465cc011b86d30e174fc0483a64675c73c92f109d5cee6ee',
  address: '0x15Eff67DE49192235E65e33afa448580918D70FC',
}

export const formatWalletAddress = (address: string) => {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export const formatTokenId = (tokenId: string) => {
  return BigNumber.from(`${tokenId}`).toString()
}

export const getOpenSeaNftURL = (chainId: SupportedChainIds, contractAddress: string, tokenId: string) =>
  tokenId ? `${OPEN_SEA_NFT_URL_PREFIX[chainId]}/${contractAddress}/${formatTokenId(tokenId)}` : ''

export const overrideToMinGasPrice = function (chainId: SupportedChainIds, gasPrice: BigNumber) {
  // NOTE: Here only temporarily. This will be replaced by an RPC call to the blockchain.
  const MIN_GAS_PRICE = {
    [CHAIN_IDS.ethereum]: 40_000_000_001,
    [CHAIN_IDS.goerli]: 5_000_000_001,
    [CHAIN_IDS.polygon]: 200_000_000_001,
    [CHAIN_IDS.bsc]: 3_000_000_001,
    [CHAIN_IDS.testbsc]: 1_000_000_001,
    [CHAIN_IDS.avalanche]: 30_000_000_001,
    [CHAIN_IDS.fantom]: 200_000_000_001,
    [CHAIN_IDS.mumbai]: 5_000_000_001,
    [CHAIN_IDS.fuji]: 30_000_000_001,
    [CHAIN_IDS.optimism]: 10_000_001,
    [CHAIN_IDS.optimismGoerli]: 5_000_000_001,
  } as const

  if (BigNumber.from(MIN_GAS_PRICE[chainId]).gt(gasPrice)) {
    return BigNumber.from(MIN_GAS_PRICE[chainId])
  }

  return gasPrice
}
