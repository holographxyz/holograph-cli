import {ethers} from 'ethers'

export type SalesConfiguration = {
  publicSalePrice: ethers.BigNumber
  maxSalePurchasePerAddress: number
  publicSaleStart: number
  publicSaleEnd: number
  presaleStart: number
  presaleEnd: number
  presaleMerkleRoot: string
}

export type SalesConfigurationTuple = [
  ethers.BigNumber, // publicSalePrice
  number, // maxSalePurchasePerAddress
  number, // publicSaleStart
  number, // publicSaleEnd
  number, // presaleStart
  number, // presaleEnd
  string, // presaleMerkleRoot
]

export type DropInitializerTuple = [
  string, // erc721TransferHelper
  string, // marketFilterAddress
  string, // initialOwner
  string, // fundsRecipient
  number, // number of editions
  number, // percentage of royalties in bps
  boolean, // enableOpenSeaRoyaltyRegistry
  SalesConfigurationTuple, // SalesConfiguration
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
