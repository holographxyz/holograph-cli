import Web3 from 'web3'

import {BigNumber, BigNumberish} from '@ethersproject/bignumber'
import {formatUnits} from '@ethersproject/units'

export const web3 = new Web3()

export function randomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min
}

export function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1)
}

// eslint-disable-next-line no-promise-executor-return
export const sleep = (ms: number): Promise<unknown> => new Promise(resolve => setTimeout(resolve, ms))

export const getSecondsLeft = (timestamp: number): number => {
  return Math.round((timestamp - Date.now()) / 1000)
}

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

export const networkToChainId: Record<string, number> = {
  ethereum: 1,
  ethereumTestnetGoerli: 5,
  polygon: 89,
  polygonTestnet: 80_001,
  avalanche: 43_114,
  avalancheTestnet: 43_113,
  binanceSmartChain: 56,
  binanceSmartChainTestnet: 97,
}

export const NETWORK_COLORS: Record<string, string> = {
  localhost: '##83EEFF',
  localhost2: '#ff0000',
  avalancheTestnet: '#ff0000',
  avalanche: '#ff0000',
  binanceSmartChain: '#f0b90b',
  binanceSmartChainTestnet: '#f0b90b',
  polygonTestnet: '##B026FF ',
  polygon: '#B026FF ',
  ethereumTestnetGoerli: '#83EEFF',
  ethereum: '##83EEFF',
}

export const rgbToHex = (rgb: number): string => {
  const hex = Number(rgb).toString(16)
  return hex.length === 1 ? `0${hex}` : hex
}

export const zeroAddress: string = '0x' + '00'.repeat(20)

export function allEventsEnabled(): string {
  return '0x' + 'ff'.repeat(32)
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

export function randomASCII(bytes: number): string {
  let text = ''
  for (let i = 0; i < bytes; i++) {
    text += (32 + Math.floor(Math.random() * 94)).toString(16).padStart(2, '0')
  }

  return Buffer.from(text, 'hex').toString()
}

export function isStringAValidURL(s: string): boolean {
  const protocols = ['http:', 'https:', 'wss:']
  try {
    const result = new URL(s)
    return result.protocol ? protocols.includes(result.protocol) : false
  } catch {
    return false
  }
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

export const utf8ToBytes32 = (str: string): string => {
  return (
    '0x' +
    [...str]
      .map(c =>
        c.charCodeAt(0) < 128 ? c.charCodeAt(0).toString(16) : encodeURIComponent(c).replace(/%/g, '').toLowerCase(),
      )
      .join('')
      .padStart(64, '0')
  )
}

// turns multi-line query into single line and removes extra spaces
export const cleanRequest = (query: any) => query.replace(/\n+ /g, '').replace(/\s+ /g, ' ')

export function numericSort(a: number, b: number): number {
  return a - b
}

export function numberfy(arr: string[]): number[] {
  const numbers: number[] = []
  for (const a of arr) {
    numbers.push(Number.parseInt(a, 10))
  }

  return numbers
}

export async function retry<T = any>(
  fn: () => Promise<T>,
  retriesLeft = 3,
  interval = 1000,
  exponentialCooldown = false,
): Promise<T> {
  try {
    const result = await fn()
    return result
  } catch (error: any) {
    if (retriesLeft) {
      await sleep(interval)
      console.log(`Number of retries left for function ${fn.name}:  ${retriesLeft}`)
      return retry(fn, retriesLeft - 1, exponentialCooldown ? interval * 2 : interval, exponentialCooldown)
    }

    console.error(`Max retries reached for function ${fn.name}`)
    console.error(error)
    // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
    process.exit()
  }
}

export function generateHashedName(name: string): string {
  // eslint-disable-next-line unicorn/prefer-string-slice
  const asciiHex = web3.utils.asciiToHex(name).substring(2) // remove '0x' prefix
  const paddedHex = asciiHex.padStart(64, '0')
  return `0x${paddedHex}`
}
