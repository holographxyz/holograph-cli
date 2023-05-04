import {WebSocketProvider, JsonRpcProvider, Formatter} from '@ethersproject/providers'
import {Block, BlockWithTransactions} from '@ethersproject/abstract-provider'

export interface ExtendedBlock extends Block {
  sha3Uncles: string
  logsBloom: string
  transactionsRoot: string
  stateRoot: string
  totalDifficulty: string
  size: string
  uncles: string[]
}

export interface ExtendedBlockWithTransactions extends BlockWithTransactions {
  sha3Uncles: string
  logsBloom: string
  transactionsRoot: string
  stateRoot: string
  totalDifficulty: string
  size: string
  uncles: string[]
}

export type ExtendedBlockData = ExtendedBlock | ExtendedBlockWithTransactions

export const formatter: Formatter = new Formatter()
export const extendBlock = <T extends ExtendedBlockData>(
  rawBlock: any, // eslint-disable-line @typescript-eslint/explicit-module-boundary-types
  fullBlock: Block | BlockWithTransactions,
): T => {
  const finalBlock: T = {
    ...fullBlock,
    sha3Uncles: formatter.hex(rawBlock.sha3Uncles),
    logsBloom: formatter.hex(rawBlock.logsBloom),
    transactionsRoot: formatter.hex(rawBlock.transactionsRoot),
    stateRoot: formatter.hex(rawBlock.stateRoot),
    totalDifficulty: formatter.hex(rawBlock.totalDifficulty),
    size: formatter.hex(rawBlock.size),
    uncles: rawBlock.uncles.map((v: string) => formatter.hex(v)),
  } as T
  return finalBlock
}

export const getExtendedBlock = async (
  provider: WebSocketProvider | JsonRpcProvider,
  blockNumber: number,
): Promise<ExtendedBlock | null> => {
  const rawBlock: any = await provider.send('eth_getBlockByNumber', [blockNumber.hexify(null, true), false])
  if (rawBlock === null) {
    return null
  }

  return <ExtendedBlock>extendBlock(rawBlock, formatter.block(rawBlock))
}

export const getExtendedBlockWithTransactions = async (
  provider: WebSocketProvider | JsonRpcProvider,
  blockNumber: number,
): Promise<ExtendedBlockWithTransactions | null> => {
  const rawBlock: any = await provider.send('eth_getBlockByNumber', [blockNumber.hexify(null, true), true])
  if (rawBlock === null) {
    return null
  }

  return <ExtendedBlockWithTransactions>extendBlock(rawBlock, formatter.blockWithTransactions(rawBlock))
}
