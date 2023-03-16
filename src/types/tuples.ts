import {ethers} from 'ethers'

export type SaleConfig = {
  publicSalePrice: ethers.BigNumber
  maxSalePurchasePerAddress: number
  publicSaleStart: number
  publicSaleEnd: number
  presaleStart: number
  presaleEnd: number
  presaleMerkleRoot: string
}

export type SalesConfigTuple = [
  string, // erc721TransferHelper
  string, // marketFilterAddress
  string, // initialOwner
  string, // fundsRecipient
  number, // number of editions
  number, // percentage of royalties in bps
  SaleConfig, // sales config object
  string, // metadataRenderer
  string, // metadataRendererInit
]

export type HolographERC721ConfigTuple = [
  string, // contractName
  string, // contractSymbol
  number, // contractBps
  string, // eventConfig
  boolean, // skipInit
  string, // initializer
]
