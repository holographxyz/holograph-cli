import * as fs from 'fs-extra'
const path = require('node:path')

import {Environment} from '@holographxyz/environment'

export const getABIs = async (environment: string): Promise<any> => {
  return {
    CxipERC721ABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/CxipERC721.json`)),
    FaucetABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/Faucet.json`)),
    HolographABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/Holograph.json`)),
    HolographBridgeABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographBridge.json`)),
    HolographERC20ABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographERC20.json`)),
    HolographERC721ABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographERC721.json`)),
    HolographDropERC721ABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographDropERC721.json`)),
    HolographFactoryABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographFactory.json`)),
    HolographInterfacesABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographInterfaces.json`)),
    HolographOperatorABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographOperator.json`)),
    HolographRegistryABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographRegistry.json`)),
    LayerZeroABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/LayerZeroEndpointInterface.json`)),
  }
}

export const HOLOGRAPH_ADDRESSES: {[key in Environment]: string} = {
  [Environment.localhost]: '0xa3931469C1D058a98dde3b5AEc4dA002B6ca7446'.toLowerCase(),
  [Environment.experimental]: '0x199728d88a68856868f50FC259F01Bb4D2672Da9'.toLowerCase(),
  [Environment.develop]: '0x8dd0A4D129f03F1251574E545ad258dE26cD5e97'.toLowerCase(),
  [Environment.testnet]: '0x6429b42da2a06aA1C46710509fC96E846F46181e'.toLowerCase(),
  [Environment.mainnet]: '0x6429b42da2a06aA1C46710509fC96E846F46181e'.toLowerCase(),
}

export const FAUCET_ADDRESSES: {[key in Environment]: string} = {
  [Environment.localhost]: '0x232E8406518da66ecD5681a600f18A13E8CfE5E6',
  [Environment.experimental]: '0x122C44eB91D149E6F495eD7cC3a5603eA05b593e',
  [Environment.develop]: '0xb934d4B23F70fd8EB99cc8E9629285060cB4C9F2',
  [Environment.testnet]: '0xe54b42B7002D58bA5C9df2BCc5b8a520B8b94463',
  [Environment.mainnet]: '0x0000000000000000000000000000000000000000',
} as const

export const CXIP_ERC721_ADDRESSES: {[key in Environment]: string} = {
  [Environment.localhost]: '0x0000000000000000000000000000000000000000',
  [Environment.experimental]: '0x0000000000000000000000000000000000000000',
  [Environment.develop]: '0x156C8b069232986c8C6bD9017BBAA098e97f0269',
  [Environment.testnet]: '0x690f4b7e0a102047d442CA3FEcDbB024Cb6b1FC5',
  [Environment.mainnet]: '0x690f4b7e0a102047d442CA3FEcDbB024Cb6b1FC5',
}

export const LZ_RELAYER_ADDRESSES: {[key: string]: string} = {
  ethereum: '0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675',
  ethereumTestnetGoerli: '0xbfD2135BFfbb0B5378b56643c2Df8a87552Bfa23',
  polygon: '0x3c2269811836af69497E5F486A85D7316753cf62',
  polygonTestnet: '0xf69186dfBa60DdB133E91E9A4B5673624293d8F8',
  binanceSmartChain: '0x3c2269811836af69497E5F486A85D7316753cf62',
  avalanche: '0x3c2269811836af69497E5F486A85D7316753cf62',
  avalancheTestnet: '0x93f54D755A063cE7bB9e6Ac47Eccc8e33411d706',
  fantom: '0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7',
} as const
