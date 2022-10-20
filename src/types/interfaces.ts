declare type BigNumberish = import('@ethersproject/bignumber').BigNumberish
declare type BytesLike = import('@ethersproject/bytes').BytesLike
declare type TransactionReceipt = import('@ethersproject/abstract-provider').TransactionReceipt
declare type TransactionResponse = import('@ethersproject/providers').TransactionResponse

interface CreateERC721Payload {
  address: string
  name: string
  symbol: string
  royalty: string
}

interface CreateERC721Request {
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

interface SignatureBody {
  r: BytesLike
  s: BytesLike
  v: BigNumberish
}

interface ERC721CollectionBody {
  name: BytesLike
  name2: BytesLike
  symbol: BytesLike
  royalties: string
  bps: BigNumberish
}

interface ERC721NFTBody {
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

interface Erc721Config {
  erc721Config: DeploymentConfigStruct
  erc721ConfigHash: BytesLike
  erc721ConfigHashBytes: Uint8Array
  erc721FutureAddress: BytesLike
}

interface Signature {
  r: string
  s: string
  v: string
}

interface GasFee {
  gasPrice: BigNumberish
  gasLimit: BigNumberish
  gas: BigNumberish
}
