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
  [Environment.localhost]: '0xa3931469C1D058a98dde3b5AEc4dA002B6ca7446'.toLowerCase(),
  [Environment.experimental]: '0x199728d88a68856868f50FC259F01Bb4D2672Da9'.toLowerCase(),
  [Environment.develop]: '0x1D8370fa026f17936683cd5502f1A6Fc017b0e6d'.toLowerCase(),
  [Environment.testnet]: '0x9789dA8945527eF133eE78736b410CBb23b47A85'.toLowerCase(),
  [Environment.mainnet]: '0xE236E8E4283795E85b3021198Af69ddED9e132CD'.toLowerCase(),
}

export const FAUCET_ADDRESSES: {[key in Environment]: string} = {
  [Environment.localhost]: '0x232E8406518da66ecD5681a600f18A13E8CfE5E6',
  [Environment.experimental]: '0x122C44eB91D149E6F495eD7cC3a5603eA05b593e',
  [Environment.develop]: '0x8F673584cCB5eD6Ab4a285f4d81974C9b26E48C5',
  [Environment.testnet]: '0x316b89F1805D9eEFd2A89D63e2712b02C2549231',
  [Environment.mainnet]: '0x0000000000000000000000000000000000000000',
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
