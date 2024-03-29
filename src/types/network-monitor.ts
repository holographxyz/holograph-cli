import {BigNumber, Contract, PopulatedTransaction} from 'ethers'
import {Log, TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'
import {ProtocolEvent} from '../utils/protocol-events-map'
import {SqsEventName} from './sqs'
import {DecodedEvent} from '../utils/event'
import {CrossChainMessageType} from '../utils/event/event'

export type LogsParams = {
  network: string
  fromBlock: number
  toBlock?: number
  tags?: (string | number)[]
  attempts?: number
  canFail?: boolean
  interval?: number
}

export type ExecuteTransactionParams = {
  network: string
  tags?: (string | number)[]
  contract: Contract
  methodName: string
  args: any[]
  gasPrice?: BigNumber
  gasLimit?: BigNumber | null
  value?: BigNumber
  attempts?: number
  canFail?: boolean
  interval?: number
  waitForReceipt?: boolean
}

export type SendTransactionParams = {
  network: string
  tags?: (string | number)[]
  rawTx: PopulatedTransaction
  attempts?: number
  canFail?: boolean
  interval?: number
  greedy?: boolean
}

export type PopulateTransactionParams = {
  network: string
  contract: Contract
  methodName: string
  args: any[]
  gasPrice: BigNumber
  gasLimit: BigNumber
  value: BigNumber
  nonce: number
  tags?: (string | number)[]
  attempts?: number
  canFail?: boolean
  interval?: number
}

export type GasLimitParams = {
  network: string
  tags?: (string | number)[]
  contract: Contract
  methodName: string
  args: any[]
  gasPrice?: BigNumber
  value?: BigNumber
  attempts?: number
  canFail?: boolean
  interval?: number
}

export type BlockParams = {
  network: string
  blockNumber: number
  tags?: (string | number)[]
  attempts?: number
  canFail?: boolean
  interval?: number
}

export type WalletParams = {
  network: string
  walletAddress: string
  tags?: (string | number)[]
  attempts?: number
  canFail?: boolean
  interval?: number
}

export type TransactionParams = {
  network: string
  transactionHash: string
  tags?: (string | number)[]
  attempts?: number
  canFail?: boolean
  interval?: number
}

// NOTICE: blockProcessingVersion V1
export interface InterestingLog {
  bloomId: string
  transaction: TransactionResponse
  receipt?: TransactionReceipt
  log?: Log
  allLogs?: Log[]
}

// NOTICE: blockProcessingVersion V2
export interface InterestingTransaction {
  transaction: TransactionResponse
  receipt?: TransactionReceipt
  allLogs: Log[]
}
export interface ExtraDataType {
  crossChainMessageType?: CrossChainMessageType
}
export interface SqsEvent {
  sqsEventName: SqsEventName
  decodedEvent: DecodedEvent | null
  extraData?: ExtraDataType
}
export interface InterestingEvent {
  txHash: string
  transaction: TransactionResponse
  eventName: ProtocolEvent // MoeMintNft, legacyCollectionDeploy
  sqsEvents: SqsEvent[]
  allLogs: Log[]
  logs?: Log[]
}
