import {Contract, Wallet} from 'ethers'
import {HolographERC721ConfigTuple, SaleConfig, SalesConfigTuple} from '../types/tuples'
import {generateInitCode, generateSalesConfigInitCode} from './initcode'
import {allEventsEnabled, generateHashedName} from './utils'

export function generateHolographERC721ConfigTuple(
  collectionName: string,
  collectionSymbol: string,
  royaltyBps: number,
  salesConfigTuple: SalesConfigTuple,

  registryAddress: string,
): HolographERC721ConfigTuple {
  const eventConfig = allEventsEnabled()
  const skipInit = false
  const initializer = generateInitCode(
    ['bytes32', 'address', 'bytes'],
    [generateHashedName('HolographDropsEditionsV1'), registryAddress, generateSalesConfigInitCode(salesConfigTuple)],
  )
  return [collectionName, collectionSymbol, royaltyBps, eventConfig, skipInit, initializer]
}

export function generateSalesConfigTuple(
  userWallet: Wallet,
  numOfEditions: number,
  royaltyBps: number,
  salesConfig: SaleConfig,
  metadataRenderer: Contract,
  description: string,
  imageURI: string,
  animationURI: string,
): SalesConfigTuple {
  const salesConfigTuple: SalesConfigTuple = [
    '0x0000000000000000000000000000000000000000', // erc721TransferHelper
    '0x000000000000AAeB6D7670E522A718067333cd4E', // marketFilterAddress (opensea)
    userWallet.address, // initialOwner
    userWallet.address, // fundsRecipient
    numOfEditions, // number of editions
    royaltyBps, // percentage of royalties in bps
    salesConfig,
    metadataRenderer.address, // metadataRenderer
    generateInitCode(['string', 'string', 'string'], [description, imageURI, animationURI]), // metadataRendererInit
  ]
  return salesConfigTuple
}
