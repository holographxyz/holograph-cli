import Web3 from 'web3'
import {networks} from '@holographxyz/networks'
import {supportedNetworks} from './config'

// Used for web3 utility functions
const web3 = new Web3('ws://localhost:8545')

function randomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min
}

function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1)
}

// eslint-disable-next-line no-promise-executor-return
const sleep = (ms: number): Promise<unknown> => new Promise(resolve => setTimeout(resolve, ms))

const webSocketConfig = {
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

const NETWORK_COLORS: Record<string, string> = {
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

const rgbToHex = (rgb: number): string => {
  const hex = Number(rgb).toString(16)
  return hex.length === 1 ? `0${hex}` : hex
}

function networkRestruct() {
  const keys = supportedNetworks

  // eslint-disable-next-line unicorn/no-array-reduce
  const out = keys.reduce(
    (prev: any, next: any) => {
      const chainId = networks[next].chain
      const holographId = networks[next].holographId

      prev.byChainId[chainId] = holographId
      prev.byHolographId[holographId] = chainId
      prev.byNetworkName[chainId] = next

      return prev
    },
    {byChainId: {}, byHolographId: {}, byNetworkName: {}},
  )
  return out
}

function getNetworkName(chainId: any) {
  const dataMap = networkRestruct()
  return dataMap.byNetworkName[chainId]
}

function getChainId(holographId: any) {
  const dataMap = networkRestruct()
  return dataMap.byHolographId[holographId]
}

function getHolographId(chainId: any) {
  const dataMap = networkRestruct()
  return dataMap.byChainId[chainId]
}

const zeroAddress: string = '0x' + '00'.repeat(20)

function generateInitCode(vars: string[], vals: any[]): string {
  return web3.eth.abi.encodeParameters(vars, vals)
}

function remove0x(input: string): string {
  if (input.startsWith('0x')) {
    return input.slice(2)
  }

  return input
}

export {
  sleep,
  capitalize,
  rgbToHex,
  randomNumber,
  getChainId,
  getNetworkName,
  getHolographId,
  webSocketConfig,
  NETWORK_COLORS,
  web3,
  zeroAddress,
  generateInitCode,
  remove0x,
}
