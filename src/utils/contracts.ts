import {BigNumber, BigNumberish} from 'ethers'
import {formatEther} from 'ethers/lib/utils'
import * as fs from 'fs-extra'
import {Environment} from './environment'

export const toShort18Str = (num: string): string => {
  return formatEther(num)
}

export const toShort18 = (num: BigNumberish): BigNumberish => {
  return BigNumber.from(num).div(BigNumber.from('10').pow(18))
}

export const toLong18 = (num: BigNumberish): BigNumberish => {
  return BigNumber.from(num).mul(BigNumber.from('10').pow(18))
}

export const generateRandomSalt = () => {
  return '0x' + Date.now().toString(16).padStart(64, '0')
}

export const utf8ToBytes32 = (str: string) => {
  return (
    '0x' +
    [...str]
      .map(c =>
        c.charCodeAt(0) < 128 ? c.charCodeAt(0).toString(16) : encodeURIComponent(c).replace(/%/g, '').toLowerCase(),
      )
      .join('')
      .padStart(64, '0')
  )
}

export const getABIs = async (environment: string) => {
  return {
    HolographABI: await fs.readJson(`./src/abi/${environment}/Holograph.json`),
    HolographFactoryABI: await fs.readJson(`./src/abi/${environment}/HolographFactory.json`),
    HolographBridgeABI: await fs.readJson(`./src/abi/${environment}/HolographBridge.json`),
    HolographInterfacesABI: await fs.readJson(`./src/abi/${environment}/HolographInterfaces.json`),
    LayerZeroABI: await fs.readJson(`./src/abi/${environment}/LayerZeroEndpointInterface.json`),
    CxipNFTABI: await fs.readJson(`./src/abi/${environment}/CxipERC721.json`),
    FaucetABI: await fs.readJson(`./src/abi/${environment}/Faucet.json`),
    HolographERC20ABI: await fs.readJson(`./src/abi/${environment}/HolographERC20.json`),
    HolographOperatorABI: await fs.readJson(`./src/abi/${environment}/HolographOperator.json`),
  }
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

export const LZ_RELAYER_ADDRESSES: {[key: string]: string} = {
  ethereum: '0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675',
  ethereumTestnetRinkeby: '0x79a63d6d8BBD5c6dfc774dA79bCcD948EAcb53FA',
  ethereumTestnetGoerli: '0xbfD2135BFfbb0B5378b56643c2Df8a87552Bfa23',
  polygon: '0x3c2269811836af69497E5F486A85D7316753cf62',
  binanceSmartChain: '0x3c2269811836af69497E5F486A85D7316753cf62',
  avalanche: '0x3c2269811836af69497E5F486A85D7316753cf62',
  fantom: '0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7',
  polygonTestnet: '0xf69186dfBa60DdB133E91E9A4B5673624293d8F8',
  avalancheTestnet: '0x93f54D755A063cE7bB9e6Ac47Eccc8e33411d706',
} as const
