import {
  DropInitializerTuple,
  HolographERC721ConfigTuple,
  SalesConfiguration,
  SalesConfigurationTuple,
} from '../types/tuples'

export function generateHolographERC721ConfigTuple(
  contractName: string,
  contractSymbol: string,
  contractBps: number,
  eventConfig: string,
  skipInit: boolean,
  initializer: string,
): HolographERC721ConfigTuple {
  const holographERC721ConfigTuple: HolographERC721ConfigTuple = [
    contractName,
    contractSymbol,
    contractBps,
    eventConfig,
    skipInit,
    initializer,
  ]
  return holographERC721ConfigTuple
}

export function generateSalesConfiguationTuple(salesConfig: SalesConfiguration): SalesConfigurationTuple {
  const salesConfigTuple: SalesConfigurationTuple = [
    salesConfig.publicSalePrice,
    salesConfig.maxSalePurchasePerAddress,
    salesConfig.publicSaleStart,
    salesConfig.publicSaleEnd,
    salesConfig.presaleStart,
    salesConfig.presaleEnd,
    salesConfig.presaleMerkleRoot,
  ]
  return salesConfigTuple
}

export function generateDropInitializerTuple(
  erc721TransferHelper: string,
  marketFilterAddress: string,
  initialOwner: string,
  fundsRecipient: string,
  numberOfEditions: number,
  percentageOfRoyaltiesInBps: number,
  enableOpenSeaRoyaltyRegistry: boolean,
  salesConfigTuple: SalesConfigurationTuple,
  metadataRenderer: string,
  metadataRendererInit: string,
): DropInitializerTuple {
  const dropInitializerTuple: DropInitializerTuple = [
    erc721TransferHelper,
    marketFilterAddress,
    initialOwner,
    fundsRecipient,
    numberOfEditions,
    percentageOfRoyaltiesInBps,
    enableOpenSeaRoyaltyRegistry,
    salesConfigTuple,
    metadataRenderer,
    metadataRendererInit,
  ]
  return dropInitializerTuple
}
