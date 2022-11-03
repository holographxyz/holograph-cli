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
    HolographFactoryABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographFactory.json`)),
    HolographInterfacesABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographInterfaces.json`)),
    HolographOperatorABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographOperator.json`)),
    HolographRegistryABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographRegistry.json`)),
    LayerZeroABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/LayerZeroEndpointInterface.json`)),
  }
}

export const HOLOGRAPH_ADDRESSES: {[key in Environment]: string} = {
  [Environment.localhost]: '0xDebEaA10A84eBC04103Fe387B4AbB7c85b2509d9'.toLowerCase(),
  [Environment.experimental]: '0x9B869476E5281C6a075A7D93ba3Adc60CDdAC443'.toLowerCase(),
  [Environment.develop]: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  [Environment.testnet]: '0x37101ddAd4D1b19ce31A3015e07cfC0cE92E45D7'.toLowerCase(),
  [Environment.mainnet]: '0x0000000000000000000000000000000000000000'.toLowerCase(),
}

export const FAUCET_ADDRESSES: {[key in Environment]: string} = {
  [Environment.localhost]: '0x0000000000000000000000000000000000000000',
  [Environment.experimental]: '0xEd79cdf35016aB8ba182a3125d136726CdE686Ba',
  [Environment.develop]: '0x0000000000000000000000000000000000000000',
  [Environment.testnet]: '0x2CCc77739Fd104bA131366660e53200130EF9831',
  [Environment.mainnet]: '0xc25cB8504f400528823451D38628365d50494e43',
} as const

export const LZ_RELAYER_ADDRESSES: {[key: string]: string} = {
  ethereum: '0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675',
  ethereumTestnetRinkeby: '0x79a63d6d8BBD5c6dfc774dA79bCcD948EAcb53FA',
  ethereumTestnetGoerli: '0xbfD2135BFfbb0B5378b56643c2Df8a87552Bfa23',
  polygon: '0x3c2269811836af69497E5F486A85D7316753cf62',
  polygonTestnet: '0xf69186dfBa60DdB133E91E9A4B5673624293d8F8',
  binanceSmartChain: '0x3c2269811836af69497E5F486A85D7316753cf62',
  avalanche: '0x3c2269811836af69497E5F486A85D7316753cf62',
  avalancheTestnet: '0x93f54D755A063cE7bB9e6Ac47Eccc8e33411d706',
  fantom: '0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7',
} as const
