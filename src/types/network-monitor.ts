import {BigNumber, Contract, PopulatedTransaction} from 'ethers'
import {Log, TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'

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

export interface InterestingTransaction {
  bloomId: string
  transaction: TransactionResponse
  receipt?: TransactionReceipt
  log?: Log
  allLogs?: Log[]
}
