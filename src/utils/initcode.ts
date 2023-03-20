import {ethers} from 'ethers'
import {DropInitializerTuple, HolographERC721ConfigTuple, SalesConfigurationTuple} from '../types/tuples'

export function generateInitCode(vars: string[], vals: any[]): string {
  return ethers.utils.defaultAbiCoder.encode(vars, vals)
}

export function generateSalesConfigInitCode(salesConfigTuple: SalesConfigurationTuple): string {
  return generateInitCode(['tuple(uint104,uint32,uint64,uint64,uint64,uint64,bytes32)'], salesConfigTuple)
}

export function generateDropInitCode(dropInitializerTuple: DropInitializerTuple): string {
  return generateInitCode(
    [
      'string',
      'string',
      'string',
      'string',
      'uint16',
      'uint16',
      'bool',
      'tuple(uint104,uint32,uint64,uint64,uint64,uint64,bytes32)',
      'string',
      'string',
    ],
    dropInitializerTuple,
  )
}

export function generateHolographERC721ConfigInitCode(holographERC721ConfigTuple: HolographERC721ConfigTuple): string {
  return generateInitCode(['string', 'string', 'uint16', 'string', 'bool', 'string'], holographERC721ConfigTuple)
}

export function generateMetadataRendererInitCode(description: string, imageURI: string, animationURI: string): string {
  return generateInitCode(['string', 'string', 'string'], [description, imageURI, animationURI])
}
