import {PrettyPrintableError} from '@oclif/core/lib/interfaces'

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
}
export interface AuthOperatorResponse {
  authOperator: {
    accessToken: string
  }
}

export interface CrossChainTransactionResponse {
  crossChainTransaction: CrossChainTransaction
}

export interface CreateOrUpdateCrossChainTransactionResponse {
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
  ipfsMetadataCid: string | null
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
}

export interface NftMutationResponse {
  updateNft: Nft
}

export type UpdateNftInput = Omit<Nft, 'id'>
