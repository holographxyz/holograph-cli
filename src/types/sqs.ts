import {Environment} from '@holographxyz/environment'
import {BridgeInErc20Args, BridgeOutErc20Args} from '../utils/bridge'
import {DeploymentConfig} from '../utils/contract-deployment'

export enum PayloadType {
  HolographProtocol = 'HolographProtocol',
  ERC20 = 'ERC20',
  ERC721 = 'ERC721',
}

export enum ContractType {
  HolographERC20 = 'HolographERC20',
  HolographERC721 = 'HolographERC721',
}

export type SqsMessageBody = {
  type: PayloadType
  eventName: string
  tagId: (string | number)[]
  chainId: number
  holographAddress: string
  environment: Environment
  payload: MintEventPayload | BridgeContractDeploymentPayload | BridgeERC20TransferPayload | BridgeERC721TransferPayload
}

export type MintEventPayload = {
  tx: string
  blockNum: number
  collectionAddress: string
  nftTokenId: string
  to: string
}

export enum BridgeDirection {
  In = 'in',
  Out = 'out',
}

export type BridgeContractDeploymentPayload = {
  tx: string
  blockNum: number
  contractAddress: string
  deploymentConfig: DeploymentConfig
}

export type BridgeERC20TransferPayload = {
  tx: string
  blockNum: number
  direction: BridgeDirection
  contractAddress: string
  erc20BeamInfo: BridgeInErc20Args | BridgeOutErc20Args
  contractType: ContractType.HolographERC20
}

export type BridgeERC721TransferPayload = {
  tx: string
  blockNum: number
  direction: BridgeDirection
  contractAddress: string
  contractType: ContractType.HolographERC721
  operatorJobHash: string
  fromNetwork: string
  toNetwork: string
  nftTokenId: string
}
