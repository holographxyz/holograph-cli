import * as fs from 'fs-extra'
import * as path from 'node:path'

import {ethers, BigNumber, PopulatedTransaction} from 'ethers'
import {
  Block,
  BlockWithTransactions,
  TransactionReceipt,
  TransactionResponse,
  TransactionRequest,
} from '@ethersproject/abstract-provider'
import {Command, Flags} from '@oclif/core'

import {ConfigFile, ConfigNetwork, ConfigNetworks} from './config'

import {capitalize, NETWORK_COLORS} from './utils'
import color from '@oclif/color'

import {Environment, getEnvironment} from './environment'
import {HOLOGRAPH_ADDRESSES} from './contracts'

export const warpFlag = {
  warp: Flags.integer({
    description: 'Start from the beginning of the chain',
    default: 0,
    char: 'w',
  }),
}

export const networksFlag = {
  networks: Flags.string({description: 'Comma separated list of networks to operate on', multiple: true}),
}

export const networkFlag = {
  network: Flags.string({description: 'Name of network to use', multiple: false}),
}

export enum OperatorMode {
  listen,
  manual,
  auto,
}

export type KeepAliveParams = {
  debug: (...args: any[]) => void
  provider: ethers.providers.WebSocketProvider
  onDisconnect: (err: any) => void
  expectedPongBack?: number
  checkInterval?: number
}

export type BlockJob = {
  network: string
  block: number
}

export interface Scope {
  network: string
  startBlock: number
  endBlock: number
}

export enum FilterType {
  to,
  from,
  functionSig,
}

export type TransactionFilter = {
  type: FilterType
  match: string | {[key: string]: string}
  networkDependant: boolean
}

export const keepAlive = ({
  debug,
  provider,
  onDisconnect,
  expectedPongBack = 10_000, // 10 seconds
  checkInterval = 5000, // 5 seconds
}: KeepAliveParams): void => {
  let pingTimeout: NodeJS.Timeout | null = null
  let keepAliveInterval: NodeJS.Timeout | null = null
  let counter = 0
  let errorCounter = 0
  let terminator: NodeJS.Timeout | null = null
  const errHandler: (err: any) => void = (err: any) => {
    if (errorCounter === 0) {
      errorCounter++
      debug(`websocket error event triggered ${err.code} ${err.syscall}`)
      if (keepAliveInterval) clearInterval(keepAliveInterval)
      if (pingTimeout) clearTimeout(pingTimeout)
      terminator = setTimeout(() => {
        provider._websocket.terminate()
      }, checkInterval)
    }
  }

  provider._websocket.on('open', () => {
    debug(`websocket open event triggered`)
    provider._websocket.off('error', errHandler)
    if (terminator) clearTimeout(terminator)
    keepAliveInterval = setInterval(() => {
      provider._websocket.ping()
      pingTimeout = setTimeout(() => {
        provider._websocket.terminate()
      }, expectedPongBack)
    }, checkInterval)
  })

  provider._websocket.on('close', (err: any) => {
    debug(`websocket close event triggered`)
    if (counter === 0) {
      debug(`websocket closed`)
      counter++
      if (keepAliveInterval) clearInterval(keepAliveInterval)
      if (pingTimeout) clearTimeout(pingTimeout)
      setTimeout(() => {
        onDisconnect(err)
      }, checkInterval)
    }
  })

  provider._websocket.on('error', errHandler)

  provider._websocket.on('pong', () => {
    if (pingTimeout) clearInterval(pingTimeout)
  })
}

export type ExecuteTransactionParams = {
  network: string
  tags?: (string | number)[]
  contract: ethers.Contract
  methodName: string
  args: any[]
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
  contract: ethers.Contract
  methodName: string
  args: any[]
  gasPrice: BigNumber
  gasLimit: BigNumber
  nonce: number
  tags?: (string | number)[]
  attempts?: number
  canFail?: boolean
  interval?: number
}

export type GasLimitParams = {
  network: string
  tags?: (string | number)[]
  contract: ethers.Contract
  methodName: string
  args: any[]
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
  processTransactions: ((job: BlockJob, transactions: TransactionResponse[]) => Promise<void>) | undefined
  filters?: TransactionFilter[]
  userWallet?: ethers.Wallet
  lastBlockFilename?: string
  warp?: number
}

export class NetworkMonitor {
  environment: Environment
  parent: ImplementsCommand
  configFile: ConfigFile
  userWallet?: ethers.Wallet
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
  wallets: {[key: string]: ethers.Wallet} = {}
  walletNonces: {[key: string]: number} = {}
  providers: {[key: string]: ethers.providers.JsonRpcProvider | ethers.providers.WebSocketProvider} = {}
  abiCoder = ethers.utils.defaultAbiCoder
  networkColors: any = {}
  latestBlockHeight: {[key: string]: number} = {}
  currentBlockHeight: {[key: string]: number} = {}
  blockJobs: {[key: string]: BlockJob[]} = {}
  exited = false
  blockJobThreshold = 15_000 // 15 seconds
  lastBlockJobDone: {[key: string]: number} = {}
  blockJobMonitorProcess: {[key: string]: NodeJS.Timer} = {}
  holograph!: ethers.Contract
  bridgeContract!: ethers.Contract
  factoryContract!: ethers.Contract
  interfacesContract!: ethers.Contract
  operatorContract!: ethers.Contract
  registryContract!: ethers.Contract
  HOLOGRAPH_ADDRESSES = HOLOGRAPH_ADDRESSES

  LAYERZERO_RECEIVERS: {[key: string]: string} = {
    rinkeby: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
    goerli: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
    mumbai: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
    fuji: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
  }

  needToSubscribe = false
  warp = 0

  targetEvents: Record<string, string> = {
    BridgeableContractDeployed: '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b',
    '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b': 'BridgeableContractDeployed',

    Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': 'Transfer',

    AvailableJob: '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11',
    '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11': 'AvailableJob',

    Packet: '0xe8d23d927749ec8e512eb885679c2977d57068839d8cca1a85685dbbea0648f6',
    '0xe8d23d927749ec8e512eb885679c2977d57068839d8cca1a85685dbbea0648f6': 'Packet',

    LzPacket: '0xe9bded5f24a4168e4f3bf44e00298c993b22376aad8c58c7dda9718a54cbea82',
    '0xe9bded5f24a4168e4f3bf44e00298c993b22376aad8c58c7dda9718a54cbea82': 'LzPacket',
  }

  getProviderStatus() {
    const outputNetworks = Object.keys(this.configFile.networks)
    const output = {} as any

    for (const n of outputNetworks) {
      if (this.providers[n]) {
        const current = this.providers[n] as ethers.providers.WebSocketProvider
        if (current._wsReady && current._websocket._socket.readyState === 'open') {
          output[n] = 'CONNECTED'
        }
      } else {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        output[n] = this.configFile.networks[n].providerUrl ? 'DISCONNECTED' : 'NOT_CONFIGURED'
      }
    }

    return output
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

    this.processTransactions = options.processTransactions?.bind(this.parent)
    if (options.userWallet !== undefined) {
      this.userWallet = options.userWallet
    }

    if (options.warp !== undefined && options.warp > 0) {
      this.warp = options.warp
    }

    if (options.networks === undefined || '') {
      options.networks = Object.keys(this.configFile.networks)
    } else {
      for (let i = 0, l = options.networks.length; i < l; i++) {
        const network = options.networks[i]
        if (Object.keys(this.configFile.networks).includes(network)) {
          this.blockJobs[network] = []
        } else {
          this.structuredLog(network, `${network} is not a valid network and will be ignored`)
          // If network is not supported remove it from the array
          options.networks.splice(i, 1)
          l--
          i--
        }
      }
    }

    this.networks = options.networks

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
    await this.initializeEthers()
    if (ethersInitializedCallback !== undefined) {
      await ethersInitializedCallback.bind(this.parent)()
    }

    this.log(`Holograph address: ${this.HOLOGRAPH_ADDRESSES[this.environment]}`)
    this.log(`Bridge address: ${this.bridgeAddress}`)
    this.log(`Factory address: ${this.factoryAddress}`)
    this.log(`Interfaces address: ${this.interfacesAddress}`)
    this.log(`Operator address: ${this.operatorAddress}`)
    this.log(`Registry address: ${this.registryAddress}`)

    if (blockJobs !== undefined) {
      this.blockJobs = blockJobs
    }

    for (const network of this.networks) {
      if (!(network in this.blockJobs)) {
        this.blockJobs[network] = []
      }

      this.lastBlockJobDone[network] = Date.now()
      this.runningProcesses += 1
      if (continuous) {
        this.needToSubscribe = true
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
    const filePath = path.join(configDir, this.LAST_BLOCKS_FILE_NAME)
    let lastBlocks: {[key: string]: number} = {}
    if (await fs.pathExists(filePath)) {
      lastBlocks = await fs.readJson(filePath)
    }

    return lastBlocks
  }

  saveLastBlocks(configDir: string, lastBlocks: {[key: string]: number}): void {
    const filePath = path.join(configDir, this.LAST_BLOCKS_FILE_NAME)
    fs.writeFileSync(filePath, JSON.stringify(lastBlocks), 'utf8')
  }

  disconnectBuilder(network: string, rpcEndpoint: string, subscribe: boolean): (error: any) => void {
    return (error: any): void => {
      if (this.providers[network] === undefined) {
        this.debug(this.providers)
        throw new Error(`Provider for ${network} is undefined`)
      }

      ;(this.providers[network] as ethers.providers.WebSocketProvider).destroy().then(() => {
        this.structuredLog(network, `WS connection was closed ${JSON.stringify(error)}`)
        this.lastBlockJobDone[network] = Date.now()
        this.providers[network] = this.failoverWebSocketProvider(network, rpcEndpoint, subscribe)
        if (this.userWallet !== undefined) {
          this.wallets[network] = this.userWallet.connect(this.providers[network] as ethers.providers.WebSocketProvider)

          this.debug(`Address of wallet for ${network}: ${this.wallets[network].getAddress()}`)
          this.wallets[network].getAddress().then((walletAddress: string) => {
            this.debug(`Checking what getNonce is: ${this.getNonce}`)
            this.getNonce({network, walletAddress, canFail: false}).then((nonce: number) => {
              this.walletNonces[network] = nonce
            })
          })
        }
      })
    }
  }

  failoverWebSocketProvider(
    network: string,
    rpcEndpoint: string,
    subscribe: boolean,
  ): ethers.providers.WebSocketProvider {
    this.debug('this.providers', network)
    const provider = new ethers.providers.WebSocketProvider(rpcEndpoint)
    keepAlive({
      debug: this.debug,
      provider,
      onDisconnect: this.disconnectBuilder.bind(this)(network, rpcEndpoint, true),
    })
    this.providers[network] = provider
    if (subscribe && this.needToSubscribe) {
      this.networkSubscribe(network)
    }

    return provider
  }

  async initializeEthers(): Promise<void> {
    for (let i = 0, l = this.networks.length; i < l; i++) {
      const network = this.networks[i]
      const rpcEndpoint = (this.configFile.networks[network as keyof ConfigNetworks] as ConfigNetwork).providerUrl
      const protocol = new URL(rpcEndpoint).protocol
      switch (protocol) {
        case 'https:':
          this.providers[network] = new ethers.providers.JsonRpcProvider(rpcEndpoint)

          break
        case 'wss:':
          this.providers[network] = this.failoverWebSocketProvider.bind(this)(network, rpcEndpoint, false)
          break
        default:
          throw new Error('Unsupported RPC provider protocol -> ' + protocol)
      }

      if (this.userWallet !== undefined) {
        this.wallets[network] = this.userWallet.connect(this.providers[network])
        // eslint-disable-next-line no-await-in-loop
        this.walletNonces[network] = await this.wallets[network].getTransactionCount()
      }

      if (this.warp > 0) {
        this.structuredLog(network, `Starting Operator from ${this.warp} blocks back...`)
        /* eslint-disable no-await-in-loop */
        const currentBlock: number = await this.providers[network].getBlockNumber()
        this.blockJobs[network] = []
        for (let n = currentBlock - this.warp, nl = currentBlock; n <= nl; n++) {
          this.blockJobs[network].push({
            network,
            block: n,
          })
        }
      } else if (network in this.latestBlockHeight && this.latestBlockHeight[network] > 0) {
        this.structuredLog(network, `Resuming Operator from block height ${this.latestBlockHeight[network]}`)
        this.currentBlockHeight[network] = this.latestBlockHeight[network]
      } else {
        this.structuredLog(network, `Starting Operator from latest block height`)
        this.latestBlockHeight[network] = 0
        this.currentBlockHeight[network] = 0
      }
    }

    const holographABI = await fs.readJson(`./src/abi/${this.environment}/Holograph.json`)
    this.holograph = new ethers.Contract(
      this.HOLOGRAPH_ADDRESSES[this.environment],
      holographABI,
      this.providers[this.networks[0]],
    )
    this.bridgeAddress = (await this.holograph.getBridge()).toLowerCase()
    this.factoryAddress = (await this.holograph.getFactory()).toLowerCase()
    this.interfacesAddress = (await this.holograph.getInterfaces()).toLowerCase()
    this.operatorAddress = (await this.holograph.getOperator()).toLowerCase()
    this.registryAddress = (await this.holograph.getRegistry()).toLowerCase()

    const holographBridgeABI = await fs.readJson(`./src/abi/${this.environment}/HolographBridge.json`)
    this.bridgeContract = new ethers.Contract(this.bridgeAddress, holographBridgeABI, this.providers[this.networks[0]])

    const holographFactoryABI = await fs.readJson(`./src/abi/${this.environment}/HolographFactory.json`)
    this.factoryContract = new ethers.Contract(
      this.factoryAddress,
      holographFactoryABI,
      this.providers[this.networks[0]],
    )

    const holographInterfacesABI = await fs.readJson(`./src/abi/${this.environment}/HolographInterfaces.json`)
    this.interfacesContract = new ethers.Contract(
      this.interfacesAddress,
      holographInterfacesABI,
      this.providers[this.networks[0]],
    )

    const holographOperatorABI = await fs.readJson(`./src/abi/${this.environment}/HolographOperator.json`)
    this.operatorContract = new ethers.Contract(
      this.operatorAddress,
      holographOperatorABI,
      this.providers[this.networks[0]],
    )

    const holographRegistryABI = await fs.readJson(`./src/abi/${this.environment}/HolographRegistry.json`)
    this.registryContract = new ethers.Contract(
      this.registryAddress,
      holographRegistryABI,
      this.providers[this.networks[0]],
    )
  }

  exitCallback?: () => void

  exitHandler = async (exitCode: number): Promise<void> => {
    /**
     * Before exit, save the block heights to the local db
     */
    if (this.exited === false) {
      this.log('')
      if (this.needToSubscribe) {
        this.log(`Saving current block heights:\n${JSON.stringify(this.latestBlockHeight, undefined, 2)}`)
        this.saveLastBlocks(this.parent.config.configDir, this.latestBlockHeight)
      }

      this.log(`Exiting ${this.parent.constructor.name} with code ${exitCode}...`)
      this.log('Goodbye! 👋')
      this.exited = true
    }
  }

  exitRouter = (options: {[key: string]: boolean | string | number}, exitCode: number | string): void => {
    /**
     * Before exit, save the block heights to the local db
     */
    if ((exitCode && exitCode === 0) || exitCode === 'SIGINT') {
      if (this.exited === false) {
        this.log('')
        if (this.needToSubscribe) {
          this.log(`Saving current block heights:\n${JSON.stringify(this.latestBlockHeight, undefined, 2)}`)
          this.saveLastBlocks(this.parent.config.configDir, this.latestBlockHeight)
        }

        this.log(`Exiting ${this.parent.constructor.name} with code ${exitCode}...`)
        this.log('Goodbye! 👋')
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
      case 'https:':
        this.providers[network] = new ethers.providers.JsonRpcProvider(rpcEndpoint)

        break
      case 'wss:':
        this.providers[network] = this.failoverWebSocketProvider.bind(this)(network, rpcEndpoint, false)
        break
      default:
        throw new Error('Unsupported RPC provider protocol -> ' + protocol)
    }

    if (this.userWallet !== undefined) {
      this.wallets[network] = this.userWallet.connect(this.providers[network])
      this.walletNonces[network] = await this.wallets[network].getTransactionCount()
    }

    const provider = this.providers[network] as ethers.providers.WebSocketProvider
    switch (protocol) {
      case 'https:':
        this.structuredLog(network, 'Restarting blockJob Handler since this is an HTTPS RPC connection')
        this.blockJobHandler(network)
        break
      case 'wss:':
        if (provider !== undefined && provider._websocket !== undefined) {
          this.structuredLog(network, 'Closing websocket connection')
          this.structuredLog(network, `Provider _websocket is: ${provider._websocket}`)
          provider._websocket.terminate()
        } else {
          throw new Error(`Provider for ${network} is undefined`)
        }

        break
    }

    Promise.resolve()
  }

  blockJobMonitor = (network: string): Promise<void> => {
    return new Promise<void>(() => {
      if (Date.now() - this.lastBlockJobDone[network] > this.blockJobThreshold) {
        this.structuredLog(network, 'Block Job Handler has been inactive longer than threshold time. Restarting.', [])
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
      // we assume that this is latest
      this.structuredLog(job.network, `Processed block`, job.block)
      this.blockJobs[job.network].shift()
    }

    this.lastBlockJobDone[network] = Date.now()
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
          if (data.startsWith(match)) {
            interestingTransactions.push(transaction)
          }

          break
        default:
          break
      }
    }
  }

  async processBlock(job: BlockJob): Promise<void> {
    this.structuredLog(job.network, `Processing block`, job.block)
    const block: BlockWithTransactions | null = await this.getBlockWithTransactions({
      network: job.network,
      blockNumber: job.block,
      attempts: 10,
      canFail: true,
    })
    if (block !== undefined && block !== null && 'transactions' in block) {
      this.structuredLog(job.network, `Block retrieved`, job.block)
      if (block.transactions.length === 0) {
        this.structuredLog(job.network, `Zero transactions in block`, job.block)
      }

      const interestingTransactions: TransactionResponse[] = []
      for (let i = 0, l = block.transactions.length; i < l; i++) {
        this.filterTransaction(job, block.transactions[i], interestingTransactions)
      }

      if (interestingTransactions.length > 0) {
        this.structuredLog(job.network, `Found ${interestingTransactions.length} interesting transactions`, job.block)
        await this.processTransactions?.bind(this.parent)(job, interestingTransactions)
        this.blockJobHandler(job.network, job)
      } else {
        this.blockJobHandler(job.network, job)
      }
    } else {
      this.structuredLog(job.network, `${color.red('Dropped block')}`, job.block)
      this.blockJobHandler(job.network)
    }
  }

  networkSubscribe(network: string): void {
    this.providers[network].on('block', (blockNumber: string) => {
      const block = Number.parseInt(blockNumber, 10)
      if (this.currentBlockHeight[network] !== 0 && block - this.currentBlockHeight[network] > 1) {
        this.structuredLog(network, `Resuming previously dropped connection, gotta do some catching up`)
        let latest = this.currentBlockHeight[network]
        while (block - latest > 0) {
          this.structuredLog(network, `Block (Syncing)`, latest)
          this.blockJobs[network].push({
            network: network,
            block: latest,
          })
          latest++
        }
      }

      this.currentBlockHeight[network] = block
      this.structuredLog(network, `New block mined`, block)
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
        capitalize(network),
      )}]${cleanTags(tagId)} ${msg}`,
    )
  }

  structuredLogError(network: string, error: any, tagId?: string | number | (number | string)[]): void {
    let errorMessage = `unknown error message`
    if (error.message) {
      errorMessage = `${error.message}`
    } else if (error.reason) {
      errorMessage = `${error.reason}`
    } else if (error.error.reason) {
      errorMessage = `${error.error.reason}`
    }

    const timestamp = new Date(Date.now()).toISOString()
    const timestampColor = color.keyword('green')
    const errorColor = color.keyword('red')

    this.warn(
      `[${timestampColor(timestamp)}] [${this.parent.constructor.name}] [${this.networkColors[network](
        capitalize(network),
      )}] [${errorColor('error')}]${cleanTags(tagId)} ${errorMessage}`,
    )
  }

  static iface: ethers.utils.Interface = new ethers.utils.Interface([])
  static packetEventFragment: ethers.utils.EventFragment = ethers.utils.EventFragment.from(
    'Packet(uint16 chainId, bytes payload)',
  )

  static lzPacketEventFragment: ethers.utils.EventFragment = ethers.utils.EventFragment.from('Packet(bytes payload)')

  static erc20TransferEventFragment: ethers.utils.EventFragment = ethers.utils.EventFragment.from(
    'Transfer(address indexed _from, address indexed _to, uint256 _value)',
  )

  static erc721TransferEventFragment: ethers.utils.EventFragment = ethers.utils.EventFragment.from(
    'Transfer(address indexed _from, address indexed _to, uint256 indexed _tokenId)',
  )

  static availableJobEventFragment: ethers.utils.EventFragment =
    ethers.utils.EventFragment.from('AvailableJob(bytes payload)')

  static bridgeableContractDeployedEventFragment: ethers.utils.EventFragment = ethers.utils.EventFragment.from(
    'BridgeableContractDeployed(address indexed contractAddress, bytes32 indexed hash)',
  )

  decodePacketEvent(receipt: TransactionReceipt): string | undefined {
    const toFind = this.operatorAddress.slice(2, 42)
    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (log.topics[0] === this.targetEvents.Packet) {
          const packetPayload = NetworkMonitor.iface.decodeEventLog(
            NetworkMonitor.packetEventFragment,
            log.data,
            log.topics,
          )[1] as string
          if (packetPayload.indexOf(toFind) > 0) {
            return ('0x' + packetPayload.split(this.operatorAddress.slice(2, 42).repeat(2))[1]).toLowerCase()
          }
        }
      }
    }

    return undefined
  }

  decodeLzPacketEvent(receipt: TransactionReceipt): string | undefined {
    const toFind = this.operatorAddress.slice(2, 42)
    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (log.topics[0] === this.targetEvents.LzPacket) {
          const packetPayload = NetworkMonitor.iface.decodeEventLog(
            NetworkMonitor.lzPacketEventFragment,
            log.data,
            log.topics,
          )[0] as string
          if (packetPayload.indexOf(toFind) > 0) {
            return ('0x' + packetPayload.split(toFind)[2]).toLowerCase()
          }
        }
      }
    }

    return undefined
  }

  decodeErc20TransferEvent(receipt: TransactionReceipt): any[] | undefined {
    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (log.topics[0] === this.targetEvents.Transfer) {
          const event: string[] = NetworkMonitor.iface.decodeEventLog(
            NetworkMonitor.erc20TransferEventFragment,
            log.data,
            log.topics,
          ) as any[]
          return this.lowerCaseAllStrings(event, log.address)
        }
      }
    }

    return undefined
  }

  decodeErc721TransferEvent(receipt: TransactionReceipt): any[] | undefined {
    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (log.topics[0] === this.targetEvents.Transfer) {
          const event: string[] = NetworkMonitor.iface.decodeEventLog(
            NetworkMonitor.erc721TransferEventFragment,
            log.data,
            log.topics,
          ) as any[]
          return this.lowerCaseAllStrings(event, log.address)
        }
      }
    }

    return undefined
  }

  decodeAvailableJobEvent(receipt: TransactionReceipt): string | undefined {
    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (log.address.toLowerCase() === this.operatorAddress && log.topics[0] === this.targetEvents.AvailableJob) {
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

  decodeBridgeableContractDeployedEvent(receipt: TransactionReceipt): any[] | undefined {
    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (
          log.address.toLowerCase() === this.factoryAddress &&
          log.topics[0] === this.targetEvents.BridgeableContractDeployed
        ) {
          return this.lowerCaseAllStrings(
            NetworkMonitor.iface.decodeEventLog(
              NetworkMonitor.bridgeableContractDeployedEventFragment,
              log.data,
              log.topics,
            ) as any[],
          )
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
    interval = 1000,
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
    interval = 1000,
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
    interval = 1000,
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
    interval = 1000,
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
    attempts = 10,
    canFail = false,
    interval = 1000,
  }: GasLimitParams): Promise<BigNumber | null> {
    return new Promise<BigNumber | null>((topResolve, _topReject) => {
      let counter = 0
      let sent = false
      let calculateGasInterval: NodeJS.Timeout | null = null
      const calculateGas = async (): Promise<void> => {
        try {
          const gasLimit: BigNumber | null = await contract.estimateGas[methodName](...args)
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
        try {
          populatedTx = await this.wallets[network].populateTransaction(rawTx)
          signedTx = await this.wallets[network].signTransaction(populatedTx)
          if (txHash === null) {
            txHash = ethers.utils.keccak256(signedTx)
          }

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

            case 'only replay-protected (EIP-155) transactions allowed over RPC': {
              handleError(error)
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
          rawTx = await contract.populateTransaction[methodName](...args, {gasPrice, gasLimit, nonce})
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
      contract = contract.connect(this.wallets[network])
      const gasLimit: BigNumber | null = await this.getGasLimit({
        network,
        tags,
        contract,
        methodName,
        args,
        attempts,
        canFail,
        interval,
      })
      if (gasLimit === null) {
        topResolve(null)
      } else {
        const gasPrice = await contract.provider.getGasPrice()
        const walletAddress: string = await this.wallets[network].getAddress()
        const balance: BigNumber | null = await this.getBalance({network, walletAddress, attempts, canFail, interval})
        this.structuredLog(network, `Wallet balance is ${ethers.utils.formatUnits(balance!, 'ether')}`, tags)
        if (balance === null) {
          this.structuredLog(network, `Could not get wallet ${walletAddress} balance`, tags)
          topResolve(null)
        } else if (balance.lt(gasLimit.mul(gasPrice))) {
          this.structuredLog(
            network,
            `Wallet balance is lower than the transaction required amount. ${JSON.stringify(
              {contract: await contract.resolvedAddress, method: methodName, args},
              undefined,
              2,
            )}`,
            tags,
          )
          topResolve(null)
        } else {
          this.structuredLog(network, `Gas price in Gwei = ${ethers.utils.formatUnits(gasPrice, 'gwei')}`, tags)
          this.structuredLog(
            network,
            `Transaction is estimated to cost a total of ${ethers.utils.formatUnits(
              gasLimit.mul(gasPrice),
              'ether',
            )} native gas tokens (in ether)`,
            tags,
          )
          const rawTx: PopulatedTransaction | null = await this.populateTransaction({
            network,
            contract,
            methodName,
            args,
            gasPrice,
            gasLimit,
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
          } else {
            // we reset time to allow for proper transaction submission
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
            } else {
              // we reset time to allow for proper transaction confirmation
              this.lastBlockJobDone[network] = Date.now()
              this.structuredLog(network, `Transaction ${tx.hash} has been submitted`, tags)
              this.walletNonces[network]++
              const receipt: TransactionReceipt | null = await this.getTransactionReceipt({
                network,
                transactionHash: tx.hash,
                attempts,
                // we allow this promise to resolve as null to not hold up the confirmation process for too long
                canFail: waitForReceipt ? false : canFail, // canFail,
              })
              if (receipt === null) {
                this.structuredLog(network, `Transaction ${tx.hash} could not be confirmed`, tags)
              } else {
                this.structuredLog(network, `Transaction ${receipt.transactionHash} mined and confirmed`, tags)
              }

              topResolve(receipt)
            }
          }
        }
      }
    })
  }
}
