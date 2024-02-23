import * as fs from 'fs-extra'
const path = require('node:path')

import {Environment} from '@holographxyz/environment'
import {Contract} from 'ethers'

export type ContractInfo = {
  address: string
  abi: any
}

export type ContractMap = {
  [contractName: string]: ContractInfo
}

export interface IContracts {
  cxipERC721Contract: Contract
  bridgeContract: Contract
  factoryContract: Contract
  interfacesContract: Contract
  operatorContract: Contract
  registryContract: Contract
  messagingModuleContract: Contract
}

interface ContractAbis {
  CxipERC721ABI: Array<Record<string, any>>
  FaucetABI: Array<Record<string, any>>
  HolographABI: Array<Record<string, any>>
  HolographerABI: Array<Record<string, any>>
  HolographBridgeABI: Array<Record<string, any>>
  HolographERC20ABI: Array<Record<string, any>>
  HolographERC721ABI: Array<Record<string, any>>
  HolographDropERC721ABI: Array<Record<string, any>>
  HolographFactoryABI: Array<Record<string, any>>
  HolographInterfacesABI: Array<Record<string, any>>
  HolographOperatorABI: Array<Record<string, any>>
  HolographRegistryABI: Array<Record<string, any>>
  LayerZeroABI: Array<Record<string, any>>
  MockLZEndpointABI: Array<Record<string, any>>
  EditionsMetadataRendererABI: Array<Record<string, any>>
  OwnerABI: Array<Record<string, any>>
}

export const getABIs = async (environment: string): Promise<ContractAbis> => {
  return {
    CxipERC721ABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/CxipERC721.json`)),
    FaucetABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/Faucet.json`)),
    HolographABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/Holograph.json`)),
    HolographerABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/Holographer.json`)),
    HolographBridgeABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographBridge.json`)),
    HolographERC20ABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographERC20.json`)),
    HolographERC721ABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographERC721.json`)),
    HolographDropERC721ABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographDropERC721.json`)),
    HolographFactoryABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographFactory.json`)),
    HolographInterfacesABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographInterfaces.json`)),
    HolographOperatorABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographOperator.json`)),
    HolographRegistryABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/HolographRegistry.json`)),
    LayerZeroABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/LayerZeroEndpointInterface.json`)),
    MockLZEndpointABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/MockLZEndpoint.json`)),
    EditionsMetadataRendererABI: await fs.readJson(
      path.join(__dirname, `../abi/${environment}/EditionsMetadataRenderer.json`),
    ),
    OwnerABI: await fs.readJson(path.join(__dirname, `../abi/${environment}/Owner.json`)),
  }
}

const HOLOGRAPH_ADDRESS_ENV = process.env.HOLOGRAPH_ADDRESS ? process.env.HOLOGRAPH_ADDRESS.toLowerCase() : undefined

export const HOLOGRAPH_ADDRESSES: {[key in Environment]: string} = {
  [Environment.localhost]: HOLOGRAPH_ADDRESS_ENV ?? '0xa3931469C1D058a98dde3b5AEc4dA002B6ca7446'.toLowerCase(),
  [Environment.experimental]: HOLOGRAPH_ADDRESS_ENV ?? '0x199728d88a68856868f50FC259F01Bb4D2672Da9'.toLowerCase(),
  [Environment.develop]: HOLOGRAPH_ADDRESS_ENV ?? '0x11bc5912f9ed5E16820f018692f8E7FDA91a8529'.toLowerCase(),
  [Environment.testnet]: HOLOGRAPH_ADDRESS_ENV ?? '0x1Ed99DFE7462763eaF6925271D7Cb2232a61854C'.toLowerCase(),
  [Environment.mainnet]: HOLOGRAPH_ADDRESS_ENV ?? '0x1Ed99DFE7462763eaF6925271D7Cb2232a61854C'.toLowerCase(),
}

export const FAUCET_ADDRESSES: {[key in Environment]: string} = {
  [Environment.localhost]: '0x232E8406518da66ecD5681a600f18A13E8CfE5E6'.toLowerCase(),
  [Environment.experimental]: '0x122C44eB91D149E6F495eD7cC3a5603eA05b593e'.toLowerCase(),
  [Environment.develop]: '0x58F4dA1890Ca2c0e8880F77935CdC063D9a967f8'.toLowerCase(),
  [Environment.testnet]: '0xe54b42B7002D58bA5C9df2BCc5b8a520B8b94463'.toLowerCase(),
  [Environment.mainnet]: '0x0000000000000000000000000000000000000000'.toLowerCase(),
} as const

export const CXIP_ERC721_ADDRESSES: {[key in Environment]: string} = {
  [Environment.localhost]: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  [Environment.experimental]: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  [Environment.develop]: '0xF7d4Fa879F925b431265936e68b0Ba3804269610'.toLowerCase(),
  [Environment.testnet]: '0xC2C27589eF9B5cfBfd57e55A5Be90b960231D0cb'.toLowerCase(),
  [Environment.mainnet]: '0xC2C27589eF9B5cfBfd57e55A5Be90b960231D0cb'.toLowerCase(),
}

export const METADATA_RENDERER_ADDRESS: {[key in Environment]: string} = {
  [Environment.localhost]: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  [Environment.experimental]: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  [Environment.develop]: '0x1564512435fd9B608c86B2349271Bd8793a78A68'.toLowerCase(),
  [Environment.testnet]: '0x60B839C2f7dBa29eB93b094067E6C87067d1B3df'.toLowerCase(),
  [Environment.mainnet]: '0x60B839C2f7dBa29eB93b094067E6C87067d1B3df'.toLowerCase(),
}

export const LZ_RELAYER_ADDRESSES: {[key: string]: string} = {
  ethereum: '0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675'.toLowerCase(),
  ethereumTestnetSepolia: '0xae92d5aD7583AD66E49A0c67BAd18F6ba52dDDc1'.toLowerCase(),
  polygon: '0x3c2269811836af69497E5F486A85D7316753cf62'.toLowerCase(),
  polygonTestnet: '0xf69186dfBa60DdB133E91E9A4B5673624293d8F8'.toLowerCase(),
  binanceSmartChain: '0x3c2269811836af69497E5F486A85D7316753cf62'.toLowerCase(),
  avalanche: '0x3c2269811836af69497E5F486A85D7316753cf62'.toLowerCase(),
  avalancheTestnet: '0x93f54D755A063cE7bB9e6Ac47Eccc8e33411d706'.toLowerCase(),
  fantom: '0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7'.toLowerCase(),
  optimism: '0x3c2269811836af69497E5F486A85D7316753cf62'.toLowerCase(),
  optimismTestnetSepolia: '0x55370E0fBB5f5b8dAeD978BA1c075a499eB107B8'.toLowerCase(),
  arbitrumOne: '0x3c2269811836af69497E5F486A85D7316753cf62'.toLowerCase(),
  arbitrumTestnetSepolia: '0x6098e96a28E02f27B1e6BD381f870F1C8Bd169d3'.toLowerCase(),
  mantleTestnet: '0x2cA20802fd1Fd9649bA8Aa7E50F0C82b479f35fe'.toLowerCase(),
  mantle: '0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7'.toLowerCase(),
  baseTestnetSepolia: '0x55370E0fBB5f5b8dAeD978BA1c075a499eB107B8'.toLowerCase(),
  base: '0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7'.toLowerCase(),
  zoraTestnetSepolia: '0x55370E0fBB5f5b8dAeD978BA1c075a499eB107B8'.toLowerCase(),
  zora: '0xA658742d33ebd2ce2F0bdFf73515Aa797Fd161D9'.toLowerCase(),
} as const
