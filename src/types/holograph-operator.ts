import {BigNumber} from 'ethers'

export interface PodBondAmounts {
  base: BigNumber
  current: BigNumber
}

export type OperatorJobStructOutput = [
  number,
  number,
  string,
  number,
  BigNumber,
  [number, number, number, number, number],
] & {
  pod: number
  blockTimes: number
  operator: string
  startBlock: number
  startTimestamp: BigNumber
  fallbackOperators: [number, number, number, number, number]
}
