import {BigNumberish} from '@ethersproject/bignumber'
import {BytesLike} from '@ethersproject/bytes'

export interface CreateERC721Payload {
  address: string
  name: string
  symbol: string
  royalty: string
}

export interface CreateERC721Request {
  salt: string
  address: string
  verification: unknown | {r: BytesLike; s: BytesLike; v: BigNumberish}
  collectionData:
    | unknown
    | {
        name: BytesLike
        name2: BytesLike
        symbol: BytesLike
        royalties: string
        bps: BigNumberish
      }
}

export interface SignatureBody {
  r: BytesLike
  s: BytesLike
  v: BigNumberish
}

export interface ERC721CollectionBody {
  name: BytesLike
  name2: BytesLike
  symbol: BytesLike
  royalties: string
  bps: BigNumberish
}

export interface ERC721NFTBody {
  payloadHash: BytesLike
  payloadSignature: SignatureBody
  creator: string
  arweave: BytesLike
  arweave2: BytesLike
  ipfs: BytesLike
  ipfs2: BytesLike
}

type DeploymentConfigStruct = {
  contractType: BytesLike
  chainType: BigNumberish
  salt: BytesLike
  byteCode: BytesLike
  initCode: BytesLike
}

export interface Erc721Config {
  erc721Config: DeploymentConfigStruct
  erc721ConfigHash: BytesLike
  erc721ConfigHashBytes: Uint8Array
  erc721FutureAddress: BytesLike
}

export interface Signature {
  r: string
  s: string
  v: string
}

export interface GasFee {
  gasPrice: BigNumberish
  gasLimit: BigNumberish
  gas: BigNumberish
}
