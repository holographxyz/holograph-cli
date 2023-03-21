import {PrettyPrintableError} from '@oclif/core/lib/interfaces'
import {AbstractError} from './errors'

export interface Logger {
  log: (message?: string, ...args: any[]) => void
  warn: (input: string | Error) => string | Error
  debug: (...args: any[]) => void
  error: (
    input: string | Error,
    options?: {
      code?: string
      exit?: number
    } & PrettyPrintableError,
  ) => never
  jsonEnabled: () => boolean
  structuredLog?: (network: string, msg: string, tagId?: string | number | (number | string)[]) => void
  structuredLogError?: (
    network: string,
    error: string | Error | AbstractError,
    tagId?: string | number | (number | string)[],
  ) => void
}
export interface AuthOperatorResponse {
  authOperator: {
    accessToken: string
  }
}

export interface CrossChainTransactionResponse {
  crossChainTransaction: CrossChainTransaction
}

export interface UpsertCrossChainTransactionReponse {
  createOrUpdateCrossChainTransaction: CrossChainTransaction
}

export enum TransactionStatus {
  UNKNOWN = 'UNKNOWN',
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
}

export type UpdateCrossChainTransactionStatusInput = Omit<CrossChainTransaction, 'id'>
export type UpdateCrossChainTransactionStatusInputWithoutData = Omit<CrossChainTransaction, 'id' | 'data'>
export interface CrossChainTransaction {
  id?: string
  nftId?: string
  collectionId?: string
  jobType: string
  jobHash: string
  sourceChainId?: number
  sourceBlockNumber?: number
  sourceTx?: string
  sourceStatus?: TransactionStatus
  messageChainId?: number
  messageBlockNumber?: number
  messageTx?: string
  messageStatus?: TransactionStatus
  operatorChainId?: number
  operatorBlockNumber?: number
  operatorTx?: string
  operatorStatus?: TransactionStatus
  operatorAddress?: string
  messageAddress?: string
  sourceAddress?: string
  data?: string
}

export enum NftStatus {
  'DRAFT' = 'DRAFT',
  'SIGNED' = 'SIGNED',
  'MINTING' = 'MINTING',
  'MINTED' = 'MINTED',
  'FAILED' = 'FAILED',
  'BRIDGING' = 'BRIDGING',
}

export enum TokenType {
  'ERC721' = 'ERC721',
  'ERC1155' = 'ERC1155',
}

export type Nft = {
  id?: string
  userId: string
  collectionId: string
  name: string
  description: string | null
  creator: string | null
  type: TokenType
  ipfsImageCid: string | null
  ipfsCid: string | null
  awsUrl: string | null
  arweaveUrl: string | null
  fileExtension: string | null
  chainId: number | null
  status: NftStatus
  isActive: boolean
  contractAddress: string | null
  owner: string | null
  tx: string | null
  isDeployed: boolean | null
  tokenId: string | null
}

export interface NftQueryResponse {
  nftByTx: Nft
  nftByIpfsCid: Nft
}

export interface NftMutationResponse {
  updateNft: Nft
}

export type UpdateNftInput = {updateNftInput: Omit<Nft, 'id'>}
export type GetNftByCidInput = {nftByIpfsCid: {cid: string; tx: string | null}}

export enum CollectionStatus {
  'DRAFT' = 'DRAFT',
  'SIGNED' = 'SIGNED',
  'DEPLOYED' = 'DEPLOYED',
  'FAILED' = 'FAILED',
}

export type Collection = {
  id: string
  createdAt: Date
  updatedAt: Date
  type: TokenType
  tx: string | null
  contractAddress: string | null
  isActive: boolean
  isDeployed: boolean | null
  name: string
  symbol: string
  description: string | null
  royaltyPercentage: number
  chainId: number | null
  chainIds: number[]
  salt: string | null
  status: CollectionStatus
  userId: string
}

export type UpdateCollectionInput = {updateCollectionInput: Omit<Collection, 'id'>}

export enum BlockHeightProcessType {
  INDEXER = 'INDEXER',
  OPERATOR = 'OPERATOR',
}

export type BlockHeight = {
  process: BlockHeightProcessType
  chainId: number
  blockHeight: bigint
  isActive: boolean | null
}
export interface BlockHeightResponse {
  getAllBlockHeights: BlockHeight[]
}
