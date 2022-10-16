import Web3 from 'web3'
import networks from './networks'

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
  fuji: '#ff0000',
  avax: '#ff0000',
  mumbai: '##B026FF ',
  polygon: '#B026FF ',
  rinkeby: '##83EEFF',
  goerli: '#83EEFF',
  eth: '##83EEFF',
}

const rgbToHex = (rgb: number): string => {
  const hex = Number(rgb).toString(16)
  return hex.length === 1 ? `0${hex}` : hex
}

function networkRestruct(networkMap: any) {
  const keys = Object.keys(networkMap)

  // eslint-disable-next-line unicorn/no-array-reduce
  const out = keys.reduce(
    (prev: any, next: any) => {
      const chainId = networkMap[next].chain
      const holographId = networkMap[next].holographId

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
  const dataMap = networkRestruct(networks)
  return dataMap.byNetworkName[chainId]
}

function getChainId(holographId: any) {
  const dataMap = networkRestruct(networks)
  return dataMap.byHolographId[holographId]
}

function getHolographId(chainId: any) {
  const dataMap = networkRestruct(networks)
  return dataMap.byChainId[chainId]
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
}
