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

export interface UpdateCrossChainTransactionStatusInput extends Omit<CrossChainTransaction, 'id'> {}
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
