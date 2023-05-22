import {TransactionResponse} from '@ethersproject/abstract-provider'
import {BridgeInErc20Args, BridgeOutErc20Args} from '../utils/bridge'
import {DeploymentConfig} from '../utils/contract-deployment'

export type DBJob = {
  attempts: number
  timestamp: number
  network: string
  query: string
  identifier?: any
  message: string
  callback: (...args: any[]) => Promise<void>
  arguments: any[]
  tags: (string | number)[]
}

export type DBJobMap = {
  [key: number]: DBJob[]
}

export type UpdateBridgedContract = (
  direction: string,
  transaction: TransactionResponse,
  network: string,
  contractAddress: string,
  deploymentConfig: DeploymentConfig,
  tags: (string | number)[],
) => Promise<void>

export type UpdateBridgedERC20 = (
  transaction: TransactionResponse,
  network: string,
  erc20BridgeInfo: BridgeInErc20Args | BridgeOutErc20Args,
  tags: (string | number)[],
) => Promise<void>

export type UpdateBridgedERC721 = (
  direction: string,
  transaction: TransactionResponse,
  network: string,
  fromNetwork: string,
  toNetwork: string,
  contractType: string,
  contractAddress: string,
  erc721TransferEvent: any[],
  operatorJobHash: string,
  tags: (string | number)[],
) => Promise<void>

export type UpdateMintedERC721 = (
  transaction: TransactionResponse,
  network: string,
  contractAddress: string,
  erc721TransferEvent: any[],
  tags: (string | number)[],
) => Promise<void>

export type UpdateDeployedContract = (
  transaction: TransactionResponse,
  network: string,
  contractAddress: string,
  deploymentConfig: DeploymentConfig,
  tags: (string | number)[],
) => Promise<void>
