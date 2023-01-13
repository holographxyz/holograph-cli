import * as fs from 'fs-extra'
import * as path from 'node:path'
import WebSocket from 'ws'

import {Command, Flags} from '@oclif/core'
import color from '@oclif/color'
import {Wallet} from '@ethersproject/wallet'
import {Contract, PopulatedTransaction} from '@ethersproject/contracts'
import {BigNumber} from '@ethersproject/bignumber'
import {formatUnits} from '@ethersproject/units'
import {keccak256} from '@ethersproject/keccak256'
import {Interface, EventFragment, defaultAbiCoder} from '@ethersproject/abi'
import {WebSocketProvider, JsonRpcProvider} from '@ethersproject/providers'
import {
  Block,
  BlockWithTransactions,
  TransactionReceipt,
  TransactionResponse,
  TransactionRequest,
} from '@ethersproject/abstract-provider'
import {Environment, getEnvironment} from '@holographxyz/environment'
import {supportedNetworks, supportedShortNetworks, networks, getNetworkByShortKey} from '@holographxyz/networks'

import {ConfigFile, ConfigNetwork, ConfigNetworks} from './config'
import {GasPricing, initializeGasPricing, updateGasPricing} from './gas'
import {capitalize, NETWORK_COLORS, zeroAddress} from './utils'
import {HOLOGRAPH_ADDRESSES} from './contracts'

export const repairFlag = {
  repair: Flags.integer({
    description: 'Start from block number specified',
    default: 0,
    char: 'r',
  }),
}

export const networksFlag = {
  networks: Flags.string({
    description: 'Space separated list of networks to use',
    options: [...supportedNetworks, ...supportedShortNetworks],
    required: false,
    multiple: true,
  }),
}

export const networkFlag = {
  network: Flags.string({
    description: 'Name of network to use',
    options: [...supportedNetworks, ...supportedShortNetworks],
    multiple: false,
    required: false,
  }),
}

export enum OperatorMode {
  listen = 'listen',
  manual = 'manual',
  auto = 'auto',
}

export enum ProviderStatus {
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
}

export type KeepAliveParams = {
  debug: (...args: any[]) => void
  websocket: WebSocket
  onDisconnect: (code: number, reason: any) => void
  expectedPongBack?: number
  checkInterval?: number
}

export type BlockJob = {
  network: string
  block: number
}

export enum FilterType {
  to,
  from,
  functionSig,
}

export enum TransactionType {
  unknown = 'unknown',
  erc20 = 'erc20',
  erc721 = 'erc721',
  deploy = 'deploy',
}

export type TransactionFilter = {
  type: FilterType
  match: string | {[key: string]: string}
  networkDependant: boolean
}

const TIMEOUT_THRESHOLD = 20_000

const ZERO = BigNumber.from('0')
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ONE = BigNumber.from('1')
const TWO = BigNumber.from('2')
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TEN = BigNumber.from('10')

const webSocketErrorCodes: {[key: number]: string} = {
  1000: 'Normal Closure',
  1001: 'Going Away',
  1002: 'Protocol Error',
  1003: 'Unsupported Data',
  1004: '(For future)',
  1005: 'No Status Received',
  1006: 'Abnormal Closure',
  1007: 'Invalid frame payload data',
  1008: 'Policy Violation',
  1009: 'Message too big',
  1010: 'Missing Extension',
  1011: 'Internal Error',
  1012: 'Service Restart',
  1013: 'Try Again Later',
  1014: 'Bad Gateway',
  1015: 'TLS Handshake',
}

interface ExtendedError extends Error {
  code: number
  reason: any
}

interface AbstractError extends Error {
  [key: string]: any
}

export const keepAlive = ({
  debug,
  websocket,
  onDisconnect,
  expectedPongBack = TIMEOUT_THRESHOLD,
  checkInterval = Math.round(TIMEOUT_THRESHOLD / 2),
}: KeepAliveParams): void => {
  let pingTimeout: NodeJS.Timeout | null = null
  let keepAliveInterval: NodeJS.Timeout | null = null
  let counter = 0
  let errorCounter = 0
  let terminator: NodeJS.Timeout | null = null
  const errHandler: (err: ExtendedError) => void = (err: ExtendedError) => {
    if (errorCounter === 0) {
      errorCounter++
      debug(`websocket error event triggered ${err.code} ${JSON.stringify(err.reason)}`)
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval)
      }

      if (pingTimeout) {
        clearTimeout(pingTimeout)
      }

      terminator = setTimeout(() => {
        websocket.terminate()
      }, checkInterval)
    }
  }

  websocket.on('ping', (data: any) => {
    websocket.pong(data)
  })

  websocket.on('redirect', (url: string, request: any) => {
    debug(
      JSON.stringify(
        {
          on: 'redirect',
          url,
          request,
        },
        undefined,
        2,
      ),
    )
  })

  websocket.on('unexpected-response', (request: any, response: any) => {
    debug(
      JSON.stringify(
        {
          on: 'unexpected-response',
          request,
          response,
        },
        undefined,
        2,
      ),
    )
  })

  websocket.on('open', () => {
    debug(`websocket open event triggered`)
    websocket.off('error', errHandler)
    if (terminator) {
      clearTimeout(terminator)
    }

    keepAliveInterval = setInterval(() => {
      websocket.ping()
      pingTimeout = setTimeout(() => {
        websocket.terminate()
      }, expectedPongBack)
    }, checkInterval)
  })

  websocket.on('close', (code: number, reason: any) => {
    debug(`websocket close event triggered`)
    if (counter === 0) {
      debug(`websocket closed`)
      counter++
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval)
      }

      if (pingTimeout) {
        clearTimeout(pingTimeout)
      }

      setTimeout(() => {
        onDisconnect(code, reason)
      }, checkInterval)
    }
  })

  websocket.on('error', errHandler)

  websocket.on('pong', () => {
    if (pingTimeout) {
      clearInterval(pingTimeout)
    }
  })
}

export type ExecuteTransactionParams = {
  network: string
  tags?: (string | number)[]
  contract: Contract
  methodName: string
  args: any[]
  gasPrice?: BigNumber
  gasLimit?: BigNumber | null
  value?: BigNumber
  attempts?: number
  canFail?: boolean
  interval?: number
  waitForReceipt?: boolean
}

export type SendTransactionParams = {
  network: string
  tags?: (string | number)[]
  rawTx: PopulatedTransaction
  attempts?: number
  canFail?: boolean
  interval?: number
}

export type PopulateTransactionParams = {
  network: string
  contract: Contract
  methodName: string
  args: any[]
  gasPrice: BigNumber
  gasLimit: BigNumber
  value: BigNumber
  nonce: number
  tags?: (string | number)[]
  attempts?: number
  canFail?: boolean
  interval?: number
}

export type GasLimitParams = {
  network: string
  tags?: (string | number)[]
  contract: Contract
  methodName: string
  args: any[]
  gasPrice?: BigNumber
  value?: BigNumber
  attempts?: number
  canFail?: boolean
  interval?: number
}

export type BlockParams = {
  network: string
  blockNumber: number
  tags?: (string | number)[]
  attempts?: number
  canFail?: boolean
  interval?: number
}

export type WalletParams = {
  network: string
  walletAddress: string
  tags?: (string | number)[]
  attempts?: number
  canFail?: boolean
  interval?: number
}

export type TransactionParams = {
  network: string
  transactionHash: string
  tags?: (string | number)[]
  attempts?: number
  canFail?: boolean
  interval?: number
}

const cleanTags = (tagIds?: string | number | (number | string)[]): string => {
  if (tagIds === undefined) {
    return ''
  }

  const tags: string[] = []
  if (typeof tagIds === 'string' || typeof tagIds === 'number') {
    tags.push(tagIds.toString())
  } else {
    if (tagIds.length === 0) {
      return ''
    }

    for (const tag of tagIds) {
      tags.push(tag.toString())
    }
  }

  return ' [' + tags.join('] [') + ']'
}

type ImplementsCommand = Command

type NetworkMonitorOptions = {
  parent: ImplementsCommand
  configFile: ConfigFile
  networks?: string[]
  debug: (...args: string[]) => void
  processTransactions?: (job: BlockJob, transactions: TransactionResponse[]) => Promise<void>
  filters?: TransactionFilter[]
  userWallet?: Wallet
  lastBlockFilename?: string
  repair?: number
  verbose?: boolean
}

export class NetworkMonitor {
  verbose = true
  environment: Environment
  parent: ImplementsCommand
  configFile: ConfigFile
  userWallet?: Wallet
  LAST_BLOCKS_FILE_NAME: string
  filters: TransactionFilter[] = []
  processTransactions: ((job: BlockJob, transactions: TransactionResponse[]) => Promise<void>) | undefined
  log: (message: string, ...args: any[]) => void
  warn: (message: string, ...args: any[]) => void
  debug: (...args: any[]) => void
  networks: string[] = []
  runningProcesses = 0
  bridgeAddress!: string
  factoryAddress!: string
  interfacesAddress!: string
  operatorAddress!: string
  registryAddress!: string
  tokenAddress!: string
  cxipERC721Address!: string
  messagingModuleAddress!: string
  wallets: {[key: string]: Wallet} = {}
  walletNonces: {[key: string]: number} = {}
  providers: {[key: string]: JsonRpcProvider | WebSocketProvider} = {}
  ws: {[key: string]: WebSocket} = {}
  activated: {[key: string]: boolean} = {}
  abiCoder = defaultAbiCoder
  networkColors: any = {}
  latestBlockHeight: {[key: string]: number} = {}
  currentBlockHeight: {[key: string]: number} = {}
  blockJobs: {[key: string]: BlockJob[]} = {}
  exited = false
  lastProcessBlockDone: {[key: string]: number} = {}
  lastBlockJobDone: {[key: string]: number} = {}
  blockJobMonitorProcess: {[key: string]: NodeJS.Timer} = {}
  gasPrices: {[key: string]: GasPricing} = {}
  holograph!: Contract
  holographer!: Contract
  bridgeContract!: Contract
  factoryContract!: Contract
  interfacesContract!: Contract
  operatorContract!: Contract
  registryContract!: Contract
  cxipERC721Contract!: Contract
  messagingModuleContract!: Contract
  HOLOGRAPH_ADDRESSES = HOLOGRAPH_ADDRESSES

  // this is specifically for handling localhost-based CLI usage with holograph-protocol package
  localhostWallets: {[key: string]: Wallet} = {}
  static localhostPrivateKey = '0x13f46463f9079380515b26f04e42069760b34989cc23c5f082e7d3ed3757bb4a'
  lzEndpointAddress: {[key: string]: string} = {}
  lzEndpointContract: {[key: string]: Contract} = {}

  LAYERZERO_RECEIVERS: {[key: string]: string} = {
    localhost: '0x830e22aa238b6aeD78087FaCea8Bb95c6b7A7E2a'.toLowerCase(),
    localhost2: '0x830e22aa238b6aeD78087FaCea8Bb95c6b7A7E2a'.toLowerCase(),
    ethereumTestnetGoerli: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
    polygonTestnet: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
    avalancheTestnet: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),

    ethereum: '0xe93685f3bba03016f02bd1828badd6195988d950'.toLowerCase(),
    polygon: '0xe93685f3bba03016f02bd1828badd6195988d950'.toLowerCase(),
    avalanche: '0xe93685f3bba03016f02bd1828badd6195988d950'.toLowerCase(),
  }

  needToSubscribe = false
  repair = 0

  targetEvents: Record<string, string> = {
    AvailableJob: '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11',
    '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11': 'AvailableJob',

    AvailableOperatorJob: '0x4422a85db963f113e500bc4ada8f9e9f1a7bcd57cbec6907fbb2bf6aaf5878ff',
    '0x4422a85db963f113e500bc4ada8f9e9f1a7bcd57cbec6907fbb2bf6aaf5878ff': 'AvailableOperatorJob',

    FinishedOperatorJob: '0xfc3963369d694e97f35e33cc03fcd382bfa4dbb688ae43d318fcf344f479425e',
    '0xfc3963369d694e97f35e33cc03fcd382bfa4dbb688ae43d318fcf344f479425e': 'FinishedOperatorJob',

    FailedOperatorJob: '0x26dc03e6c4feb5e9d33804dc1646860c976c3aeabb458f4719c53dcbadbf44b5',
    '0x26dc03e6c4feb5e9d33804dc1646860c976c3aeabb458f4719c53dcbadbf44b5': 'FailedOperatorJob',

    BridgeableContractDeployed: '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b',
    '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b': 'BridgeableContractDeployed',

    CrossChainMessageSent: '0x0f5759b4182507dcfc771071166f98d7ca331262e5134eaa74b676adce2138b7',
    '0x0f5759b4182507dcfc771071166f98d7ca331262e5134eaa74b676adce2138b7': 'CrossChainMessageSent',

    LzEvent: '0x138bae39f5887c9423d9c61fbf2cba537d68671ee69f2008423dbc28c8c41663',
    '0x138bae39f5887c9423d9c61fbf2cba537d68671ee69f2008423dbc28c8c41663': 'LzEvent',

    LzPacket: '0xe9bded5f24a4168e4f3bf44e00298c993b22376aad8c58c7dda9718a54cbea82',
    '0xe9bded5f24a4168e4f3bf44e00298c993b22376aad8c58c7dda9718a54cbea82': 'LzPacket',

    Packet: '0xe8d23d927749ec8e512eb885679c2977d57068839d8cca1a85685dbbea0648f6',
    '0xe8d23d927749ec8e512eb885679c2977d57068839d8cca1a85685dbbea0648f6': 'Packet',

    Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': 'Transfer',
  }

  getProviderStatus(): {[key: string]: ProviderStatus} {
    const output: {[key: string]: ProviderStatus} = {}

    for (const network of supportedNetworks) {
      if (
        !(network in this.configFile.networks) ||
        !('providerUrl' in this.configFile.networks[network]) ||
        this.configFile.networks[network].providerUrl === undefined ||
        this.configFile.networks[network].providerUrl === ''
      ) {
        output[network] = ProviderStatus.NOT_CONFIGURED
      } else {
        output[network] = this.providers[network] === undefined ? ProviderStatus.DISCONNECTED : ProviderStatus.CONNECTED
        // check if using a WebSocketProvider connection
        if (output[network] === ProviderStatus.CONNECTED && network in this.ws) {
          // using WebSocketProvider, do a more thorough test
          output[network] =
            this.ws[network].readyState === WebSocket.OPEN ? ProviderStatus.CONNECTED : ProviderStatus.DISCONNECTED
        }
      }
    }

    return output
  }

  checkConnectionStatus(): void {
    for (const network of this.networks) {
      if (!this.activated[network]) {
        this.structuredLogError(network, 'Cannot start RPC provider')
        // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
        process.exit()
      }
    }
  }

  constructor(options: NetworkMonitorOptions) {
    this.environment = getEnvironment()
    this.parent = options.parent
    this.configFile = options.configFile
    this.LAST_BLOCKS_FILE_NAME = options.lastBlockFilename || 'blocks.json'
    this.log = this.parent.log.bind(this.parent)
    this.warn = this.parent.warn.bind(this.parent)
    this.debug = options.debug.bind(this.parent)
    if (options.filters !== undefined) {
      this.filters = options.filters
    }

    if (options.verbose !== undefined) {
      this.verbose = options.verbose
    }

    if (options.processTransactions !== undefined) {
      this.processTransactions = options.processTransactions.bind(this.parent)
    }

    if (options.userWallet !== undefined) {
      this.userWallet = options.userWallet
    }

    if (options.repair !== undefined && options.repair > 0) {
      this.repair = options.repair
    }

    if (options.networks === undefined || '') {
      options.networks = Object.keys(this.configFile.networks)
    }

    options.networks = options.networks.filter((network: string) => {
      if (network === '') {
        return false
      }

      if (supportedNetworks.includes(network)) {
        return true
      }

      if (supportedShortNetworks.includes(network)) {
        return true
      }

      return false
    })

    // Popluate the networks array with the full network name
    for (let i = 0, l = options.networks.length; i < l; i++) {
      if (supportedShortNetworks.includes(options.networks[i])) {
        options.networks[i] = getNetworkByShortKey(options.networks[i]).key
      }

      const network = options.networks[i]
      this.blockJobs[network] = []
    }

    this.networks = [...new Set(options.networks)]

    // Repair can only be used with a single network at a time since the block number provided to the repair flag is global
    // This can be updated in the future to support multiple networks with different block numbers simple logic is preferred for now
    if (this.repair > 0 && this.networks.length > 1) {
      this.log(
        'Repair mode is not supported for multiple networks. Please use a single network with desired repair block height',
      )
      this.exitRouter({exit: true}, 'SIGINT')
    }

    // Color the networks 🌈
    for (let i = 0, l = this.networks.length; i < l; i++) {
      const network = this.networks[i]
      this.networkColors[network] = color.hex(NETWORK_COLORS[network])
    }
  }

  async run(
    continuous: boolean,
    blockJobs?: {[key: string]: BlockJob[]},
    ethersInitializedCallback?: () => Promise<void>,
  ): Promise<void> {
    // check connections in 60 seconds, if something failed, kill the process
    setTimeout(this.checkConnectionStatus.bind(this), 60_000)
    await this.initializeEthers()
    if (ethersInitializedCallback !== undefined) {
      await ethersInitializedCallback.bind(this.parent)()
    }

    if (this.verbose) {
      this.log(``)
      this.log(`📄 Holograph address: ${this.HOLOGRAPH_ADDRESSES[this.environment]}`)
      this.log(`📄 Bridge address: ${this.bridgeAddress}`)
      this.log(`📄 Factory address: ${this.factoryAddress}`)
      this.log(`📄 Interfaces address: ${this.interfacesAddress}`)
      this.log(`📄 Operator address: ${this.operatorAddress}`)
      this.log(`📄 Registry address: ${this.registryAddress}`)
      this.log(`📄 Token address: ${this.tokenAddress}`)
      this.log(`📄 CXIP ERC721 address: ${this.cxipERC721Address}`)
      this.log(`📄 Messaging Module address: ${this.messagingModuleAddress}`)
      this.log(``)
    }

    if (blockJobs !== undefined) {
      this.blockJobs = blockJobs
    }

    for (const network of this.networks) {
      if (!(network in this.blockJobs)) {
        this.blockJobs[network] = []
      }

      this.lastBlockJobDone[network] = Date.now()
      this.lastProcessBlockDone[network] = Date.now()
      this.runningProcesses += 1
      if (continuous) {
        this.needToSubscribe = true
      }

      // Subscribe to events 🎧
      this.networkSubscribe(network)

      // Process blocks 🧱
      this.blockJobHandler(network)
      // Activate Job Monitor for disconnect recovery after 10 seconds / Monitor every second
      setTimeout((): void => {
        this.blockJobMonitorProcess[network] = setInterval(this.monitorBuilder.bind(this)(network), 1000)
      }, 10_000)
    }

    // Catch all exit events
    for (const eventType of [`EEXIT`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `uncaughtException`, `SIGTERM`]) {
      process.on(eventType, this.exitRouter.bind(this, {exit: true}))
    }

    process.on('exit', this.exitHandler)
  }

  async loadLastBlocks(configDir: string): Promise<{[key: string]: number}> {
    const filePath = path.join(configDir, this.environment + '.' + this.LAST_BLOCKS_FILE_NAME)
    let lastBlocks: {[key: string]: number} = {}
    if (await fs.pathExists(filePath)) {
      lastBlocks = await fs.readJson(filePath)
    }

    return lastBlocks
  }

  saveLastBlocks(configDir: string, lastBlocks: {[key: string]: number}): void {
    const filePath = path.join(configDir, this.environment + '.' + this.LAST_BLOCKS_FILE_NAME)
    fs.writeFileSync(filePath, JSON.stringify(lastBlocks), 'utf8')
  }

  disconnectBuilder(network: string, rpcEndpoint: string, subscribe: boolean): (code: number, reason: any) => void {
    return (code: number, reason: any): void => {
      const restart = () => {
        this.structuredLog(
          network,
          `Error in websocket connection, restarting... ${webSocketErrorCodes[code]} ${JSON.stringify(reason)}`,
        )
        this.lastBlockJobDone[network] = Date.now()
        this.walletNonces[network] = -1
        this.failoverWebSocketProvider(network, rpcEndpoint, subscribe)
      }

      this.structuredLog(network, `Websocket is closed. Restarting connection for ${networks[network].name}`)
      // terminate the existing websocket
      this.ws[network].terminate()
      restart()
    }
  }

  failoverWebSocketProvider(network: string, rpcEndpoint: string, subscribe: boolean): void {
    this.log('this.providers', networks[network].name)
    this.ws[network] = new WebSocket(rpcEndpoint)
    keepAlive({
      debug: this.debug,
      websocket: this.ws[network],
      onDisconnect: this.disconnectBuilder.bind(this)(network, rpcEndpoint, true),
    })
    this.providers[network] = new WebSocketProvider(this.ws[network])
    if (this.userWallet !== undefined) {
      this.wallets[network] = this.userWallet.connect(this.providers[network])
    }

    if (subscribe && this.needToSubscribe) {
      this.networkSubscribe(network)
    }
  }

  async initializeEthers(): Promise<void> {
    for (const network of this.networks) {
      const rpcEndpoint = (this.configFile.networks[network as keyof ConfigNetworks] as ConfigNetwork).providerUrl
      const protocol = new URL(rpcEndpoint).protocol
      switch (protocol) {
        case 'https:':
          this.providers[network] = new JsonRpcProvider(rpcEndpoint)

          break
        case 'http:':
          this.providers[network] = new JsonRpcProvider(rpcEndpoint)

          break
        case 'wss:':
          this.failoverWebSocketProvider.bind(this)(network, rpcEndpoint, true)
          break
        default:
          throw new Error('Unsupported RPC provider protocol -> ' + protocol)
      }

      this.walletNonces[network] = -1
      if (this.userWallet !== undefined) {
        this.wallets[network] = this.userWallet.connect(this.providers[network])
        this.walletNonces[network] = await this.getNonce({
          network,
          walletAddress: await this.wallets[network].getAddress(),
          canFail: false,
        })
      }

      if (this.repair > 0) {
        this.structuredLog(network, color.red(`🚧 REPAIR MODE ACTIVATED 🚧`))
        const currentBlock = await this.providers[network].getBlockNumber()
        if (this.verbose) {
          this.structuredLog(network, `Current block height [${color.green(currentBlock)}]`)
          this.structuredLog(
            network,
            `Starting Network Monitor in repair mode from ${color.yellow(
              currentBlock - this.repair,
            )} blocks back at block [${color.red(this.repair)}]`,
          )
        }

        this.latestBlockHeight[network] = this.repair
        this.blockJobs[network] = []
        for (let n = this.repair; n <= currentBlock; n++) {
          this.blockJobs[network].push({
            network,
            block: n,
          })
        }
      } else if (network in this.latestBlockHeight && this.latestBlockHeight[network] > 0) {
        if (this.verbose) {
          this.structuredLog(network, `Resuming Network Monitor from block height ${this.latestBlockHeight[network]}`)
        }

        this.currentBlockHeight[network] = this.latestBlockHeight[network]
      } else {
        if (this.verbose) {
          this.structuredLog(network, `Starting Network Monitor from latest block height`)
        }

        this.latestBlockHeight[network] = 0
        this.currentBlockHeight[network] = 0
      }

      this.gasPrices[network] = await initializeGasPricing(network, this.providers[network])
      this.activated[network] = true
    }

    const holographABI = await fs.readJson(path.join(__dirname, `../abi/${this.environment}/Holograph.json`))
    this.holograph = new Contract(
      this.HOLOGRAPH_ADDRESSES[this.environment],
      holographABI,
      this.providers[this.networks[0]],
    )

    const holographerABI = await fs.readJson(path.join(__dirname, `../abi/${this.environment}/Holographer.json`))
    this.holographer = new Contract(zeroAddress, holographerABI, this.providers[this.networks[0]])

    this.bridgeAddress = (await this.holograph.getBridge()).toLowerCase()
    this.factoryAddress = (await this.holograph.getFactory()).toLowerCase()
    this.interfacesAddress = (await this.holograph.getInterfaces()).toLowerCase()
    this.operatorAddress = (await this.holograph.getOperator()).toLowerCase()
    this.registryAddress = (await this.holograph.getRegistry()).toLowerCase()

    // TODO: remove this once we have a way to get the address from the holograph contract?
    // this.cxipERC721Address = (await this.holograph.getCxipERC721()).toLowerCase()
    // this.cxipERC721Address = CXIP_ERC721_ADDRESSES[this.environment]
    // const CxipERC721ABI = await fs.readJson(path.join(__dirname, `../abi/${this.environment}/CxipERC721.json`))
    // this.cxipERC721Contract = new Contract(this.cxipERC721Address, CxipERC721ABI, this.providers[this.networks[0]])

    // NOTE: I don't think we can use the hardcoded cxipERC721Address in the example above and will instead need to look up the collection contract
    // address from the holograph contract in a way like this:
    // let cxipErc721Address = await holographRegistry.getHolographedHashAddress(cxipErc721Config.erc721ConfigHash);

    const holographBridgeABI = await fs.readJson(
      path.join(__dirname, `../abi/${this.environment}/HolographBridge.json`),
    )
    this.bridgeContract = new Contract(this.bridgeAddress, holographBridgeABI, this.providers[this.networks[0]])

    const holographFactoryABI = await fs.readJson(
      path.join(__dirname, `../abi/${this.environment}/HolographFactory.json`),
    )
    this.factoryContract = new Contract(this.factoryAddress, holographFactoryABI, this.providers[this.networks[0]])

    const holographInterfacesABI = await fs.readJson(
      path.join(__dirname, `../abi/${this.environment}/HolographInterfaces.json`),
    )
    this.interfacesContract = new Contract(
      this.interfacesAddress,
      holographInterfacesABI,
      this.providers[this.networks[0]],
    )

    const holographOperatorABI = await fs.readJson(
      path.join(__dirname, `../abi/${this.environment}/HolographOperator.json`),
    )
    this.operatorContract = new Contract(this.operatorAddress, holographOperatorABI, this.providers[this.networks[0]])

    this.messagingModuleAddress = (await this.operatorContract.getMessagingModule()).toLowerCase()

    const holographRegistryABI = await fs.readJson(
      path.join(__dirname, `../abi/${this.environment}/HolographRegistry.json`),
    )
    this.registryContract = new Contract(this.registryAddress, holographRegistryABI, this.providers[this.networks[0]])

    const holographMessagingModuleABI = await fs.readJson(
      path.join(__dirname, `../abi/${this.environment}/LayerZeroModule.json`),
    )
    this.messagingModuleContract = new Contract(
      this.messagingModuleAddress,
      holographMessagingModuleABI,
      this.providers[this.networks[0]],
    )

    for (const network of this.networks) {
      if (this.environment === Environment.localhost) {
        this.localhostWallets[network] = new Wallet(NetworkMonitor.localhostPrivateKey).connect(this.providers[network])
        // since sample localhost deployer key is used, nonce is out of sync
        this.lzEndpointAddress[network] = (
          await this.messagingModuleContract.connect(this.providers[network]).getLZEndpoint()
        ).toLowerCase()
        const lzEndpointABI = await fs.readJson(path.join(__dirname, `../abi/${this.environment}/MockLZEndpoint.json`))
        this.lzEndpointContract[network] = new Contract(
          this.lzEndpointAddress[network],
          lzEndpointABI,
          this.localhostWallets[network],
        )
      }
    }
  }

  exitCallback?: () => void

  exitHandler = async (exitCode: number): Promise<void> => {
    /**
     * Before exit, save the block heights to the local db
     */
    if (this.exited === false) {
      this.log('')
      if (this.needToSubscribe) {
        this.log(`\n💾 Saving current block heights:\n${JSON.stringify(this.latestBlockHeight, undefined, 2)}\n`)
        this.saveLastBlocks(this.parent.config.configDir, this.latestBlockHeight)
      }

      this.log(`🛑 Exiting ${this.parent.constructor.name} with code ${color.keyword('red')(exitCode)}`)
      this.log(`\n👋 Thank you, come again\n`)
      this.exited = true
    }
  }

  exitRouter = (options: {[key: string]: boolean | string | number}, exitCode: number | string): void => {
    /**
     * Before exit, save the block heights to the local db
     */
    if ((exitCode && exitCode === 0) || exitCode === 'SIGINT' || exitCode === 'SIGTERM') {
      if (this.exited === false) {
        this.log('')
        if (this.needToSubscribe) {
          this.log(`\n💾 Saving current block heights:\n${JSON.stringify(this.latestBlockHeight, undefined, 2)}\n`)
          this.saveLastBlocks(this.parent.config.configDir, this.latestBlockHeight)
        }

        this.log(`🛑 Exiting ${this.parent.constructor.name} with code ${color.keyword('red')(exitCode)}`)
        this.log(`\n👋 Thank you, come again\n`)
        this.exited = true
      }

      this.debug(`\nExit code ${exitCode}`)
      if (options.exit) {
        if (this.exitCallback !== undefined) {
          this.exitCallback()
        }

        // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
        process.exit()
      }
    } else {
      this.debug('exitRouter triggered')
      this.debug(`\nError: ${exitCode}`)
    }
  }

  monitorBuilder: (network: string) => () => void = (network: string): (() => void) => {
    return () => {
      this.blockJobMonitor.bind(this)(network)
    }
  }

  restartProvider = async (network: string): Promise<void> => {
    const rpcEndpoint = (this.configFile.networks[network as keyof ConfigNetworks] as ConfigNetwork).providerUrl
    const protocol = new URL(rpcEndpoint).protocol
    switch (protocol) {
      case 'http:':
        this.providers[network] = new JsonRpcProvider(rpcEndpoint)

        break
      case 'https:':
        this.providers[network] = new JsonRpcProvider(rpcEndpoint)

        break
      case 'wss:':
        this.ws[network].close(1012, 'Block Job Handler has been inactive longer than threshold time.')
        //  this.failoverWebSocketProvider.bind(this)(network, rpcEndpoint, false)
        break
      default:
        throw new Error('Unsupported RPC provider protocol -> ' + protocol)
    }

    if (this.userWallet !== undefined) {
      this.wallets[network] = this.userWallet.connect(this.providers[network])
      this.walletNonces[network] = await this.getNonce({
        network,
        walletAddress: await this.wallets[network].getAddress(),
        canFail: false,
      })
    }

    // apply this logic to catch a potential processBlock failing and being dropped during a provider restart cycle
    // allow for up to 3 provider restarts to occur before triggering this
    if (Date.now() - this.lastProcessBlockDone[network] > TIMEOUT_THRESHOLD * 3) {
      this.blockJobHandler(network)
    }
  }

  blockJobMonitor = (network: string): Promise<void> => {
    return new Promise<void>(() => {
      if (Date.now() - this.lastBlockJobDone[network] > TIMEOUT_THRESHOLD) {
        this.structuredLog(
          network,
          color.yellow('Block Job Handler has been inactive longer than threshold time. Restarting.'),
          [],
        )
        this.lastBlockJobDone[network] = Date.now()
        this.restartProvider(network)
      }
    })
  }

  jobHandlerBuilder: (network: string) => () => void = (network: string): (() => void) => {
    return () => {
      this.blockJobHandler(network)
    }
  }

  blockJobHandler = (network: string, job?: BlockJob): void => {
    if (job !== undefined) {
      this.latestBlockHeight[job.network] = job.block
      if (this.verbose) {
        this.structuredLog(job.network, `Block procesing complete ✅`, job.block)
      }

      this.blockJobs[job.network].shift()
    }

    this.lastBlockJobDone[network] = Date.now()
    this.lastProcessBlockDone[network] = Date.now()
    if (this.blockJobs[network].length > 0) {
      const blockJob: BlockJob = this.blockJobs[network][0] as BlockJob
      this.processBlock(blockJob)
    } else if (this.needToSubscribe) {
      setTimeout(this.jobHandlerBuilder.bind(this)(network), 1000)
    } else {
      if (network in this.blockJobMonitorProcess) {
        this.structuredLog(network, 'All jobs done for network')
        clearInterval(this.blockJobMonitorProcess[network])
        delete this.blockJobMonitorProcess[network]
        this.runningProcesses -= 1
      }

      if (this.runningProcesses === 0) {
        this.log('Finished the last job. Exiting...')
        this.exitRouter({exit: true}, 'SIGINT')
      }
    }
  }

  filterTransaction(
    job: BlockJob,
    transaction: TransactionResponse,
    interestingTransactions: TransactionResponse[],
  ): void {
    const to: string = transaction.to?.toLowerCase() || ''
    const from: string = transaction.from?.toLowerCase() || ''
    let data: string
    for (const filter of this.filters) {
      const match: string = filter.networkDependant
        ? (filter.match as {[key: string]: string})[job.network]
        : (filter.match as string)
      switch (filter.type) {
        case FilterType.to:
          if (to === match) {
            interestingTransactions.push(transaction)
          }

          break
        case FilterType.from:
          if (from === match) {
            interestingTransactions.push(transaction)
          }

          break
        case FilterType.functionSig:
          data = transaction.data?.slice(0, 10) || ''
          if (data === match) {
            interestingTransactions.push(transaction)
          }

          break
        default:
          break
      }
    }
  }

  extractGasData(network: string, block: Block | BlockWithTransactions, tx: TransactionResponse): void {
    if (this.gasPrices[network].isEip1559) {
      // set current tx priority fee
      let priorityFee: BigNumber = ZERO
      let remainder: BigNumber
      if (tx.maxFeePerGas === undefined || tx.maxPriorityFeePerGas === undefined) {
        // we have a legacy transaction here, so need to calculate priority fee out
        priorityFee = tx.gasPrice!.sub(block.baseFeePerGas!)
      } else {
        // we have EIP-1559 transaction here, get priority fee
        // check first that base block fee is less than maxFeePerGas
        remainder = tx.maxFeePerGas!.sub(block.baseFeePerGas!)
        priorityFee = remainder.gt(tx.maxPriorityFeePerGas!) ? tx.maxPriorityFeePerGas! : remainder
      }

      if (this.gasPrices[network].nextPriorityFee === null) {
        this.gasPrices[network].nextPriorityFee = priorityFee
      } else {
        this.gasPrices[network].nextPriorityFee = this.gasPrices[network].nextPriorityFee!.add(priorityFee).div(TWO)
      }
    }
    // for legacy networks, get average gasPrice
    else if (this.gasPrices[network].gasPrice === null) {
      this.gasPrices[network].gasPrice = tx.gasPrice!
    } else {
      this.gasPrices[network].gasPrice = this.gasPrices[network].gasPrice!.add(tx.gasPrice!).div(TWO)
    }
  }

  async processBlock(job: BlockJob): Promise<void> {
    this.activated[job.network] = true
    if (this.verbose) {
      this.structuredLog(job.network, `Getting block 🔍`, job.block)
    }

    const block: BlockWithTransactions | null = await this.getBlockWithTransactions({
      network: job.network,
      blockNumber: job.block,
      attempts: 10,
      canFail: true,
    })
    if (block !== undefined && block !== null && 'transactions' in block) {
      const recentBlock = this.currentBlockHeight[job.network] - job.block < 5
      if (this.verbose) {
        this.structuredLog(job.network, `Block retrieved 📥`, job.block)
        /*
        Temporarily disabled
        this.structuredLog(job.network, `Calculating block gas`, job.block)
        if (this.gasPrices[job.network].isEip1559) {
          this.structuredLog(
            job.network,
            `Calculated block gas price was ${formatUnits(
              this.gasPrices[job.network].nextBlockFee!,
              'gwei',
            )} GWEI, and actual block gas price is ${formatUnits(block.baseFeePerGas!, 'gwei')} GWEI`,
            job.block,
          )
        }
        */
      }

      if (recentBlock) {
        this.gasPrices[job.network] = updateGasPricing(job.network, block, this.gasPrices[job.network])
      }

      // const priorityFees: BigNumber = this.gasPrices[job.network].nextPriorityFee!
      if (this.verbose && block.transactions.length === 0) {
        this.structuredLog(job.network, `Zero transactions in block`, job.block)
      }

      const interestingTransactions: TransactionResponse[] = []
      for (let i = 0, l = block.transactions.length; i < l; i++) {
        if (recentBlock) {
          this.extractGasData(job.network, block, block.transactions[i])
        }

        this.filterTransaction(job, block.transactions[i], interestingTransactions)
      }

      if (recentBlock) {
        this.gasPrices[job.network] = updateGasPricing(job.network, block, this.gasPrices[job.network])
      }

      /* Temporarily disabled
      if (this.verbose && this.gasPrices[job.network].isEip1559 && priorityFees !== null) {
        this.structuredLog(
          job.network,
          `Calculated block priority fees was ${formatUnits(
            priorityFees,
            'gwei',
          )} GWEI, and actual block priority fees is ${formatUnits(
            this.gasPrices[job.network].nextPriorityFee!,
            'gwei',
          )} GWEI`,
          job.block,
        )
      }
      */

      if (interestingTransactions.length > 0) {
        if (this.verbose) {
          this.structuredLog(job.network, `Found ${interestingTransactions.length} interesting transactions`, job.block)
        }

        if (this.processTransactions !== undefined) {
          await this.processTransactions?.bind(this.parent)(job, interestingTransactions)
        }

        this.blockJobHandler(job.network, job)
      } else {
        this.blockJobHandler(job.network, job)
      }
    } else {
      if (this.verbose) {
        this.structuredLog(job.network, `${color.red('Dropped block')}`, job.block)
      }

      this.blockJobHandler(job.network)
    }
  }

  networkSubscribe(network: string): void {
    this.providers[network].on('block', (blockNumber: string) => {
      const block = Number.parseInt(blockNumber, 10)
      if (this.currentBlockHeight[network] !== 0 && block - this.currentBlockHeight[network] > 1) {
        if (this.verbose) {
          this.structuredLog(network, `Resuming previously dropped connection, gotta do some catching up`)
        }

        let latest = this.currentBlockHeight[network]
        // If the current network's block number is ahead of the network monitor's latest block, add the blocks to the queue
        while (block - latest > 0) {
          if (this.verbose) {
            this.structuredLog(network, `Block (Syncing)`, latest)
          }

          this.blockJobs[network].push({
            network: network,
            block: latest,
          })
          latest++
        }
      }

      this.currentBlockHeight[network] = block
      if (this.verbose) {
        this.structuredLog(network, color.green(`A new block has been mined. New block height is [${block}] ⛏`))
      }

      this.blockJobs[network].push({
        network: network,
        block: block,
      } as BlockJob)
    })
  }

  structuredLog(network: string, msg: string, tagId?: string | number | (number | string)[]): void {
    const timestamp = new Date(Date.now()).toISOString()
    const timestampColor = color.keyword('green')
    this.log(
      `[${timestampColor(timestamp)}] [${this.parent.constructor.name}] [${this.networkColors[network](
        capitalize(networks[network].name),
      )}]${cleanTags(tagId)} ${msg}`,
    )
  }

  structuredLogError(
    network: string,
    error: string | Error | AbstractError,
    tagId?: string | number | (number | string)[],
  ): void {
    let errorMessage = `unknown error message`
    if (typeof error === 'string') {
      errorMessage = error
    } else if ('message' in error) {
      errorMessage = `${error.message}`
    } else if ('reason' in error) {
      errorMessage = `${(error as AbstractError).reason}`
    } else if ('error' in error && 'reason' in (error as AbstractError).error) {
      errorMessage = `${((error as AbstractError).error as AbstractError).reason}`
    }

    const timestamp = new Date(Date.now()).toISOString()
    const timestampColor = color.keyword('green')
    const errorColor = color.keyword('red')

    this.warn(
      `[${timestampColor(timestamp)}] [${this.parent.constructor.name}] [${this.networkColors[network](
        capitalize(networks[network].name),
      )}] [${errorColor('error')}]${cleanTags(tagId)} ${errorMessage}`,
    )
  }

  static iface: Interface = new Interface([])
  static packetEventFragment: EventFragment = EventFragment.from('Packet(uint16 chainId, bytes payload)')

  static lzPacketEventFragment: EventFragment = EventFragment.from('Packet(bytes payload)')

  static lzEventFragment: EventFragment = EventFragment.from(
    'LzEvent(uint16 _dstChainId, bytes _destination, bytes _payload)',
  )

  static erc20TransferEventFragment: EventFragment = EventFragment.from(
    'Transfer(address indexed _from, address indexed _to, uint256 _value)',
  )

  static erc721TransferEventFragment: EventFragment = EventFragment.from(
    'Transfer(address indexed _from, address indexed _to, uint256 indexed _tokenId)',
  )

  static availableJobEventFragment: EventFragment = EventFragment.from('AvailableJob(bytes payload)')

  static bridgeableContractDeployedEventFragment: EventFragment = EventFragment.from(
    'BridgeableContractDeployed(address indexed contractAddress, bytes32 indexed hash)',
  )

  static availableOperatorJobEventFragment: EventFragment = EventFragment.from(
    'AvailableOperatorJob(bytes32 jobHash, bytes payload)',
  )

  static crossChainMessageSentEventFragment: EventFragment = EventFragment.from(
    'CrossChainMessageSent(bytes32 messageHash)',
  )

  static finishedOperatorJobEventFragment: EventFragment = EventFragment.from(
    'FinishedOperatorJob(bytes32 jobHash, address operator)',
  )

  static failedOperatorJobEventFragment: EventFragment = EventFragment.from('FailedOperatorJob(bytes32 jobHash)')

  decodePacketEvent(receipt: TransactionReceipt, target?: string): string | undefined {
    if (target !== undefined) {
      target = target.toLowerCase().trim()
    }

    const toFind = this.operatorAddress.slice(2, 42)
    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (
          log.topics[0] === this.targetEvents.Packet &&
          (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
        ) {
          const packetPayload = NetworkMonitor.iface.decodeEventLog(
            NetworkMonitor.packetEventFragment,
            log.data,
            log.topics,
          )[1] as string
          if (packetPayload.indexOf(toFind) > 0) {
            let index: number = packetPayload.indexOf(toFind)
            // address + address
            index += 40 + 40
            return ('0x' + packetPayload.slice(Math.max(0, index))).toLowerCase()
          }
        }
      }
    }

    return undefined
  }

  decodeLzPacketEvent(receipt: TransactionReceipt, target?: string): string | undefined {
    if (target !== undefined) {
      target = target.toLowerCase().trim()
    }

    const toFind = this.messagingModuleAddress.slice(2, 42)
    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (
          log.topics[0] === this.targetEvents.LzPacket &&
          (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
        ) {
          const packetPayload = NetworkMonitor.iface.decodeEventLog(
            NetworkMonitor.lzPacketEventFragment,
            log.data,
            log.topics,
          )[0] as string
          if (packetPayload.indexOf(toFind) > 0) {
            let index: number = packetPayload.indexOf(toFind)
            // address + bytes2 + address
            index += 40 + 4 + 40
            return ('0x' + packetPayload.slice(Math.max(0, index))).toLowerCase()
          }
        }
      }
    }

    return undefined
  }

  decodeLzEvent(receipt: TransactionReceipt, target?: string): any[] | undefined {
    if (target !== undefined) {
      target = target.toLowerCase().trim()
    }

    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (
          log.topics[0] === this.targetEvents.LzEvent &&
          (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
        ) {
          const event = NetworkMonitor.iface.decodeEventLog(
            NetworkMonitor.lzEventFragment,
            log.data,
            log.topics,
          ) as any[]
          return this.lowerCaseAllStrings(event)
        }
      }
    }

    return undefined
  }

  decodeErc20TransferEvent(receipt: TransactionReceipt, target?: string): string[] | undefined {
    if (target !== undefined) {
      target = target.toLowerCase().trim()
    }

    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (
          log.topics[0] === this.targetEvents.Transfer &&
          (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
        ) {
          const event = NetworkMonitor.iface.decodeEventLog(
            NetworkMonitor.erc20TransferEventFragment,
            log.data,
            log.topics,
          ) as string[]
          return this.lowerCaseAllStrings(event, log.address)
        }
      }
    }

    return undefined
  }

  decodeErc721TransferEvent(receipt: TransactionReceipt, target?: string): string[] | undefined {
    if (target !== undefined) {
      target = target.toLowerCase().trim()
    }

    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (
          log.topics[0] === this.targetEvents.Transfer &&
          (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
        ) {
          const event = NetworkMonitor.iface.decodeEventLog(
            NetworkMonitor.erc721TransferEventFragment,
            log.data,
            log.topics,
          ) as string[]
          return this.lowerCaseAllStrings(event, log.address)
        }
      }
    }

    return undefined
  }

  decodeAvailableJobEvent(receipt: TransactionReceipt, target?: string): string | undefined {
    if (target !== undefined) {
      target = target.toLowerCase().trim()
    }

    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (
          log.topics[0] === this.targetEvents.AvailableJob &&
          (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
        ) {
          return (
            NetworkMonitor.iface.decodeEventLog(
              NetworkMonitor.availableJobEventFragment,
              log.data,
              log.topics,
            )[0] as string
          ).toLowerCase()
        }
      }
    }

    return undefined
  }

  decodeAvailableOperatorJobEvent(receipt: TransactionReceipt, target?: string): string[] | undefined {
    if (target !== undefined) {
      target = target.toLowerCase().trim()
    }

    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (
          log.topics[0] === this.targetEvents.AvailableOperatorJob &&
          (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
        ) {
          const output: string[] = NetworkMonitor.iface.decodeEventLog(
            NetworkMonitor.availableOperatorJobEventFragment,
            log.data,
            log.topics,
          ) as string[]
          return this.lowerCaseAllStrings(output) as string[]
        }
      }
    }

    return undefined
  }

  decodeBridgeableContractDeployedEvent(receipt: TransactionReceipt, target?: string): string[] | undefined {
    if (target !== undefined) {
      target = target.toLowerCase().trim()
    }

    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (
          log.topics[0] === this.targetEvents.BridgeableContractDeployed &&
          (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
        ) {
          return this.lowerCaseAllStrings(
            NetworkMonitor.iface.decodeEventLog(
              NetworkMonitor.bridgeableContractDeployedEventFragment,
              log.data,
              log.topics,
            ) as string[],
          )
        }
      }
    }

    return undefined
  }

  decodeCrossChainMessageSentEvent(receipt: TransactionReceipt, target?: string): string | undefined {
    if (target !== undefined) {
      target = target.toLowerCase().trim()
    }

    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (
          log.topics[0] === this.targetEvents.CrossChainMessageSent &&
          (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
        ) {
          return (
            NetworkMonitor.iface.decodeEventLog(
              NetworkMonitor.crossChainMessageSentEventFragment,
              log.data,
              log.topics,
            )[0] as string
          ).toLowerCase()
        }
      }
    }

    return undefined
  }

  decodeFinishedOperatorJobEvent(receipt: TransactionReceipt, target?: string): string[] | undefined {
    if (target !== undefined) {
      target = target.toLowerCase().trim()
    }

    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (
          log.topics[0] === this.targetEvents.FinishedOperatorJob &&
          (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
        ) {
          const output: string[] = NetworkMonitor.iface.decodeEventLog(
            NetworkMonitor.finishedOperatorJobEventFragment,
            log.data,
            log.topics,
          ) as string[]
          return this.lowerCaseAllStrings(output) as string[]
        }
      }
    }

    return undefined
  }

  decodeFailedOperatorJobEvent(receipt: TransactionReceipt, target?: string): string | undefined {
    if (target !== undefined) {
      target = target.toLowerCase().trim()
    }

    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (
          log.topics[0] === this.targetEvents.FailedOperatorJob &&
          (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
        ) {
          return (
            NetworkMonitor.iface.decodeEventLog(
              NetworkMonitor.failedOperatorJobEventFragment,
              log.data,
              log.topics,
            )[0] as string
          ).toLowerCase()
        }
      }
    }

    return undefined
  }

  lowerCaseAllStrings(input: any[], add?: string): any[] {
    const output = [...input]
    if (add !== undefined) {
      output.push(add)
    }

    for (let i = 0, l = output.length; i < l; i++) {
      if (typeof output[i] === 'string') {
        output[i] = (output[i] as string).toLowerCase()
      }
    }

    return output
  }

  randomTag(): string {
    // 4_294_967_295 is max value for 2^32 which is uint32
    return Math.floor(Math.random() * 4_294_967_295).toString(16)
  }

  async getBlock({
    blockNumber,
    network,
    tags = [] as (string | number)[],
    attempts = 10,
    canFail = false,
    interval = 5000,
  }: BlockParams): Promise<Block | null> {
    return new Promise<Block | null>((topResolve, _topReject) => {
      let counter = 0
      let sent = false
      let blockInterval: NodeJS.Timeout | null = null
      const getBlock = async (): Promise<void> => {
        try {
          const block: Block | null = await this.providers[network].getBlock(blockNumber)
          if (block === null) {
            counter++
            if (canFail && counter > attempts) {
              if (blockInterval) clearInterval(blockInterval)
              if (!sent) {
                sent = true
                topResolve(null)
              }
            }
          } else {
            if (blockInterval) clearInterval(blockInterval)
            if (!sent) {
              sent = true
              topResolve(block as Block)
            }
          }
        } catch (error: any) {
          if (error.message !== 'cannot query unfinalized data') {
            counter++
            if (canFail && counter > attempts) {
              this.structuredLog(network, `Failed retrieving block ${blockNumber}`, tags)
              if (blockInterval) clearInterval(blockInterval)
              if (!sent) {
                sent = true
                _topReject(error)
              }
            }
          }
        }
      }

      blockInterval = setInterval(getBlock, interval)
      getBlock()
    })
  }

  async getBlockWithTransactions({
    blockNumber,
    network,
    tags = [] as (string | number)[],
    attempts = 10,
    canFail = false,
    interval = 5000,
  }: BlockParams): Promise<BlockWithTransactions | null> {
    return new Promise<BlockWithTransactions | null>((topResolve, _topReject) => {
      let counter = 0
      let sent = false
      let blockInterval: NodeJS.Timeout | null = null
      const getBlock = async (): Promise<void> => {
        try {
          const block: BlockWithTransactions | null = await this.providers[network].getBlockWithTransactions(
            blockNumber,
          )
          if (block === null) {
            counter++
            if (canFail && counter > attempts) {
              if (blockInterval) clearInterval(blockInterval)
              if (!sent) {
                sent = true
                topResolve(null)
              }
            }
          } else {
            if (blockInterval) clearInterval(blockInterval)
            if (!sent) {
              sent = true
              topResolve(block as BlockWithTransactions)
            }
          }
        } catch (error: any) {
          if (error.message !== 'cannot query unfinalized data') {
            counter++
            if (canFail && counter > attempts) {
              this.structuredLog(network, `Failed retrieving block ${blockNumber}`, tags)
              if (blockInterval) clearInterval(blockInterval)
              if (!sent) {
                sent = true
                _topReject(error)
              }
            }
          }
        }
      }

      blockInterval = setInterval(getBlock, interval)
      getBlock()
    })
  }

  async getTransaction({
    transactionHash,
    network,
    tags = [] as (string | number)[],
    attempts = 10,
    canFail = false,
    interval = 2000,
  }: TransactionParams): Promise<TransactionResponse | null> {
    return new Promise<TransactionResponse | null>((topResolve, _topReject) => {
      let counter = 0
      let sent = false
      let txInterval: NodeJS.Timeout | null = null
      const getTx = async (): Promise<void> => {
        const tx: TransactionResponse | null = await this.providers[network].getTransaction(transactionHash)
        if (tx === null) {
          counter++
          if (canFail && counter > attempts) {
            if (txInterval) clearInterval(txInterval)
            if (!sent) {
              sent = true
              this.structuredLog(network, `Failed getting transaction ${transactionHash}`, tags)
              topResolve(null)
            }
          }
        } else {
          if (txInterval) clearInterval(txInterval)
          if (!sent) {
            sent = true
            topResolve(tx as TransactionResponse)
          }
        }
      }

      txInterval = setInterval(getTx, interval)
      getTx()
    })
  }

  async getTransactionReceipt({
    transactionHash,
    network,
    tags = [] as (string | number)[],
    attempts = 10,
    canFail = false,
    interval = 2000,
  }: TransactionParams): Promise<TransactionReceipt | null> {
    return new Promise<TransactionReceipt | null>((topResolve, _topReject) => {
      let counter = 0
      let sent = false
      let txReceiptInterval: NodeJS.Timeout | null = null
      const getTxReceipt = async (): Promise<void> => {
        const receipt: TransactionReceipt | null = await this.providers[network].getTransactionReceipt(transactionHash)
        if (receipt === null) {
          counter++
          if (canFail && counter > attempts) {
            if (txReceiptInterval) clearInterval(txReceiptInterval)
            if (!sent) {
              sent = true
              this.structuredLog(network, `Failed getting transaction ${transactionHash} receipt`, tags)
              topResolve(null)
            }
          }
        } else {
          if (txReceiptInterval) clearInterval(txReceiptInterval)
          if (!sent) {
            sent = true
            topResolve(receipt as TransactionReceipt)
          }
        }
      }

      txReceiptInterval = setInterval(getTxReceipt, interval)
      getTxReceipt()
    })
  }

  async getBalance({
    walletAddress,
    network,
    tags = [] as (string | number)[],
    attempts = 10,
    canFail = false,
    interval = 1000,
  }: WalletParams): Promise<BigNumber> {
    return new Promise<BigNumber>((topResolve, _topReject) => {
      let counter = 0
      let sent = false
      let balanceInterval: NodeJS.Timeout | null = null
      const getBalance = async (): Promise<void> => {
        try {
          const balance: BigNumber = await this.providers[network].getBalance(walletAddress, 'latest')
          if (balanceInterval) clearInterval(balanceInterval)
          if (!sent) {
            sent = true
            topResolve(balance)
          }
        } catch (error: any) {
          counter++
          if (canFail && counter > attempts) {
            if (balanceInterval) clearInterval(balanceInterval)
            if (!sent) {
              sent = true
              this.structuredLog(network, `Failed getting ${walletAddress} balance`, tags)
              _topReject(error)
            }
          }
        }
      }

      balanceInterval = setInterval(getBalance, interval)
      getBalance()
    })
  }

  async getNonce({
    walletAddress,
    network,
    tags = [] as (string | number)[],
    attempts = 10,
    canFail = false,
    interval = 1000,
  }: WalletParams): Promise<number> {
    return new Promise<number>((topResolve, _topReject) => {
      let counter = 0
      let sent = false
      let nonceInterval: NodeJS.Timeout | null = null
      const getNonce = async (): Promise<void> => {
        try {
          const nonce: number = await this.providers[network].getTransactionCount(walletAddress, 'latest')
          if (nonceInterval) clearInterval(nonceInterval)
          if (!sent) {
            sent = true
            topResolve(nonce)
          }
        } catch (error: any) {
          counter++
          if (canFail && counter > attempts) {
            if (nonceInterval) clearInterval(nonceInterval)
            if (!sent) {
              sent = true
              this.structuredLog(network, `Failed getting ${walletAddress} nonce`, tags)
              _topReject(error)
            }
          }
        }
      }

      nonceInterval = setInterval(getNonce, interval)
      getNonce()
    })
  }

  async getGasLimit({
    contract,
    methodName,
    args,
    network,
    tags = [] as (string | number)[],
    gasPrice,
    value = ZERO,
    attempts = 10,
    canFail = false,
    interval = 5000,
  }: GasLimitParams): Promise<BigNumber | null> {
    return new Promise<BigNumber | null>((topResolve, _topReject) => {
      let counter = 0
      let sent = false
      let calculateGasInterval: NodeJS.Timeout | null = null
      const calculateGas = async (): Promise<void> => {
        try {
          const gasLimit: BigNumber | null = await contract
            .connect(this.wallets[network])
            .estimateGas[methodName](...args, {
              gasPrice: gasPrice!.mul(TWO),
              value,
              from: this.wallets[network].address,
            })
          if (gasLimit === null) {
            counter++
            if (canFail && counter > attempts) {
              if (calculateGasInterval) clearInterval(calculateGasInterval)
              if (!sent) {
                sent = true
                this.structuredLog(network, `Failed calculating gas limit`, tags)
                topResolve(null)
              }
            }
          } else {
            if (calculateGasInterval) clearInterval(calculateGasInterval)
            if (!sent) {
              sent = true
              topResolve(gasLimit)
            }
          }
        } catch (error: any) {
          let revertReason = 'unknown revert reason'
          let revertExplanation = 'unknown'
          let knownReason = false
          if ('reason' in error && error.reason.startsWith('execution reverted:')) {
            // transaction reverted, we got a `revert` error from web3 call
            revertReason = error.reason.split('execution reverted: ')[1]
            switch (revertReason) {
              case 'HOLOGRAPH: already deployed': {
                revertExplanation = 'The deploy request is invalid, since requested contract is already deployed.'
                knownReason = true
                break
              }

              case 'HOLOGRAPH: invalid job': {
                revertExplanation =
                  'Job has most likely been already completed. If it has not, then that means the cross-chain message has not arrived yet.'
                knownReason = true
                break
              }

              case 'HOLOGRAPH: not holographed': {
                revertExplanation = 'Need to first deploy a holographable contract on destination chain.'
                knownReason = true
                break
              }
            }
          }

          if (knownReason) {
            this.structuredLog(network, `[web3] ${revertReason} (${revertExplanation})`, tags)
          } else {
            this.structuredLog(network, JSON.stringify(error), tags)
          }

          if (calculateGasInterval) clearInterval(calculateGasInterval)
          if (!sent) {
            sent = true
            this.structuredLog(network, `Transaction is expected to revert`, tags)
            topResolve(null)
          }
        }
      }

      calculateGasInterval = setInterval(calculateGas, interval)
      calculateGas()
    })
  }

  async sendTransaction({
    rawTx,
    network,
    tags = [] as (string | number)[],
    attempts = 10,
    canFail = false,
    interval = 1000,
  }: SendTransactionParams): Promise<TransactionResponse | null> {
    return new Promise<TransactionResponse | null>((topResolve, _topReject) => {
      let txHash: string | null
      let counter = 0
      let sent = false
      let sendTxInterval: NodeJS.Timeout | null = null
      const handleError = (error: any) => {
        // process.stdout.write('sendTransaction' + JSON.stringify(error, undefined, 2))
        counter++
        if (canFail && counter > attempts) {
          this.structuredLogError(network, error, tags)
          if (sendTxInterval) clearInterval(sendTxInterval)
          if (!sent) {
            sent = true
            topResolve(null)
          }
        }
      }

      const sendTx = async (): Promise<void> => {
        let populatedTx: TransactionRequest | null
        let signedTx: string | null
        let tx: TransactionResponse | null
        const gasPricing: GasPricing = this.gasPrices[network]
        let gasPrice: BigNumber | undefined
        try {
          // move gas price info around to support EIP-1559
          if (gasPricing.isEip1559) {
            if (gasPrice === undefined) {
              gasPrice = BigNumber.from(rawTx.gasPrice!)
              delete rawTx.gasPrice
            }

            rawTx.type = 2
            rawTx.maxPriorityFeePerGas = gasPrice!
            rawTx.maxFeePerGas = gasPrice!
          }

          if ('value' in rawTx && rawTx.value!.eq(ZERO)) {
            delete rawTx.value
          }

          populatedTx = await this.wallets[network].populateTransaction(rawTx)
          signedTx = await this.wallets[network].signTransaction(populatedTx)
          if (txHash === null) {
            txHash = keccak256(signedTx)
          }

          this.structuredLog(network, 'Attempting to send transaction -> ' + JSON.stringify(populatedTx), tags)
          tx = await this.providers[network].sendTransaction(signedTx)
          if (tx === null) {
            counter++
            if (canFail && counter > attempts) {
              this.structuredLog(network, 'Failed submitting transaction', tags)
              if (sendTxInterval) clearInterval(sendTxInterval)
              if (!sent) {
                sent = true
                topResolve(null)
              }
            }
          } else {
            this.structuredLog(network, `Transaction sent to mempool ${tx.hash}`, tags)
            if (sendTxInterval) clearInterval(sendTxInterval)
            if (!sent) {
              sent = true
              topResolve(tx)
            }
          }
        } catch (error: any) {
          switch (error.message) {
            case 'already known': {
              // we are aware that more than one message has been sent, so avoid all errors echoed
              tx = await this.getTransaction({transactionHash: txHash!, network, tags, attempts, canFail, interval})
              if (tx !== null) {
                if (sendTxInterval) clearInterval(sendTxInterval)
                if (!sent) {
                  this.structuredLog(network, 'Transaction already submitted', tags)
                  sent = true
                  topResolve(tx)
                }
              }

              break
            }

            case 'nonce has already been used': {
              // we will see this when a transaction has already been submitted and is no longer in tx pool
              tx = await this.getTransaction({transactionHash: txHash!, network, tags, attempts, canFail, interval})
              if (tx !== null) {
                if (sendTxInterval) clearInterval(sendTxInterval)
                if (!sent) {
                  this.structuredLog(network, 'Transaction already mined', tags)
                  sent = true
                  topResolve(tx)
                }
              }

              break
            }

            default: {
              handleError(error)
              break
            }
          }
        }
      }

      sendTxInterval = setInterval(sendTx, interval)
      sendTx()
    })
  }

  async populateTransaction({
    network,
    contract,
    methodName,
    args,
    gasPrice,
    gasLimit,
    value = ZERO,
    nonce,
    tags = [] as (string | number)[],
    attempts = 10,
    canFail = false,
    interval = 1000,
  }: PopulateTransactionParams): Promise<PopulatedTransaction | null> {
    return new Promise<PopulatedTransaction | null>((topResolve, _topReject) => {
      let counter = 0
      let sent = false
      let populateTxInterval: NodeJS.Timeout | null = null
      const handleError = (error: any) => {
        // process.stdout.write('populateTransaction' + JSON.stringify(error, undefined, 2))
        counter++
        if (canFail && counter > attempts) {
          this.structuredLogError(network, error, tags)
          if (populateTxInterval) clearInterval(populateTxInterval)
          if (!sent) {
            sent = true
            topResolve(null)
          }
        }
      }

      const populateTx = async (): Promise<void> => {
        let rawTx: PopulatedTransaction | null
        try {
          rawTx = await contract.populateTransaction[methodName](...args, {
            gasPrice,
            gasLimit,
            nonce,
            value,
            from: this.wallets[network].address,
          })
          if (rawTx === null) {
            counter++
            if (canFail && counter > attempts) {
              this.structuredLog(network, 'Failed populating transaction', tags)
              if (populateTxInterval) clearInterval(populateTxInterval)
              if (!sent) {
                sent = true
                topResolve(null)
              }
            }
          } else {
            if (populateTxInterval) clearInterval(populateTxInterval)
            if (!sent) {
              sent = true
              topResolve(rawTx)
            }
          }
        } catch (error: any) {
          handleError(error)
        }
      }

      populateTxInterval = setInterval(populateTx, interval)
      populateTx()
    })
  }

  async executeTransaction({
    network,
    tags = [] as (string | number)[],
    contract,
    methodName,
    args,
    gasPrice,
    gasLimit,
    value = ZERO,
    attempts = 10,
    canFail = false,
    interval = 500,
    waitForReceipt = false,
  }: ExecuteTransactionParams): Promise<TransactionReceipt | null> {
    const tag: string = this.randomTag()
    tags.push(tag)
    this.structuredLog(network, `Executing contract function ${methodName}`, tags)
    // eslint-disable-next-line no-async-promise-executor
    return new Promise<TransactionReceipt | null>(async (topResolve, _topReject) => {
      if (this.walletNonces[network] < 0) {
        this.walletNonces[network] = await this.getNonce({
          network,
          walletAddress: await this.wallets[network].getAddress(),
          canFail: false,
        })
      }

      contract = contract.connect(this.wallets[network])
      if (gasPrice === undefined) {
        gasPrice = this.gasPrices[network].gasPrice!
        gasPrice = gasPrice.add(gasPrice.div(TWO))
      }

      this.structuredLog(network, `Gas price is ${formatUnits(gasPrice, 'gwei')} GWEI`, tags)
      if (gasLimit === undefined) {
        gasLimit = await this.getGasLimit({
          network,
          tags,
          contract,
          methodName,
          args,
          gasPrice,
          value,
          attempts,
          canFail,
          interval,
        })
      }

      if (gasLimit === null) {
        topResolve(null)
        return
      }

      this.structuredLog(network, `Gas limit is ${gasLimit.toNumber()}`, tags)
      this.structuredLog(
        network,
        `Transaction is estimated to cost a total of ${formatUnits(gasLimit.mul(gasPrice), 'ether')} ${
          networks[network].tokenSymbol
        }`,
        tags,
      )
      const walletAddress: string = await this.wallets[network].getAddress()
      const balance: BigNumber | null = await this.getBalance({network, walletAddress, attempts, canFail, interval})
      if (balance === null) {
        this.structuredLog(network, `Could not get wallet ${walletAddress} balance`, tags)
        topResolve(null)
        return
      }

      this.structuredLog(network, `Wallet balance is ${formatUnits(balance!, 'ether')}`, tags)
      if (balance.lt(gasLimit.mul(gasPrice).add(value))) {
        this.structuredLogError(
          network,
          `Wallet balance is lower than the transaction required amount. Balance is ${formatUnits(balance, 'ether')} ${
            networks[network].tokenSymbol
          } and required amount is ${formatUnits(gasLimit.mul(gasPrice).add(value), 'ether')} ${
            networks[network].tokenSymbol
          }`,
          tags,
        )
        topResolve(null)
        return
      }

      const rawTx: PopulatedTransaction | null = await this.populateTransaction({
        network,
        contract,
        methodName,
        args,
        gasPrice,
        gasLimit,
        value,
        nonce: this.walletNonces[network],
        tags,
        attempts,
        canFail,
        interval,
      })
      if (rawTx === null) {
        // populating tx failed
        this.structuredLog(network, `Failed to populate transaction ${methodName} ${JSON.stringify(args)}`, tags)
        topResolve(null)
        return
      }

      // reset time to allow for proper transaction submission
      this.lastBlockJobDone[network] = Date.now()
      const tx: TransactionResponse | null = await this.sendTransaction({
        network,
        tags,
        rawTx,
        attempts,
        canFail,
        interval,
      })
      if (tx === null) {
        // sending tx failed
        this.structuredLog(network, `Failed to send transaction ${methodName} ${JSON.stringify(args)}`, tags)
        topResolve(null)
        return
      }

      // reset time to allow for proper transaction confirmation
      this.lastBlockJobDone[network] = Date.now()
      this.structuredLog(network, `Transaction ${tx.hash} has been submitted`, tags)
      const receipt: TransactionReceipt | null = await this.getTransactionReceipt({
        network,
        transactionHash: tx.hash,
        attempts,
        // allow this promise to resolve as null to not hold up the confirmation process for too long
        canFail: waitForReceipt ? false : canFail, // canFail,
      })
      if (receipt === null) {
        if (!waitForReceipt) {
          this.walletNonces[network]++
        }

        this.structuredLog(
          network,
          `Transaction ${networks[network].explorer}/tx/${tx.hash} could not be confirmed`,
          tags,
        )
      } else {
        this.walletNonces[network]++
        this.structuredLog(
          network,
          `Transaction ${networks[network].explorer}/tx/${receipt.transactionHash} mined and confirmed`,
          tags,
        )
      }

      topResolve(receipt)
    })
  }
}
