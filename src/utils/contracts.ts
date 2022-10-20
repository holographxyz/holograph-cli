import {BigNumber} from 'ethers'
import * as fs from 'fs-extra'
import {Environment, getEnvironment} from './environment'
import networks, {Networks, supportedNetworks} from './networks'

export const getABIs = async () => {
  const environment = getEnvironment()
  return {
    HolographABI: await fs.readJson(`./src/abi/${environment}/Holograph.json`),
    HolographFactoryABI: await fs.readJson(`./src/abi/${environment}/HolographFactory.json`),
    HolographBridgeABI: await fs.readJson(`./src/abi/${environment}/HolographBridge.json`),
    HolographInterfacesABI: await fs.readJson(`./src/abi/${environment}/Interfaces.json`),
    LayerZeroABI: await fs.readJson(`./src/abi/${environment}/LayerZero.json`),
    CxipNFTABI: await fs.readJson(`./src/abi/${environment}/CxipNFT.json`),
    FaucetABI: await fs.readJson(`./src/abi/${environment}/Faucet.json`),
    HolographERC20ABI: await fs.readJson(`./src/abi/${environment}/HolographERC20.json`),
    HolographOperatorABI: await fs.readJson(`./src/abi/${environment}/HolographOperator.json`),
  }
}

export const SUPPORTED_CHAIN_IDS = [1, 3, 4, 5, 42, 1337]

declare global {
  type ChainIds = keyof typeof CHAIN_NAMES
  type ChainNames = keyof typeof CHAIN_IDS
  type SupportedChainIds = typeof SUPPORTED_CHAIN_IDS[number]
  // type SupportedChainNames = typeof SUPPORTED_CHAIN_NAMES[number]
  // type DropdownChainIds = typeof DROPDOWN_CHAIN_IDS[number]
  // type DropdownChainNames = typeof DROPDOWN_CHAIN_NAMES[number]
  // type DisabledChainIds = typeof DISABLED_CHAIN_IDS[number]
}

const HOLOGRAPH_LOCALHOST_ADDRESS: string = '0xDebEaA10A84eBC04103Fe387B4AbB7c85b2509d9'.toLowerCase()
const HOLOGRAPH_EXPERIMENTAL_ADDRESS: string = '0x1466ACC19f239fe7d7CA1B5ca36b97CEB488B38B'.toLowerCase()
const HOLOGRAPH_DEVELOP_ADDRESS: string = '0x0Ab35331cc5130DD52e51a9014069f18b8B5EDF9'.toLowerCase()
const HOLOGRAPH_TESTNET_ADDRESS: string = '0xD11a467dF6C80835A1223473aB9A48bF72eFCF4D'.toLowerCase()
const HOLOGRAPH_MAINNET_ADDRESS: string = '0x0000000000000000000000000000000000000000'.toLowerCase()

const HOLOGRAPH_OPERATOR_LOCALHOST_ADDRESS: string = '0x0000000000000000000000000000000000000000'.toLowerCase()
const HOLOGRAPH_OPERATOR_EXPERIMENTAL_ADDRESS: string = '0xf8Dd16cD6C4254ae56e309c9D3eC1Fe9832269f0'.toLowerCase()
const HOLOGRAPH_OPERATOR_DEVELOP_ADDRESS: string = '0x0000000000000000000000000000000000000000'.toLowerCase()
const HOLOGRAPH_OPERATOR_TESTNET_ADDRESS: string = '0x0000000000000000000000000000000000000000'.toLowerCase()
const HOLOGRAPH_OPERATOR_MAINNET_ADDRESS: string = '0x0000000000000000000000000000000000000000'.toLowerCase()

export const HOLOGRAPH_ADDRESSES: {[key in Environment]: string} = {
  [Environment.localhost]: HOLOGRAPH_LOCALHOST_ADDRESS,
  [Environment.experimental]: HOLOGRAPH_EXPERIMENTAL_ADDRESS,
  [Environment.develop]: HOLOGRAPH_DEVELOP_ADDRESS,
  [Environment.testnet]: HOLOGRAPH_TESTNET_ADDRESS,
  [Environment.mainnet]: HOLOGRAPH_MAINNET_ADDRESS,
}
export const HOLOGRAPH_OPERATOR_ADDRESSES: {[key in Environment]: string} = {
  [Environment.localhost]: HOLOGRAPH_OPERATOR_LOCALHOST_ADDRESS,
  [Environment.experimental]: HOLOGRAPH_OPERATOR_EXPERIMENTAL_ADDRESS,
  [Environment.develop]: HOLOGRAPH_OPERATOR_DEVELOP_ADDRESS,
  [Environment.testnet]: HOLOGRAPH_OPERATOR_TESTNET_ADDRESS,
  [Environment.mainnet]: HOLOGRAPH_OPERATOR_MAINNET_ADDRESS,
}

export const FAUCET_ADDRESSES: {[key in Environment]: string} = {
  [Environment.localhost]: '0x0000000000000000000000000000000000000000',
  [Environment.experimental]: '0x4f5A377216ACb6A8D5ffd4d6d9Fbc6d17a4dD790',
  [Environment.develop]: '0x4f5A377216ACb6A8D5ffd4d6d9Fbc6d17a4dD790',
  [Environment.testnet]: '0xc25cB8504f400528823451D38628365d50494e43',
  [Environment.mainnet]: '0xc25cB8504f400528823451D38628365d50494e43',
} as const

export const HLG_TOKEN = {
  type: 'ERC20',
  options: {
    address: '0x36ba4555623ca092e4e70C3018f4CB7165E113eA',
    symbol: 'HLG',
    decimals: 18,
    image: 'https://pbs.twimg.com/profile_images/1518847219104854016/TxgaXhH4_400x400.jpg',
  },
} as const

export const CHAIN_IDS: {[key in string]: number} = {
  mainnet: 1,
  goerli: 5,
  polygon: 137,
  mumbai: 80001,
  bsc: 56,
  avalanche: 43114,
  fuji: 43113,
  fantom: 250,
} as const

export const LZ_RELAYER_ADDRESSES: {[key in number]: string} = {
  [CHAIN_IDS.mainnet]: '0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675',
  [CHAIN_IDS.rinkeby]: '0x79a63d6d8BBD5c6dfc774dA79bCcD948EAcb53FA',
  [CHAIN_IDS.goerli]: '0xbfD2135BFfbb0B5378b56643c2Df8a87552Bfa23',
  [CHAIN_IDS.polygon]: '0x3c2269811836af69497E5F486A85D7316753cf62',
  [CHAIN_IDS.bsc]: '0x3c2269811836af69497E5F486A85D7316753cf62',
  [CHAIN_IDS.avalanche]: '0x3c2269811836af69497E5F486A85D7316753cf62',
  [CHAIN_IDS.fantom]: '0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7',
  [CHAIN_IDS.mumbai]: '0xf69186dfBa60DdB133E91E9A4B5673624293d8F8',
  [CHAIN_IDS.fuji]: '0x93f54D755A063cE7bB9e6Ac47Eccc8e33411d706',
} as const

export const CHAIN_NAMES = {
  [CHAIN_IDS.mainnet]: 'mainnet',
  [CHAIN_IDS.goerli]: 'goerli',
  [CHAIN_IDS.polygon]: 'polygon',
  [CHAIN_IDS.mumbai]: 'mumbai',
  [CHAIN_IDS.bsc]: 'bsc',
  [CHAIN_IDS.avalanche]: 'avalanche',
  [CHAIN_IDS.fantom]: 'fantom',
  [CHAIN_IDS.fuji]: 'fuji',
} as const

export const MUMBAI_GAS_PRICE = BigNumber.from('100000000000')
