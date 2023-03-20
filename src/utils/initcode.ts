import {ethers} from 'ethers'
import {HolographERC721ConfigTuple, SalesConfigTuple} from '../types/tuples'

export function generateInitCode(vars: string[], vals: any[]): string {
  return ethers.utils.defaultAbiCoder.encode(vars, vals)
}

export function generateSalesConfigInitCode(salesConfigTuple: SalesConfigTuple): string {
  const salesConfigInitCode = generateInitCode(
    [
      'tuple(address,address,address,address,uint64,uint16,tuple(uint104,uint32,uint64,uint64,uint64,uint64,bytes32),address,bytes)',
    ],
    [salesConfigTuple],
  )
  return salesConfigInitCode
}

export function generateDropInitCode(holographERC721ConfigTuple: HolographERC721ConfigTuple): string {
  return generateInitCode(
    ['string', 'string', 'uint16', 'bool', 'uint256', 'bool', 'bytes'],
    holographERC721ConfigTuple,
  )
}

export function generateMetadataRendererInitCode(description: string, imageURI: string, animationURI: string): string {
  return generateInitCode(['string', 'string', 'string'], [description, imageURI, animationURI])
}
