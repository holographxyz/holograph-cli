import {Network, networks} from '@holographxyz/networks'
import Web3 from 'web3'

import {BigNumber, BigNumberish} from '@ethersproject/bignumber'
import {formatUnits} from '@ethersproject/units'

export const web3 = new Web3()

const HOLOGRAPH_ENVIRONMENT = process.env.HOLONET_ENVIRONMENT || 'develop'
export const IS_MAINNET = HOLOGRAPH_ENVIRONMENT === 'mainnet'

export const networkToChainId: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(networks).map(([key, network]) => [key, network.chain]),
)

// NOTE: This is an inverse map of networkToChainId
export const chainIdToNetwork = (): Readonly<Record<number, string>> => {
  const flipped = Object.entries(networkToChainId).map(([key, value]) => [value, key])
  return Object.fromEntries(flipped)
}

export const NETWORK_COLORS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(networks).map(([key, network]) => [key, network.color]),
)

export const DUMMY_WALLET = {
  privateKey: '494cf7d8741e5fea465cc011b86d30e174fc0483a64675c73c92f109d5cee6ee',
  address: '0x15Eff67DE49192235E65e33afa448580918D70FC',
}

export const formatWalletAddress = (address: string) => {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export const formatTokenId = (tokenId: string) => {
  return BigNumber.from(`${tokenId}`).toString()
}

export const overrideToMinGasPrice = function (chainId: Network['chain'], gasPrice: BigNumber) {
  // NOTE: Here only temporarily. This will be replaced by an RPC call to the blockchain.
  const MIN_GAS_PRICE = {
    [networkToChainId.ethereum]: 40_000_000_001,
    [networkToChainId.goerli]: 5_000_000_001,
    [networkToChainId.polygon]: 200_000_000_001,
    [networkToChainId.bsc]: 3_000_000_001,
    [networkToChainId.testbsc]: 1_000_000_001,
    [networkToChainId.avalanche]: 30_000_000_001,
    [networkToChainId.fantom]: 200_000_000_001,
    [networkToChainId.mumbai]: 5_000_000_001,
    [networkToChainId.fuji]: 30_000_000_001,
    [networkToChainId.optimism]: 10_000_001,
    [networkToChainId.optimismGoerli]: 5_000_000_001,
  } as const

  if (BigNumber.from(MIN_GAS_PRICE[chainId]).gt(gasPrice)) {
    return BigNumber.from(MIN_GAS_PRICE[chainId])
  }

  return gasPrice
}

export const zeroAddress: string = '0x' + '00'.repeat(20)

export function allEventsEnabled(): string {
  return '0x' + 'ff'.repeat(32)
}

export function dropEventsEnabled(): string {
  return '0x0000000000000000000000000000000000000000000000000000000000065000'
}

export function remove0x(input: string): string {
  if (input.startsWith('0x')) {
    return input.slice(2)
  }

  return input
}

export function toAscii(input: string): string {
  input = remove0x(input.trim().toLowerCase())
  if (input.length % 2 !== 0) {
    input = '0' + input
  }

  const arr = [...input]
  let output = ''
  for (let i = 0, l = input.length; i < l; i += 2) {
    const chunk = arr[i] + arr[i + 1]
    if (chunk !== '00') {
      output += String.fromCharCode(Number.parseInt(chunk, 16))
    }
  }

  return output
}

export function sha3(input: string | undefined): string {
  // handle empty bytes issue
  if (input === undefined || input === '' || input === '0x') {
    return '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
  }

  return web3.utils.keccak256(input)
}

export function functionSignature(input: string | undefined): string {
  return sha3(input).slice(0, 10)
}

export function storageSlot(input: string): string {
  return (
    '0x' +
    remove0x(web3.utils.toHex(web3.utils.toBN(web3.utils.keccak256(input)).sub(web3.utils.toBN(1)))).padStart(64, '0')
  )
}

export const toShort18Str = (num: string): string => {
  return formatUnits(num, 'ether')
}

export const toShort18 = (num: BigNumberish): BigNumber => {
  return BigNumber.from(num).div(BigNumber.from('10').pow(18))
}

export const toLong18 = (num: BigNumberish): BigNumber => {
  return BigNumber.from(num).mul(BigNumber.from('10').pow(18))
}

export const generateRandomSalt = (): string => {
  return '0x' + Date.now().toString(16).padStart(64, '0')
}

export function generateHashedName(name: string): string {
  // eslint-disable-next-line unicorn/prefer-string-slice
  const asciiHex = web3.utils.asciiToHex(name).substring(2) // remove '0x' prefix
  const paddedHex = asciiHex.padStart(64, '0')
  return `0x${paddedHex}`
}
