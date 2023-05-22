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
import {defaultAbiCoder} from '@ethersproject/abi'
import {WebSocketProvider, JsonRpcProvider} from '@ethersproject/providers'
import {isInBloom} from './bloom-filters'
import {
  ExtendedBlock,
  ExtendedBlockWithTransactions,
  getExtendedBlock,
  getExtendedBlockWithTransactions,
} from './extended-block'
import {EventType, Event, eventMap, BloomFilter, BridgeableContractDeployedEvent} from './event'
import './numbers'
import './strings'
import {
  Block,
  BlockWithTransactions,
  Filter,
  Log,
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/abstract-provider'

import {Environment, getEnvironment} from '@holographxyz/environment'
import {
  supportedNetworks,
  supportedShortNetworks,
  networks,
  getNetworkByShortKey,
  getNetworkByKey,
  getNetworkByChainId,
} from '@holographxyz/networks'

import {ConfigFile, ConfigNetwork, ConfigNetworks} from './config'
import {GasPricing, initializeGasPricing, updateGasPricing} from './gas'
import {capitalize, NETWORK_COLORS, sleep, zeroAddress} from './utils'
import {CXIP_ERC721_ADDRESSES, HOLOGRAPH_ADDRESSES} from './contracts'
import {BlockHeight, BlockHeightProcessType} from '../types/api'
import ApiService from '../services/api-service'
import {iface, packetEventFragment, targetEvents} from '../events/events'
import {
  LogsParams,
  BlockParams,
  ExecuteTransactionParams,
  GasLimitParams,
  PopulateTransactionParams,
  SendTransactionParams,
  TransactionParams,
  WalletParams,
  InterestingTransaction,
} from '../types/network-monitor'
import {BlockHeightOptions} from '../flags/update-block-height.flag'

export const replayFlag = {
  replay: Flags.string({
    description: 'Replay block processing. Run between the closed range defined. E.g. 30909:30999',
    aliases: ['repair'],
    deprecateAliases: true,
    default: '0',
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
  eventHash,
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

const TIMEOUT_THRESHOLD = 60_000

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
  const errorHandler: (err: ExtendedError) => void = (err: ExtendedError) => {
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
    websocket.off('error', errorHandler)
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

  websocket.on('error', errorHandler)

  websocket.on('pong', () => {
    if (pingTimeout) {
      clearInterval(pingTimeout)
    }
  })
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
  enableV2?: boolean
  processTransactions?: (job: BlockJob, transactions: TransactionResponse[]) => Promise<void>
  processTransactions2?: (job: BlockJob, transactions: InterestingTransaction[]) => Promise<void>
  filters?: TransactionFilter[]
  userWallet?: Wallet
  lastBlockFilename?: string
  replay?: string
  verbose?: boolean
  apiService?: ApiService
  BlockHeightOptions?: BlockHeightOptions
}

export class NetworkMonitor {
  enableV2 = false
  verbose = true
  environment: Environment
  parent: ImplementsCommand
  configFile: ConfigFile
  bloomFilters: BloomFilter[] = []
  tbdCachedContracts: string[] = []
  userWallet?: Wallet
  LAST_BLOCKS_FILE_NAME: string
  filters: TransactionFilter[] = []
  processTransactions: ((job: BlockJob, transactions: TransactionResponse[]) => Promise<void>) | undefined
  processTransactions2: ((job: BlockJob, transactions: InterestingTransaction[]) => Promise<void>) | undefined
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
  apiService!: ApiService
  blockHeightOptions?: BlockHeightOptions

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
    binanceSmartChainTestnet: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
    optimismTestnetGoerli: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),

    ethereum: '0xe93685f3bba03016f02bd1828badd6195988d950'.toLowerCase(),
    polygon: '0xe93685f3bba03016f02bd1828badd6195988d950'.toLowerCase(),
    avalanche: '0xe93685f3bba03016f02bd1828badd6195988d950'.toLowerCase(),
    binanceSmartChain: '0xe93685f3bba03016f02bd1828badd6195988d950'.toLowerCase(),
    optimism: '0xe93685f3bba03016f02bd1828badd6195988d950'.toLowerCase(),
  }

  needToSubscribe = false
  replayBlockStart = 0
  replayBlockEnd: number | undefined

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

  validateReplayFlagInput(input: string) {
    if (/([1-9]\d*|0):([1-9]\d*)/.test(input)) {
      // expected type: 8987:8988
      const startAndEndBlock = input.split(':').map(int => Number(int))
      if (startAndEndBlock[0] > startAndEndBlock[1]) {
        throw new Error('End block must be greater than start block number.')
      }

      return true
    }

    return /[1-9]\d*/.test(input)
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

    if (options.enableV2) {
      this.enableV2 = options.enableV2
    }

    if (options.verbose !== undefined) {
      this.verbose = options.verbose
    }

    if (options.processTransactions !== undefined) {
      this.processTransactions = options.processTransactions.bind(this.parent)
    }

    if (options.processTransactions2 !== undefined) {
      this.processTransactions2 = options.processTransactions2.bind(this.parent)
    }

    if (options.userWallet !== undefined) {
      this.userWallet = options.userWallet
    }

    if (options.replay !== undefined && options.replay !== '0') {
      if (!this.validateReplayFlagInput(options.replay)) {
        throw new Error('Replay flag input format is not valid')
      }

      const replayRangeBlock = options.replay.split(':').map(int => Number(int))
      this.replayBlockStart = replayRangeBlock[0]
      this.replayBlockEnd = replayRangeBlock.length === 2 ? replayRangeBlock[1] : undefined
    }

    if (options.networks === undefined || '') {
      options.networks = Object.keys(this.configFile.networks)
    }

    if (options.apiService !== undefined) {
      this.apiService = options.apiService
    }

    if (options.BlockHeightOptions !== undefined) {
      this.blockHeightOptions = options.BlockHeightOptions
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

    // Replay can only be used with a single network at a time since the block number provided to the replay flag is global
    // This can be updated in the future to support multiple networks with different block numbers simple logic is preferred for now
    if (this.replayBlockStart > 0 && this.networks.length > 1) {
      this.log(
        'Replay mode is not supported for multiple networks. Please use a single network with desired replay block height',
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
      this.log(`📄 HLG Token address: ${this.tokenAddress}`)
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

      if (this.replayBlockEnd === undefined) {
        // Subscribe to events 🎧
        this.networkSubscribe(network)
      }

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

  async loadLastBlocksHeights(processType: BlockHeightProcessType): Promise<{
    [key: string]: number
  }> {
    if (this.apiService === undefined) {
      throw new Error('API service is undefined')
    }

    const blockHeights: BlockHeight[] = await this.apiService.getBlockHeights(processType)
    this.log('blockHeights:', blockHeights)

    const latestBlockHeight: {[key: string]: number} = {}

    for (const blockHeight of blockHeights) {
      const network = getNetworkByChainId(blockHeight.chainId).key
      latestBlockHeight[network] = Number(blockHeight.blockHeight)
    }

    return latestBlockHeight
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
        })
      }

      if (this.replayBlockStart > 0) {
        this.structuredLog(network, color.red(`🚧 REPLAY MODE ACTIVATED 🚧`))

        const endBlockNumber =
          this.replayBlockEnd === undefined ? await this.providers[network].getBlockNumber() : this.replayBlockEnd

        if (this.verbose) {
          this.structuredLog(network, `Last block height [${color.green(endBlockNumber)}]`)
          this.structuredLog(
            network,
            `Starting Network Monitor in replay mode from ${color.yellow(
              endBlockNumber - this.replayBlockStart,
            )} blocks back at block [${color.red(this.replayBlockStart)}]`,
          )
        }

        this.latestBlockHeight[network] = this.replayBlockStart
        this.blockJobs[network] = []
        for (let n = this.replayBlockStart; n <= endBlockNumber; n++) {
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
    this.tokenAddress = (await this.holograph.getUtilityToken()).toLowerCase()
    this.cxipERC721Address = CXIP_ERC721_ADDRESSES[this.environment]

    // Setup contracts
    const CxipERC721ABI = await fs.readJson(path.join(__dirname, `../abi/${this.environment}/CxipERC721.json`))
    this.cxipERC721Contract = new Contract(this.cxipERC721Address, CxipERC721ABI, this.providers[this.networks[0]])

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

  isUpdateBlockHeightUsingApiEnabled = (): boolean => {
    return Boolean(
      this.apiService !== undefined &&
        this.blockHeightOptions !== undefined &&
        this.blockHeightOptions === BlockHeightOptions.API,
    )
  }

  isSaveBlockHeightEnabled = (): boolean => {
    return Boolean(
      this.blockHeightOptions &&
        (this.blockHeightOptions === BlockHeightOptions.FILE || this.blockHeightOptions === BlockHeightOptions.API),
    )
  }

  exitHandler = async (exitCode: number): Promise<void> => {
    /**
     * Before exit, save the block heights to the local db
     */
    if (this.exited === false) {
      this.log('')
      if (this.needToSubscribe && this.isSaveBlockHeightEnabled()) {
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
        if (this.needToSubscribe && this.isSaveBlockHeightEnabled()) {
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

  blockJobHandler = async (network: string, job?: BlockJob): Promise<void> => {
    if (job !== undefined) {
      this.latestBlockHeight[job.network] = job.block
      if (this.verbose) {
        this.structuredLog(job.network, `Block processing complete ✅`, job.block)
      }

      if (
        (this.parent.id === 'indexer' || this.parent.id === 'operator') &&
        this.isUpdateBlockHeightUsingApiEnabled()
      ) {
        try {
          await this.updateLastProcessedBlock(job)
        } catch (error: any) {
          this.structuredLogError(job.network, `Error updating last processed block: ${error.message}`, job.block)
          return
        }
      }

      this.blockJobs[job.network].shift()
    }

    this.lastBlockJobDone[network] = Date.now()
    this.lastProcessBlockDone[network] = Date.now()
    if (this.blockJobs[network].length > 0) {
      const blockJob: BlockJob = this.blockJobs[network][0] as BlockJob
      if (this.enableV2) {
        try {
          await this.processBlock2(blockJob)
        } catch (error: any) {
          this.structuredLogError(blockJob.network, `Error processing block: ${error}`, blockJob.block)
        }
      } else {
        try {
          await this.processBlock(blockJob)
        } catch (error: any) {
          this.structuredLogError(blockJob.network, `Error processing block: ${error}`, blockJob.block)
        }
      }
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

  /* eslint-disable-next-line max-params */
  async applyFilter(
    filter: BloomFilter,
    log: Log,
    tx: TransactionResponse,
    parent: ImplementsCommand,
    network: string,
  ): Promise<InterestingTransaction | undefined> {
    const event: Event = filter.bloomEvent
    if (log.topics.length > 0 && log.topics[0] === event.sigHash) {
      if (filter.eventValidator) {
        if (filter.eventValidator.bind(parent)(network, tx, log)) {
          return {
            bloomId: filter.bloomId,
            transaction: tx,
            log,
          } as InterestingTransaction
        }
      } else {
        return {
          bloomId: filter.bloomId,
          transaction: tx,
          log,
        } as InterestingTransaction
      }
    }

    return undefined
  }

  filterTransactions(
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

  isInterestingTransactionLogAlreadyIncluded(log: Log, interestingTransactions: InterestingTransaction[]): boolean {
    const interestingTx = interestingTransactions.find(
      tx => tx.log?.transactionHash === log.transactionHash && tx.log.logIndex === log.logIndex,
    )
    return interestingTx !== undefined
  }

  filterLogsByTx(tx: string, logs: Log[]): Log[] {
    const output: Log[] = []
    for (const log of logs) {
      if (log.transactionHash === tx) {
        output.push(log)
      }
    }

    return output
  }

  async filterTransactions2(
    job: BlockJob,
    transactions: TransactionResponse[],
    logs: Log[],
    interestingTransactions: InterestingTransaction[],
  ): Promise<void> {
    const allLogs: {[key: string]: Log[]} = {}
    const tbdLogs: number[] = []
    const txMap: {[key: string]: TransactionResponse} = {}
    for (const tx of transactions) {
      txMap[tx.hash] = tx
    }

    for (const filter of this.bloomFilters) {
      const event: Event = filter.bloomEvent
      for (const log of logs) {
        if (!(log.transactionHash in allLogs)) {
          allLogs[log.transactionHash] = this.filterLogsByTx(log.transactionHash, logs)
        }

        if (
          log.topics.length === 0 ||
          log.topics[0] !== event.sigHash ||
          this.isInterestingTransactionLogAlreadyIncluded(log, interestingTransactions)
        ) {
          continue
        }

        if (filter.eventValidator) {
          if (filter.eventValidator.bind(this.parent)(job.network, txMap[log.transactionHash], log)) {
            interestingTransactions.push({
              bloomId: filter.bloomId,
              transaction: txMap[log.transactionHash],
              log,
              allLogs: allLogs[log.transactionHash]!,
            } as InterestingTransaction)
          } else if (this.tbdCachedContracts.includes(log.address.toLowerCase()) && !tbdLogs.includes(log.logIndex)) {
            interestingTransactions.push({
              bloomId: 'TBD',
              transaction: txMap[log.transactionHash],
              log,
              allLogs: allLogs[log.transactionHash]!,
            } as InterestingTransaction)
            tbdLogs.push(log.logIndex)
          }
        } else {
          interestingTransactions.push({
            bloomId: filter.bloomId,
            transaction: txMap[log.transactionHash],
            log,
            allLogs: allLogs[log.transactionHash]!,
          } as InterestingTransaction)
        }
      }
    }
  }

  adjustBridgeableContractDeployedLogs(logs: Log[], index: number, address: string): Log[] {
    let firstIndex: number = index
    for (let i = 0, l: number = logs.length; i < l; i++) {
      if (logs[i].address.toLowerCase() === address && firstIndex > i) {
        firstIndex = i
      }
    }

    if (firstIndex !== index) {
      const targetLog: Log = logs[index]
      logs.splice(index, 1)
      logs.splice(firstIndex, 0, targetLog)
    }

    return logs
  }

  sortLogs(logs: Log[]): Log[] {
    const event: Event = eventMap[EventType.BridgeableContractDeployed]
    let log: Log
    let bridgeableContractDeployedEvent: BridgeableContractDeployedEvent | null
    for (let i = 0, l: number = logs.length; i < l; i++) {
      log = logs[i]
      if (log.topics.length > 0 && log.topics[0] === event.sigHash) {
        bridgeableContractDeployedEvent = event.decode<BridgeableContractDeployedEvent>(event.type, log)
        if (bridgeableContractDeployedEvent !== null) {
          if (!this.tbdCachedContracts.includes(bridgeableContractDeployedEvent.contractAddress)) {
            this.tbdCachedContracts.push(bridgeableContractDeployedEvent.contractAddress)
          }

          logs = this.adjustBridgeableContractDeployedLogs(logs, i, bridgeableContractDeployedEvent.contractAddress)
        }
      }
    }

    return logs
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
    // for legacy networks (non EIP-1559), get average rolling gasPrice
    // it's important to skip this calculation if gas price is 0, which happens in some instances like on BSC
    // we check first that gasPrice variable is actually set, and we check that it is greater than zero
    else if (tx.gasPrice !== undefined && tx.gasPrice !== null && tx.gasPrice!.gt(ZERO)) {
      // if current network gas pricing is null, then this means it's the first time that gas price data is being set
      if (this.gasPrices[network].gasPrice === null) {
        this.gasPrices[network].gasPrice = tx.gasPrice!
      }
      // otherwise we already have gas price data set, we just add new value to it and divide by two to get the floating average
      else {
        this.gasPrices[network].gasPrice = this.gasPrices[network].gasPrice!.add(tx.gasPrice!).div(TWO)
      }
    }
  }

  async updateLastProcessedBlock(job: BlockJob): Promise<void> {
    let processType: BlockHeightProcessType | undefined

    if (this.parent.constructor.name === 'Indexer') {
      processType = BlockHeightProcessType.INDEXER
    } else if (this.parent.constructor.name === 'Operator') {
      processType = BlockHeightProcessType.OPERATOR
    }

    if (processType === undefined) {
      throw new Error(`updateLastProcessedBlock: processType is neither Indexer or Operator`)
    }

    try {
      const rawResponse = await this.apiService.updateBlockHeight(
        processType,
        getNetworkByKey(job.network).chain,
        job.block,
      )
      if (rawResponse !== undefined) {
        const {data: response, headers} = rawResponse

        const requestId = headers.get('x-request-id') ?? ''
        this.structuredLog(job.network, `Mutation response ${JSON.stringify(response)}`, [requestId])
      }
    } catch (error: any) {
      this.structuredLogError(job.network, error, [`Request failed with errors: ${error}`])
    }
  }

  checkBloomLogs(block: ExtendedBlockWithTransactions): boolean {
    for (const filter of this.bloomFilters) {
      if (!isInBloom(block.logsBloom, filter.bloomValueHashed)) {
        continue
      }

      // check if there is additional validation required
      if (filter.bloomFilterValidators) {
        // iterate over each validator
        for (const validator of filter.bloomFilterValidators) {
          // if a match is found, then pass the transaction through
          if (isInBloom(block.logsBloom, validator.bloomValueHashed)) {
            return true
          }
        }
      } else {
        return true
      }
    }

    return false
  }

  async processBlock(job: BlockJob): Promise<void> {
    this.activated[job.network] = true
    if (this.verbose) {
      this.structuredLog(job.network, `Getting block 🔍`, job.block)
    }

    const block: ExtendedBlockWithTransactions | null = await this.getBlockWithTransactions({
      network: job.network,
      blockNumber: job.block,
      attempts: 10,
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

        this.filterTransactions(job, block.transactions[i], interestingTransactions)
      }

      if (recentBlock) {
        this.gasPrices[job.network] = updateGasPricing(job.network, block, this.gasPrices[job.network])
      }

      /*
      Temporarily disabled
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

  async processBlock2(job: BlockJob): Promise<void> {
    const interestingTransactions: InterestingTransaction[] = []
    this.activated[job.network] = true
    if (this.verbose) {
      this.structuredLog(job.network, `Getting block 🔍`, job.block)
    }

    try {
      const block = await this.getBlockWithTransactions({
        network: job.network,
        blockNumber: job.block,
        attempts: 10,
      })

      if (block !== undefined && block !== null && 'transactions' in block) {
        const recentBlock = this.currentBlockHeight[job.network] - job.block < 5

        if (recentBlock) {
          this.gasPrices[job.network] = updateGasPricing(job.network, block, this.gasPrices[job.network])
        }

        if (this.checkBloomLogs(block)) {
          let logs = await this.getLogs({
            network: job.network,
            blockNumber: job.block,
            attempts: 10,
          })

          if (logs !== null) {
            logs = this.sortLogs(logs as Log[])
            await this.filterTransactions2(job, block.transactions, logs as Log[], interestingTransactions)
          }
        }

        if (recentBlock) {
          this.gasPrices[job.network] = updateGasPricing(job.network, block, this.gasPrices[job.network])
        }

        if (interestingTransactions.length > 0) {
          if (this.processTransactions2 === undefined) {
            throw new Error('processTransactions2 is undefined')
          }

          await this.processTransactions2?.bind(this.parent)(job, interestingTransactions)
        }
      }
    } catch (error: any) {
      this.structuredLogError(job.network, `Error processing block ${error}`, job.block)
    } finally {
      try {
        await this.blockJobHandler(job.network, job)
      } catch (error: any) {
        this.structuredLogError(job.network, `Error handling block ${error}`, job.block)
      }
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
          // if (this.verbose) {
          //   this.structuredLog(network, `Block (Syncing)`, latest)
          // }

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

  decodePacketEvent(receipt: TransactionReceipt, target?: string): string | undefined {
    if (target !== undefined) {
      target = target.toLowerCase().trim()
    }

    const toFind = this.operatorAddress.slice(2, 42)
    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (
          log.topics[0] === targetEvents.Packet &&
          (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
        ) {
          const packetPayload = iface.decodeEventLog(packetEventFragment, log.data, log.topics)[1] as string
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

  randomTag(): string {
    // 4_294_967_295 is max value for 2^32 which is uint32
    return Math.floor(Math.random() * 4_294_967_295).toString(16)
  }

  async getLogs({
    blockNumber,
    network,
    tags = [] as (string | number)[],
    attempts = 10,
    interval = 10_000,
  }: LogsParams): Promise<Log[] | null> {
    const targetBlock: string = BigNumber.from(blockNumber).toHexString()
    const topicsArray = this.bloomFilters.map(bloomFilter => bloomFilter.bloomValueHashed)

    const filter: Filter = {
      fromBlock: targetBlock,
      toBlock: targetBlock,
      topics: [topicsArray], // topics array needs to be wrapped in a nested array
    }

    const getLogs = async () => {
      try {
        const logs: Log[] | null = await this.providers[network].getLogs(filter)
        if (logs === null) {
          // If logs is null, we throw an error to indicate failure.
          throw new Error('Logs is null')
        } else {
          return logs as Log[]
        }
      } catch (error: any) {
        if (error.message !== 'cannot query unfinalized data') {
          this.structuredLog(network, `Failed retrieving logs for block ${blockNumber}`, tags)
          // In case of any other error, we throw it to be caught by the retry function.
          throw error
        }

        // If we can't query unfinalized data, we return null.
        return null
      }
    }

    try {
      return await this.retry(network, getLogs, attempts, interval)
    } catch (error) {
      this.structuredLogError(network, `Error retrieving logs after ${attempts} attempts: ${error}`, tags)
      return null
    }
  }

  async getBlock({
    blockNumber,
    network,
    tags = [] as (string | number)[],
    attempts = 10,
    interval = 5000,
  }: BlockParams): Promise<ExtendedBlock | null> {
    const getBlockAttempt = async () => {
      const block: ExtendedBlock | null = await getExtendedBlock(this.providers[network], blockNumber)

      if (block === null) {
        throw new Error('Failed retrieving block')
      }

      return block
    }

    try {
      return await this.retry(network, getBlockAttempt, attempts, interval)
    } catch (error: any) {
      this.structuredLog(network, `Failed retrieving block ${blockNumber}`, tags)
      throw error
    }
  }

  async getBlockWithTransactions({
    blockNumber,
    network,
    tags = [] as (string | number)[],
    attempts = 10,
    interval = 5000,
  }: BlockParams): Promise<ExtendedBlockWithTransactions | null> {
    const getBlock = async () => {
      return getExtendedBlockWithTransactions(this.providers[network], blockNumber)
    }

    try {
      return await this.retry(network, getBlock, attempts, interval)
    } catch (error: any) {
      this.structuredLog(network, `Failed getting block ${blockNumber} with transactions ${error}`, tags)
      return null
    }
  }

  async getTransaction({
    transactionHash,
    network,
    tags = [] as (string | number)[],
    attempts = 10,
    interval = 2000,
  }: TransactionParams): Promise<TransactionResponse | null> {
    const getTransactionAttempt = async () => {
      return this.providers[network].getTransaction(transactionHash)
    }

    try {
      return await this.retry(network, getTransactionAttempt, attempts, interval)
    } catch (error: any) {
      this.structuredLog(network, `Failed getting transaction ${transactionHash} ${error}`, tags)
      return null
    }
  }

  async getTransactionReceipt({
    transactionHash,
    network,
    tags = [] as (string | number)[],
    attempts = 10,
    interval = 2000,
  }: TransactionParams): Promise<TransactionReceipt | null> {
    const getTransactionReceiptAttempt = async () => {
      return this.providers[network].getTransactionReceipt(transactionHash)
    }

    try {
      return await this.retry(network, getTransactionReceiptAttempt, attempts, interval)
    } catch (error: any) {
      this.structuredLog(network, `Failed getting transaction ${transactionHash} receipt`, tags)
      throw error
    }
  }

  async getBalance({
    walletAddress,
    network,
    tags = [] as (string | number)[],
    attempts = 10,
    interval = 1000,
  }: WalletParams): Promise<BigNumber> {
    const getBalanceAttempt = async () => {
      return this.providers[network].getBalance(walletAddress, 'latest')
    }

    try {
      const result = await this.retry(network, getBalanceAttempt, attempts, interval)
      return result as BigNumber
    } catch (error: any) {
      this.structuredLog(network, `Failed getting ${walletAddress} balance`, tags)
      throw error
    }
  }

  async getNonce({
    walletAddress,
    network,
    tags = [] as (string | number)[],
    attempts = 10,
    interval = 1000,
  }: WalletParams): Promise<number> {
    const getNonceAttempt = async () => {
      return this.providers[network].getTransactionCount(walletAddress, 'latest')
    }

    try {
      const result = await this.retry(network, getNonceAttempt, attempts, interval)
      return result as number
    } catch (error: any) {
      this.structuredLog(network, `Failed getting ${walletAddress} nonce`, tags)
      throw error
    }
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
    interval = 5000,
  }: GasLimitParams): Promise<BigNumber | null> {
    const getGasLimitAttempt = async () => {
      const gasLimit: BigNumber | null = await contract
        .connect(this.wallets[network])
        .estimateGas[methodName](...args, {
          gasPrice: gasPrice!.mul(TWO),
          value,
          from: this.wallets[network].address,
        })

      return gasLimit
    }

    try {
      return await this.retry(network, getGasLimitAttempt, attempts, interval)
    } catch (error: any) {
      this.structuredLog(network, `Failed calculating gas limit`, tags)
      // Error handling logic for known reasons
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

        if (knownReason) {
          this.structuredLog(network, `[web3] ${revertReason} (${revertExplanation})`, tags)
        } else {
          this.structuredLog(network, error, tags)
        }
      }

      this.structuredLog(network, `Transaction is expected to revert`, tags)
      return null
    }
  }

  async sendTransaction({
    rawTx,
    network,
    tags = [] as (string | number)[],
    attempts = 10,
    interval = 3000,
  }: SendTransactionParams): Promise<TransactionResponse | null> {
    const sendTransactionAttempt = async (): Promise<TransactionResponse> => {
      let txHash: string | null = null
      const gasPricing: GasPricing = this.gasPrices[network]
      let gasPrice: BigNumber | undefined
      const rawTxGasPrice: BigNumber = BigNumber.from(rawTx.gasPrice ?? 0)

      // Remove the gasPrice from rawTx to avoid EIP1559 error that type2 tx does not allow for use of gasPrice
      delete rawTx.gasPrice

      try {
        // move gas price info around to support EIP-1559
        if (gasPricing.isEip1559) {
          if (gasPrice === undefined) {
            gasPrice = BigNumber.from(rawTxGasPrice)
          }

          rawTx.type = 2
          rawTx.maxPriorityFeePerGas = gasPrice!
          rawTx.maxFeePerGas = gasPrice!
        }

        if ('value' in rawTx && rawTx.value!.eq(ZERO)) {
          delete rawTx.value
        }

        const populatedTx = await this.wallets[network].populateTransaction(rawTx)
        const signedTx = await this.wallets[network].signTransaction(populatedTx)
        if (txHash === null) {
          txHash = keccak256(signedTx)
        }

        this.structuredLog(network, 'Attempting to send transaction -> ' + JSON.stringify(populatedTx), tags)
        const tx = await this.providers[network].sendTransaction(signedTx)

        if (tx === null) {
          throw new Error('Failed submitting transaction')
        } else {
          this.structuredLog(network, `Transaction sent to mempool ${tx.hash}`, tags)
          return tx
        }
      } catch (error: any) {
        if (error.message === 'already known' || error.message === 'nonce has already been used') {
          const tx = await this.getTransaction({
            transactionHash: txHash!,
            network,
            tags,
            attempts,
            interval,
          })
          if (tx === null) {
            throw error
          } else {
            this.structuredLog(
              network,
              error.message === 'already known' ? 'Transaction already submitted' : 'Transaction already mined',
              tags,
            )
            return tx
          }
        } else {
          throw error
        }
      }
    }

    try {
      return await this.retry(network, sendTransactionAttempt, attempts, interval)
    } catch (error: any) {
      this.structuredLogError(network, 'Failed submitting transaction', tags)
      throw error
    }
  }

  async populateTransaction({
    network,
    contract,
    methodName,
    args,
    gasPrice,
    gasLimit,
    value = ZERO,
    tags = [] as (string | number)[],
    attempts = 10,
    interval = 1000,
  }: PopulateTransactionParams): Promise<PopulatedTransaction | null> {
    const populateTransactionAttempt = async (): Promise<PopulatedTransaction> => {
      const rawTx = await contract.populateTransaction[methodName](...args, {
        gasPrice,
        gasLimit,
        value,
        from: this.wallets[network].address,
      })

      if (rawTx) {
        return rawTx
      }

      throw new Error('Failed populating transaction')
    }

    try {
      return await this.retry(network, populateTransactionAttempt, attempts, interval)
    } catch (error: any) {
      this.structuredLog(network, 'Failed populating transaction', tags)
      throw error
    }
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
    interval = 500,
    waitForReceipt = false,
  }: ExecuteTransactionParams): Promise<TransactionReceipt | null> {
    const tag: string = this.randomTag()
    tags.push(tag)
    this.structuredLog(network, `Executing contract function ${methodName}`, tags)

    if (this.walletNonces[network] < 0) {
      this.walletNonces[network] = await this.getNonce({
        network,
        walletAddress: await this.wallets[network].getAddress(),
      })
    }

    contract = contract.connect(this.wallets[network])
    if (gasPrice === undefined) {
      this.structuredLog(network, `About to get gas price from internal gas price functions`, tags)
      gasPrice = this.gasPrices[network].gasPrice!
      gasPrice = gasPrice.add(gasPrice.div(TWO))
    }

    if (network === 'polygon') {
      this.structuredLog(network, `Gas Price before = ${formatUnits(gasPrice, 'gwei')}`, tags)
      const staticGasPrice = BigNumber.from('400017425011')
      gasPrice = gasPrice.gt(staticGasPrice) ? gasPrice : staticGasPrice
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

        interval,
      })
    }

    if (gasLimit === null) {
      return null
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
    const balance: BigNumber | null = await this.getBalance({network, walletAddress, attempts, interval})
    if (balance === null) {
      this.structuredLog(network, `Could not get wallet ${walletAddress} balance`, tags)
      return null
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
      return null
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

      interval,
    })
    if (rawTx === null) {
      // populating tx failed
      this.structuredLog(network, `Failed to populate transaction ${methodName} ${JSON.stringify(args)}`, tags)
      return null
    }

    // reset time to allow for proper transaction submission
    this.lastBlockJobDone[network] = Date.now()
    const tx: TransactionResponse | null = await this.sendTransaction({
      network,
      tags,
      rawTx,
      attempts,

      interval,
    })
    if (tx === null) {
      // sending tx failed
      this.structuredLog(network, `Failed to send transaction ${methodName} ${JSON.stringify(args)}`, tags)
      return null
    }

    // reset time to allow for proper transaction confirmation
    this.lastBlockJobDone[network] = Date.now()
    this.structuredLog(network, `Transaction ${tx.hash} has been submitted`, tags)
    const receipt: TransactionReceipt | null = await this.getTransactionReceipt({
      network,
      transactionHash: tx.hash,
      attempts,
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

    return receipt
  }

  // Generic retry function
  async retry<T>(network: string, func: () => Promise<T>, attempts = 10, interval = 5000): Promise<T | null> {
    let result: T | null = null

    let i = 0 // declare i outside of loop so it can be used later
    for (i; i < attempts; i++) {
      try {
        result = await func()
        if (result !== null) {
          return result
        }
      } catch (error: any) {
        this.structuredLogError(network, error.message)
      }

      // If we haven't returned by now, it means the function call was unsuccessful.
      // We sleep for the specified interval before the next attempt.
      await sleep(interval)
    }

    // If we've exited the loop without returning, it means all attempts were unsuccessful.
    throw new Error(`Maximum attempts reached for ${func.name}, function did not succeed after ${attempts} attempts`)
  }
}
