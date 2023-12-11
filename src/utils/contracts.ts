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
  [Environment.develop]: HOLOGRAPH_ADDRESS_ENV ?? '0x8dd0A4D129f03F1251574E545ad258dE26cD5e97'.toLowerCase(),
  [Environment.testnet]: HOLOGRAPH_ADDRESS_ENV ?? '0x6429b42da2a06aA1C46710509fC96E846F46181e'.toLowerCase(),
  [Environment.mainnet]: HOLOGRAPH_ADDRESS_ENV ?? '0x6429b42da2a06aA1C46710509fC96E846F46181e'.toLowerCase(),
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

export const METADATA_RENDERER_ADDRESS: {[key in Environment]: string} = {
  [Environment.localhost]: '0x0000000000000000000000000000000000000000',
  [Environment.experimental]: '0x0000000000000000000000000000000000000000',
  [Environment.develop]: '0x6420ffC8390506BBC9d894f54b948Be2BE40128d',
  [Environment.testnet]: '0x4d393Bd460B6Ba0957818e947364eA358600396b',
  [Environment.mainnet]: '0x4d393Bd460B6Ba0957818e947364eA358600396b',
}

export const LZ_RELAYER_ADDRESSES: {[key: string]: string} = {
  ethereum: '0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675'.toLowerCase(),
  ethereumTestnetGoerli: '0xbfD2135BFfbb0B5378b56643c2Df8a87552Bfa23'.toLowerCase(),
  polygon: '0x3c2269811836af69497E5F486A85D7316753cf62'.toLowerCase(),
  polygonTestnet: '0xf69186dfBa60DdB133E91E9A4B5673624293d8F8'.toLowerCase(),
  binanceSmartChain: '0x3c2269811836af69497E5F486A85D7316753cf62'.toLowerCase(),
  avalanche: '0x3c2269811836af69497E5F486A85D7316753cf62'.toLowerCase(),
  avalancheTestnet: '0x93f54D755A063cE7bB9e6Ac47Eccc8e33411d706'.toLowerCase(),
  fantom: '0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7'.toLowerCase(),
  optimism: '0x3c2269811836af69497E5F486A85D7316753cf62'.toLowerCase(),
  optimismTestnetGoerli: '0xae92d5aD7583AD66E49A0c67BAd18F6ba52dDDc1'.toLowerCase(),
  arbitrumOne: '0x3c2269811836af69497E5F486A85D7316753cf62'.toLowerCase(),
  arbitrumTestnetGoerli: '0x6aB5Ae6822647046626e83ee6dB8187151E1d5ab'.toLowerCase(),
  mantleTestnet: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  mantle: '0x0000000000000000000000000000000000000000'.toLowerCase(),
  baseTestnetGoerli: '0x6aB5Ae6822647046626e83ee6dB8187151E1d5ab'.toLowerCase(),
  base: '0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7'.toLowerCase(),
} as const
