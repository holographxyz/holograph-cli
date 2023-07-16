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

export const rgbToHex = (rgb: number): string => {
  const hex = Number(rgb).toString(16)
  return hex.length === 1 ? `0${hex}` : hex
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
export const cleanRequest = (query: string): string => query.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ')

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

export function safeStringify(obj: any, indent = 2): string {
  let cache: any[] = []
  const retVal = JSON.stringify(
    obj,
    (key, value) =>
      typeof value === 'object' && value !== null
        ? cache.includes(value)
          ? undefined // Duplicate reference found, discard key
          : cache.push(value) && value // Store value in our collection
        : value,
    indent,
  )
  cache = null!
  return retVal
}

// Helper function to convert filename to date
export function filenameToDate(filename: string) {
  const dateString = filename.slice('contract-deployment-'.length, filename.length - '.json'.length)
  const formattedDate = dateString.slice(0, 13) + ':' + dateString.slice(14, 16) + ':' + dateString.slice(17)
  return new Date(formattedDate).getTime()
}
