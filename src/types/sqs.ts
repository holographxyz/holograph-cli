import {Environment} from '@holographxyz/environment'

export enum PayloadType {
  HolographProtocol = 'HolographProtocol',
  ERC20 = 'ERC20',
  ERC721 = 'ERC721',
}

export type SqsMessageBody = {
  type: PayloadType
  eventName: string
  tagId: (string | number)[]
  chainId: number
  holographAddress: string
  environment: Environment
  payload: MintEventPayload
}

export type MintEventPayload = {
  tx: string
  blockNum: number
  collectionAddress: string
  nftTokenId: string
  to: string
}
