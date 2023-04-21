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
