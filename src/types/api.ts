export interface AuthOperatorResponse {
  authOperator: {
    accessToken: string
  }
}

export interface CrossChainTransactionResponse {
  crossChainTransaction: CrossChainTransaction
}

export enum TransactionStatus {
  UNKNOWN = 'UNKNOWN',
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
}

export interface updateCrossChainTransactionStatusInput {
  jobType: string
  jobHash: string
  sourceStatus?: TransactionStatus
  messageStatus?: TransactionStatus
  operatorStatus?: TransactionStatus
}

export interface CrossChainTransaction {
  jobType: string
  jobHash: string
  sourceChainId?: number
  sourceBlockNumber?: number
  sourceTx: string
  sourceStatus: TransactionStatus
  messageChainId?: number
  messageBlockNumber?: number
  messageTx: string
  messageStatus: TransactionStatus
  operatorChainId?: number
  operatorBlockNumber?: number
  operatorTx: string
  operatorStatus: TransactionStatus
}
