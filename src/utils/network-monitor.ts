import * as fs from 'fs-extra'
import * as path from 'node:path'

import {ethers} from 'ethers'
import {Command} from '@oclif/core'

import {ConfigFile, ConfigNetwork, ConfigNetworks} from './config'

import {capitalize, NETWORK_COLORS} from './utils'
import color from '@oclif/color'

export enum OperatorMode {
  listen,
  manual,
  auto,
}

export type KeepAliveParams = {
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

export const keepAlive = ({
  provider,
  onDisconnect,
  expectedPongBack = 15_000,
  checkInterval = 7500,
}: KeepAliveParams): void => {
  let pingTimeout: NodeJS.Timeout | null = null
  let keepAliveInterval: NodeJS.Timeout | null = null

  provider._websocket.on('open', () => {
    keepAliveInterval = setInterval(() => {
      provider._websocket.ping()
      pingTimeout = setTimeout(() => {
        provider._websocket.terminate()
      }, expectedPongBack)
    }, checkInterval)
  })

  provider._websocket.on('close', (err: any) => {
    if (keepAliveInterval) clearInterval(keepAliveInterval)
    if (pingTimeout) clearTimeout(pingTimeout)
    onDisconnect(err)
  })

  provider._websocket.on('pong', () => {
    if (pingTimeout) clearInterval(pingTimeout)
  })
}

type ImplementsCommand = Command

type NetworkMonitorOptions = {
  parent: ImplementsCommand
  configFile: ConfigFile
  networks: string[]
  debug: (...args: string[]) => void
  processBlock: (job: BlockJob) => Promise<void>
  userWallet?: ethers.Wallet
  lastBlockFilename?: string
}

export class NetworkMonitor {
  parent: ImplementsCommand
  configFile: ConfigFile
  userWallet?: ethers.Wallet
  LAST_BLOCKS_FILE_NAME: string
  processBlock: (job: BlockJob) => Promise<void>
  log: (message: string, ...args: any[]) => void
  debug: (...args: any[]) => void
  networks!: string[]
  runningProcesses = 0
  bridgeAddress!: string
  factoryAddress!: string
  operatorAddress!: string
  wallets: {[key: string]: ethers.Wallet} = {}
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
  operatorContract!: ethers.Contract
  HOLOGRAPH_ADDRESS = '0xD11a467dF6C80835A1223473aB9A48bF72eFCF4D'.toLowerCase()
  LAYERZERO_RECEIVERS: any = {
    rinkeby: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
    mumbai: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
    fuji: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
  }

  needToSubscribe = false

  targetEvents: Record<string, string> = {
    BridgeableContractDeployed: '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b',
    '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b': 'BridgeableContractDeployed',

    Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': 'Transfer',

    AvailableJob: '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11',
    '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11': 'AvailableJob',
  }

  constructor(options: NetworkMonitorOptions) {
    this.parent = options.parent
    this.configFile = options.configFile
    this.LAST_BLOCKS_FILE_NAME = options.lastBlockFilename || 'blocks.json'
    this.networks = options.networks
    this.log = this.parent.log.bind(this.parent)
    this.debug = options.debug.bind(this.parent)
    this.processBlock = options.processBlock.bind(this.parent)
    if (options.userWallet !== undefined) {
      this.userWallet = options.userWallet
    }

    // Color the networks 🌈
    for (let i = 0, l = this.networks.length; i < l; i++) {
      const network = this.networks[i]
      this.networkColors[network] = color.hex(NETWORK_COLORS[network])
    }
  }

  async run(continuous: boolean, blockJobs: {[key: string]: BlockJob[]} = {}): Promise<void> {
    await this.initializeEthers()

    this.log(`Holograph address: ${this.HOLOGRAPH_ADDRESS}`)
    this.log(`Bridge address: ${this.bridgeAddress}`)
    this.log(`Factory address: ${this.factoryAddress}`)
    this.log(`Operator address: ${this.operatorAddress}`)

    this.blockJobs = blockJobs

    for (const network of this.networks) {
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

  disconnectBuilder(network: string, rpcEndpoint: string, subscribe: boolean): (err: any) => void {
    return (err: any) => {
      ;(this.providers[network] as ethers.providers.WebSocketProvider).destroy().then(() => {
        this.debug('onDisconnect')
        this.structuredLog(network, `WS connection was closed ${JSON.stringify(err, null, 2)}`)
        this.providers[network] = this.failoverWebSocketProvider(network, rpcEndpoint, subscribe)
        if (this.userWallet !== undefined) {
          this.wallets[network] = this.userWallet.connect(this.providers[network] as ethers.providers.WebSocketProvider)
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
      }

      if (network in this.latestBlockHeight && this.latestBlockHeight[network] > 0) {
        this.structuredLog(network, `Resuming Operator from block height ${this.latestBlockHeight[network]}`)
        this.currentBlockHeight[network] = this.latestBlockHeight[network]
      } else {
        this.structuredLog(network, `Starting Operator from latest block height`)
        this.latestBlockHeight[network] = 0
        this.currentBlockHeight[network] = 0
      }
    }

    const holographABI = await fs.readJson('./src/abi/Holograph.json')
    this.holograph = new ethers.Contract(
      this.HOLOGRAPH_ADDRESS.toLowerCase(),
      holographABI,
      this.providers[this.networks[0]],
    )
    this.bridgeAddress = (await this.holograph.getBridge()).toLowerCase()
    this.factoryAddress = (await this.holograph.getFactory()).toLowerCase()
    this.operatorAddress = (await this.holograph.getOperator()).toLowerCase()

    const holographBridgeABI = await fs.readJson('./src/abi/HolographBridge.json')
    this.bridgeContract = new ethers.Contract(this.bridgeAddress, holographBridgeABI, this.providers[this.networks[0]])

    const holographFactoryABI = await fs.readJson('./src/abi/HolographFactory.json')
    this.factoryContract = new ethers.Contract(
      this.factoryAddress,
      holographFactoryABI,
      this.providers[this.networks[0]],
    )

    const holographOperatorABI = await fs.readJson('./src/abi/HolographOperator.json')
    this.operatorContract = new ethers.Contract(
      this.operatorAddress,
      holographOperatorABI,
      this.providers[this.networks[0]],
    )
  }

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

  blockJobMonitor = (network: string): void => {
    if (Date.now() - this.lastBlockJobDone[network] > this.blockJobThreshold) {
      this.debug('Block Job Handler has been inactive longer than threshold time. Restarting.')
      this.blockJobHandler(network)
    }
  }

  jobHandlerBuilder: (network: string) => () => void = (network: string): (() => void) => {
    return () => {
      this.blockJobHandler.bind(this)(network)
    }
  }

  blockJobHandler = (network: string, job?: BlockJob): void => {
    if (job !== undefined) {
      this.latestBlockHeight[job.network] = job.block
    }

    this.lastBlockJobDone[network] = Date.now()
    if (this.blockJobs[network].length > 0) {
      const blockJob: BlockJob = this.blockJobs[network].shift() as BlockJob
      this.processBlock(blockJob)
    } else if (this.needToSubscribe) {
      setTimeout(this.jobHandlerBuilder.bind(this)(network), 1000)
    } else {
      this.structuredLog(network, 'All jobs done for network')
      clearInterval(this.blockJobMonitorProcess[network])
      this.runningProcesses -= 1
      if (this.runningProcesses === 0) {
        this.log('finished the last job', 'need to output data and exit')
        this.exitRouter({exit: true}, 'SIGINT')
      }
    }
  }

  networkSubscribe(network: string): void {
    this.providers[network].on('block', (blockNumber: string) => {
      const block = Number.parseInt(blockNumber, 10)
      if (this.currentBlockHeight[network] !== 0 && block - this.currentBlockHeight[network] > 1) {
        this.debug(`Dropped ${capitalize(network)} websocket connection, gotta do some catching up`)
        let latest = this.currentBlockHeight[network]
        while (block - latest > 0) {
          this.structuredLog(network, `Block ${latest} (Syncing)`)
          this.blockJobs[network].push({
            network: network,
            block: latest,
          })
          latest++
        }
      }

      this.currentBlockHeight[network] = block
      this.structuredLog(network, `Block ${block}`)
      this.blockJobs[network].push({
        network: network,
        block: block,
      } as BlockJob)
    })
  }

  structuredLog(network: string, msg: string): void {
    const timestamp = new Date(Date.now()).toISOString()
    const timestampColor = color.keyword('green')

    this.log(
      `[${timestampColor(timestamp)}] [${this.parent.constructor.name}] [${this.networkColors[network](
        capitalize(network),
      )}] -> ${msg}`,
    )
  }
}
