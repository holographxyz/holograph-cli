/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import {keccak256} from '@ethersproject/keccak256'

/**
 * Adding padding to string on the left
 * @param value The value
 * @param chars The chars
 */
export const padLeft = (value: string, chars: number) => {
  const hasPrefix = /^0x/i.test(value) || typeof value === 'number'
  value = value.toString().replace(/^0x/i, '')

  const padding = chars - value.length + 1 >= 0 ? chars - value.length + 1 : 0

  return (hasPrefix ? '0x' : '') + new Array(padding).join('0') + value
}

/**
 * Convert bytes to hex
 * @param bytes The bytes
 */
export function bytesToHex(bytes: Uint8Array): string {
  const hex: string[] = []

  for (const byte of bytes) {
    hex.push((byte >>> 4).toString(16))
    hex.push((byte & 0xf).toString(16))
  }

  return `0x${hex.join('').replace(/^0+/, '')}`
}

/**
 * To byte array
 * @param value The value
 */
export function toByteArray(value: string | ArrayLike<number>): Uint8Array {
  if (value == null) {
    throw new Error('cannot convert null value to array')
  }

  if (typeof value === 'string') {
    const match = value.match(/^(0x)?[\dA-Fa-f]*$/)

    if (!match) {
      throw new Error('invalid hexidecimal string')
    }

    if (match[1] !== '0x') {
      throw new Error('hex string must have 0x prefix')
    }

    value = value.slice(2)
    if (value.length % 2) {
      value = '0' + value
    }

    const result = []
    for (let i = 0; i < value.length; i += 2) {
      result.push(Number.parseInt(value.substr(i, 2), 16))
    }

    return addSlice(new Uint8Array(result))
  }

  if (isByteArray(value)) {
    return addSlice(new Uint8Array(value))
  }

  throw new Error('invalid arrayify value')
}

/**
 * Is byte array
 * @param value The value
 */
function isByteArray(value: any): value is string | ArrayLike<number> {
  if (
    !value ||
    // tslint:disable-next-line: radix
    Number.parseInt(String(value.length)) != value.length ||
    typeof value === 'string'
  ) {
    return false
  }

  for (const v of value) {
    // tslint:disable-next-line: radix
    if (v < 0 || v >= 256 || Number.parseInt(String(v)) != v) {
      return false
    }
  }

  return true
}

/**
 * Add slice to array
 * @param array The array
 */
function addSlice(array: Uint8Array): Uint8Array {
  if (array.slice !== undefined) {
    return array
  }

  array.slice = () => {
    const args: any = Array.prototype.slice.call(arguments)
    return addSlice(new Uint8Array(Array.prototype.slice.apply(array, args)))
  }

  return array
}

/**
 * Returns true if the bloom is a valid bloom
 * @param bloom The bloom
 */
export function isBloom(bloom: string): boolean {
  if (typeof bloom !== 'string') {
    return false
  }

  if (!/^(0x)?[\da-f]{512}$/i.test(bloom)) {
    return false
  }

  if (/^(0x)?[\da-f]{512}$/.test(bloom) || /^(0x)?[\dA-F]{512}$/.test(bloom)) {
    return true
  }

  return false
}

/**
 * Returns true if the value is part of the given bloom
 * note: false positives are possible.
 * @param bloom encoded bloom
 * @param value The value
 */
export function isInBloom(bloom: string, value: string | Uint8Array): boolean {
  if (typeof value === 'object' && value.constructor === Uint8Array) {
    value = bytesToHex(value)
  }

  const hash = keccak256(value).replace('0x', '')

  for (let i = 0; i < 12; i += 4) {
    // calculate bit position in bloom filter that must be active
    const bitpos = ((Number.parseInt(hash.substr(i, 2), 16) << 8) + Number.parseInt(hash.substr(i + 2, 2), 16)) & 2047

    // test if bitpos in bloom is active
    const code = codePointToInt(bloom.charCodeAt(bloom.length - 1 - Math.floor(bitpos / 4)))
    const offset = 1 << bitpos % 4

    if ((code & offset) !== offset) {
      return false
    }
  }

  return true
}

/**
 * Code points to int
 * @param codePoint The code point
 */
function codePointToInt(codePoint: number): number {
  if (codePoint >= 48 && codePoint <= 57) {
    /* ['0'..'9'] -> [0..9] */
    return codePoint - 48
  }

  if (codePoint >= 65 && codePoint <= 70) {
    /* ['A'..'F'] -> [10..15] */
    return codePoint - 55
  }

  if (codePoint >= 97 && codePoint <= 102) {
    /* ['a'..'f'] -> [10..15] */
    return codePoint - 87
  }

  throw new Error('invalid bloom')
}

/**
 * Returns true if the ethereum users address is part of the given bloom.
 * note: false positives are possible.
 * @param bloom encoded bloom
 * @param address the address to test
 */
export function isUserEthereumAddressInBloom(bloom: string, ethereumAddress: string): boolean {
  if (!isBloom(bloom)) {
    throw new Error('Invalid bloom given')
  }

  if (!isAddress(ethereumAddress)) {
    throw new Error(`Invalid ethereum address given: "${ethereumAddress}"`)
  }

  // you have to pad the ethereum address to 32 bytes
  // else the bloom filter does not work
  // this is only if your matching the USERS
  // ethereum address. Contract address do not need this
  // hence why we have 2 methods
  // (0x is not in the 2nd parameter of padleft so 64 chars is fine)
  const address = padLeft(ethereumAddress, 64)

  return isInBloom(bloom, address)
}

/**
 * Returns true if the contract address is part of the given bloom.
 * note: false positives are possible.
 * @param bloom encoded bloom
 * @param contractAddress the contract address to test
 */
export function isContractAddressInBloom(bloom: string, contractAddress: string): boolean {
  if (!isBloom(bloom)) {
    throw new Error('Invalid bloom given')
  }

  if (!isAddress(contractAddress)) {
    throw new Error(`Invalid contract address given: "${contractAddress}"`)
  }

  return isInBloom(bloom, contractAddress)
}

/**
 * Returns true if the topic is part of the given bloom.
 * note: false positives are possible.
 * @param bloom encoded bloom
 * @param topic the topic encoded hex
 */
export function isTopicInBloom(bloom: string, topic: string): boolean {
  if (!isBloom(bloom)) {
    throw new Error('Invalid bloom given')
  }

  if (!isTopic(topic)) {
    throw new Error('Invalid topic')
  }

  return isInBloom(bloom, topic)
}

/**
 * Checks if its a valid topic
 * @param topic encoded hex topic
 */
export function isTopic(topic: string): boolean {
  if (typeof topic !== 'string') {
    return false
  }

  if (!/^(0x)?[\da-f]{64}$/i.test(topic)) {
    return false
  }

  if (/^(0x)?[\da-f]{64}$/.test(topic) || /^(0x)?[\dA-F]{64}$/.test(topic)) {
    return true
  }

  return false
}

/**
 * Is valid address
 * @param address The address
 */
export function isAddress(address: string): boolean {
  if (typeof address !== 'string') {
    return false
  }

  if (/^(0x)?[\dA-Fa-f]{40}$/.test(address)) {
    return true
  }

  if (/^XE\d{2}[\dA-Za-z]{30,31}$/.test(address)) {
    return true
  }

  return false
}
