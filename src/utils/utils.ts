import Web3 from 'web3'
import {BigNumber} from 'ethers'
import {networks} from '@holographxyz/networks'
import {supportedNetworks} from './config'

// Used for web3 utility functions
export const web3 = new Web3('ws://localhost:8545')

export function randomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min
}

export function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1)
}

// eslint-disable-next-line no-promise-executor-return
export const sleep = (ms: number): Promise<unknown> => new Promise(resolve => setTimeout(resolve, ms))

export const webSocketConfig = {
  reconnect: {
    auto: false,
    // delay: 7000, // ms
    onTimeout: false,
    // maxAttempts:
  },
  timeout: 1000 * 15, // 15 seconds
  clientConfig: {
    maxReceivedFrameSize: 10_000_000_000,
    maxReceivedMessageSize: 10_000_000_000,
    keepalive: true,
    keepaliveInterval: 1000, // ms
    dropConnectionOnKeepaliveTimeout: true,
    keepaliveGracePeriod: 4000, // ms
  },
}

export const NETWORK_COLORS: Record<string, string> = {
  localhost: '##83EEFF',
  localhost2: '#ff0000',
  fuji: '#ff0000',
  avax: '#ff0000',
  mumbai: '##B026FF ',
  polygon: '#B026FF ',
  // eslint-disable-next-line camelcase
  eth_rinkeby: '##83EEFF',
  // eslint-disable-next-line camelcase
  eth_goerli: '#83EEFF',
  eth: '##83EEFF',
}

export const rgbToHex = (rgb: number): string => {
  const hex = Number(rgb).toString(16)
  return hex.length === 1 ? `0${hex}` : hex
}

interface NetworkMap {
  [key: number]: string
}

interface NetworkHelper {
  byChainId: NetworkMap
  byHolographId: NetworkMap
  byLzId: NetworkMap
}

function networkHelperConstructor(): NetworkHelper {
  const helper: NetworkHelper = {byChainId: {}, byHolographId: {}, byLzId: {}} as NetworkHelper
  for (const networkName of supportedNetworks) {
    const network = networks[networkName]
    const chainId: number = network.chain
    const holographId: number = network.holographId
    const lzId: number = network.lzId

    helper.byChainId[chainId] = networkName
    helper.byHolographId[holographId] = networkName
    if (network.lzId > 0) {
      helper.byLzId[lzId] = networkName
    }
  }

  return helper
}

const networkHelper: NetworkHelper = networkHelperConstructor()

export function getNetworkByChainId(chainId: BigNumber | string | number): string {
  return networkHelper.byChainId[BigNumber.from(chainId).toNumber()]
}

export function getNetworkByHolographId(holographId: BigNumber | string | number): string {
  return networkHelper.byHolographId[BigNumber.from(holographId).toNumber()]
}

export function getNetworkByLzId(lzId: BigNumber | string | number): string {
  return networkHelper.byLzId[BigNumber.from(lzId).toNumber()]
}

export const zeroAddress: string = '0x' + '00'.repeat(20)

export function generateInitCode(vars: string[], vals: any[]): string {
  return web3.eth.abi.encodeParameters(vars, vals)
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
