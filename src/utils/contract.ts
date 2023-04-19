export enum ContractType {
  UNKNOWN = 'UNKNOWN',
  ERC20 = 'ERC20',
  ERC721 = 'ERC721',
  ERC1155 = 'ERC1155',
  LAYERZERO = 'LAYERZERO',
  HYPERLANE = 'HYPERLANE',
}

export type CachedContractMap = {
  [key in keyof typeof ContractType]?: string[]
}
