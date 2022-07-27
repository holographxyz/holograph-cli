import * as fs from 'fs-extra'
import * as path from 'node:path'
import axios from 'axios'

import {CliUx, Command, Flags} from '@oclif/core'
import {ethers} from 'ethers'

import {CONFIG_FILE_NAME, ConfigFile, ConfigNetwork, ConfigNetworks, ensureConfigFileIsValid} from '../../utils/config'
import networks from '../../utils/networks'

import {decodeDeploymentConfig, decodeDeploymentConfigInput, capitalize, NETWORK_COLORS} from '../../utils/utils'
import color from '@oclif/color'

import dotenv from 'dotenv'
import {startHealcheckServer} from '../../utils/health-check-server'
dotenv.config()

enum IndexerMode {
  listen,
  manual,
  auto,
}

type KeepAliveParams = {
  provider: ethers.providers.WebSocketProvider
  onDisconnect: (err: any) => void
  expectedPongBack?: number
  checkInterval?: number
}

type BlockJob = {
  network: string
  block: number
}

const keepAlive = ({provider, onDisconnect, expectedPongBack = 15_000, checkInterval = 7500}: KeepAliveParams) => {
  let pingTimeout: NodeJS.Timeout | null = null
  let keepAliveInterval: NodeJS.Timeout | null = null

  provider._websocket.on('open', () => {
    keepAliveInterval = setInterval(() => {
      provider._websocket.ping()

      // Use `WebSocket#terminate()`, which immediately destroys the connection,
      // instead of `WebSocket#close()`, which waits for the close timer.
      // Delay should be equal to the interval at which your server
      // sends out pings plus a conservative assumption of the latency.
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

export default class Indexer extends Command {
  static LAST_BLOCKS_FILE_NAME = 'blocks.json'
  static description = 'Listen for EVM events and update database network status'
  static examples = ['$ holo indexer --networks="rinkeby mumbai fuji" --mode=auto']
  static flags = {
    networks: Flags.string({description: 'Comma separated list of networks to operate to', multiple: true}),
    mode: Flags.string({
      description: 'The mode in which to run the indexer',
      options: ['listen', 'manual', 'auto'],
      char: 'm',
    }),
    host: Flags.string({description: 'The host to listen on', char: 'h', default: 'http://localhost:9001'}),
  }

  /**
   * Indexer class variables
   */
  bridgeAddress: string | undefined
  factoryAddress: string | undefined
  operatorAddress: string | undefined
  supportedNetworks: string[] = ['rinkeby', 'mumbai', 'fuji']
  blockJobs: BlockJob[] = []
  providers: {[key: string]: ethers.providers.JsonRpcProvider | ethers.providers.WebSocketProvider} = {}
  abiCoder = ethers.utils.defaultAbiCoder
  wallets: {[key: string]: ethers.Wallet} = {}
  holograph!: ethers.Contract
  indexerMode: IndexerMode = IndexerMode.listen
  indexerContract!: ethers.Contract
  HOLOGRAPH_ADDRESS = '0xD11a467dF6C80835A1223473aB9A48bF72eFCF4D'.toLowerCase()
  LAYERZERO_RECEIVERS: any = {
    rinkeby: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
    mumbai: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
    fuji: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
  }

  targetEvents: Record<string, string> = {
    BridgeableContractDeployed: '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b',
    '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b': 'BridgeableContractDeployed',

    Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': 'Transfer',

    AvailableJob: '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11',
    '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11': 'AvailableJob',
  }

  networkColors: any = {}
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - Set all networks to start with latest block at index 0
  latestBlockHeight: {[key: string]: number} = {}
  exited = false

  // API Params
  baseUrl!: string
  JWT!: string

  async run(): Promise<void> {
    const {flags} = await this.parse(Indexer)
    this.baseUrl = flags.host

    let res
    try {
      res = await axios.post(`${this.baseUrl}/v1/auth/operator`, {
        hash: process.env.OPERATOR_API_KEY,
      })
    } catch (error: any) {
      this.error(error.message)
    }

    this.JWT = res!.data.accessToken

    // Indexer always runs in listen mode
    this.log(`Indexer mode: ${this.indexerMode}`)

    this.log('Loading user configurations...')
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    const {userWallet, configFile} = await ensureConfigFileIsValid(configPath, false)
    this.log('User configurations loaded.')

    // Indexer always synchronizes missed blocks
    this.latestBlockHeight = await this.loadLastBlocks(Indexer.LAST_BLOCKS_FILE_NAME, this.config.configDir)

    // Load defaults for the networks from the config file
    if (flags.networks === undefined || '') {
      flags.networks = Object.keys(configFile.networks)
    }

    // Color the networks 🌈
    for (let i = 0, l = flags.networks.length; i < l; i++) {
      const network = flags.networks[i]
      if (Object.keys(configFile.networks).includes(network)) {
        this.networkColors[network] = color.hex(NETWORK_COLORS[network])
      } else {
        // If network is not supported remove it from the array
        flags.networks.splice(i, 1)
        l--
        i--
      }
    }

    CliUx.ux.action.start(`Starting indexer in mode: ${IndexerMode[this.indexerMode]}`)
    await this.initializeEthers(flags.networks, configFile, userWallet, false)

    this.bridgeAddress = (await this.holograph.getBridge()).toLowerCase()
    this.factoryAddress = (await this.holograph.getFactory()).toLowerCase()
    this.operatorAddress = (await this.holograph.getOperator()).toLowerCase()

    this.log(`Holograph address: ${this.HOLOGRAPH_ADDRESS}`)
    this.log(`Bridge address: ${this.bridgeAddress}`)
    this.log(`Factory address: ${this.factoryAddress}`)
    this.log(`Indexer address: ${this.operatorAddress}`)
    CliUx.ux.action.stop('🚀')

    // Setup websocket subscriptions and start processing blocks
    for (let i = 0, l = flags.networks.length; i < l; i++) {
      const network = flags.networks[i]

      // Subscribe to events 🎧
      this.networkSubscribe(network)
    }

    // Catch all exit events
    for (const eventType of [`EEXIT`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `uncaughtException`, `SIGTERM`]) {
      process.on(eventType, this.exitRouter.bind(this, {exit: true}))
    }

    process.on('exit', this.exitHandler)

    // Start server
    startHealcheckServer()
    // // Process blocks 🧱
    this.blockJobHandler()
  }

  async loadLastBlocks(fileName: string, configDir: string): Promise<{[key: string]: number}> {
    const filePath = path.join(configDir, fileName)
    let lastBlocks: {[key: string]: number} = {}
    if (await fs.pathExists(filePath)) {
      lastBlocks = await fs.readJson(filePath)
    }

    return lastBlocks
  }

  saveLastBlocks(fileName: string, configDir: string, lastBlocks: {[key: string]: number}): void {
    const filePath = path.join(configDir, fileName)
    fs.writeFileSync(filePath, JSON.stringify(lastBlocks), 'utf8')
  }

  disconnectBuilder(
    userWallet: ethers.Wallet,
    network: string,
    rpcEndpoint: string,
    subscribe: boolean,
  ): (err: any) => void {
    return (err: any) => {
      ;(this.providers[network] as ethers.providers.WebSocketProvider).destroy().then(() => {
        this.debug('onDisconnect')
        this.log(network, 'WS connection was closed', JSON.stringify(err, null, 2))
        this.providers[network] = this.failoverWebSocketProvider(userWallet, network, rpcEndpoint, subscribe)
        this.wallets[network] = userWallet.connect(this.providers[network] as ethers.providers.WebSocketProvider)
      })
    }
  }

  failoverWebSocketProvider(
    userWallet: ethers.Wallet,
    network: string,
    rpcEndpoint: string,
    subscribe: boolean,
  ): ethers.providers.WebSocketProvider {
    this.debug('this.providers', network)
    const provider = new ethers.providers.WebSocketProvider(rpcEndpoint)
    keepAlive({
      provider,
      onDisconnect: this.disconnectBuilder.bind(this)(userWallet, network, rpcEndpoint, true),
    })
    this.providers[network] = provider
    if (subscribe) {
      this.networkSubscribe(network)
    }

    return provider
  }

  async initializeEthers(
    loadNetworks: string[],
    configFile: ConfigFile,
    userWallet: ethers.Wallet | undefined,
    subscribe: boolean,
  ): Promise<void> {
    for (let i = 0, l = loadNetworks.length; i < l; i++) {
      const network = loadNetworks[i]
      const rpcEndpoint = (configFile.networks[network as keyof ConfigNetworks] as ConfigNetwork).providerUrl
      const protocol = new URL(rpcEndpoint).protocol
      switch (protocol) {
        case 'https:':
          this.providers[network] = new ethers.providers.JsonRpcProvider(rpcEndpoint)

          break
        case 'wss:':
          this.providers[network] = this.failoverWebSocketProvider(userWallet!, network, rpcEndpoint, subscribe)
          break
        default:
          throw new Error('Unsupported RPC provider protocol -> ' + protocol)
      }

      if (userWallet !== undefined) {
        this.wallets[network] = userWallet.connect(this.providers[network])
      }

      if (network in this.latestBlockHeight && this.latestBlockHeight[network] > 0) {
        this.structuredLog(network, `Resuming Indexer from block height ${this.latestBlockHeight[network]}`)
      } else {
        this.structuredLog(network, `Starting Indexer from latest block height`)
        this.latestBlockHeight[network] = 0
      }
    }

    // Well known private key only required to initlaize wallet with provider
    const privateKey = '0x0123456789012345678901234567890123456789012345678901234567890123'
    const walletWithProvider = new ethers.Wallet(privateKey, this.providers.rinkeby)

    const holographABI = await fs.readJson('./src/abi/Holograph.json')
    this.holograph = new ethers.ContractFactory(holographABI, '0x', walletWithProvider).attach(
      this.HOLOGRAPH_ADDRESS.toLowerCase(),
    )

    const holographIndexerABI = await fs.readJson('./src/abi/HolographOperator.json')
    this.indexerContract = new ethers.ContractFactory(holographIndexerABI, '0x', walletWithProvider).attach(
      await this.holograph.getOperator(),
    )
  }

  exitHandler = async (exitCode: number): Promise<void> => {
    /**
     * Before exit, save the block heights to the local db
     */
    if (this.exited === false) {
      this.log('')
      this.log(`Saving current block heights: ${JSON.stringify(this.latestBlockHeight)}`)
      this.saveLastBlocks(Indexer.LAST_BLOCKS_FILE_NAME, this.config.configDir, this.latestBlockHeight)
      this.log(`Exiting indexer with code ${exitCode}...`)
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
        this.log(`Saving current block heights:\n${JSON.stringify(this.latestBlockHeight, undefined, 2)}`)
        this.saveLastBlocks(Indexer.LAST_BLOCKS_FILE_NAME, this.config.configDir, this.latestBlockHeight)
        this.log(`Exiting indexer with code ${exitCode}...`)
        this.log('Goodbye! 👋')
        this.exited = true
      }

      this.debug(`\nExit code ${exitCode}`)
      if (options.exit) {
        // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
        process.exit()
      }
    } else {
      this.debug(`\nError: ${exitCode}`)
    }
  }

  async processBlock(job: BlockJob): Promise<void> {
    this.debug(`processing [${job.network}] ${job.block}`)
    const block = await this.providers[job.network].getBlockWithTransactions(job.block)
    if (block !== null && 'transactions' in block) {
      if (block.transactions.length === 0) {
        this.structuredLog(job.network, `Zero block transactions for block ${job.block}`)
      }

      const interestingTransactions = []
      for (let i = 0, l = block.transactions.length; i < l; i++) {
        const transaction = block.transactions[i]
        if (transaction.from.toLowerCase() === this.LAYERZERO_RECEIVERS[job.network]) {
          // We have LayerZero call, need to check it it's directed towards Holograph indexers
          interestingTransactions.push(transaction)
        } else if ('to' in transaction && transaction.to !== null && transaction.to !== '') {
          const to: string | undefined = transaction.to?.toLowerCase()
          // Check if it's a factory call
          if (to === this.factoryAddress || to === this.operatorAddress) {
            // We have a potential factory deployment or indexer bridge transaction
            interestingTransactions.push(transaction)
          }
        }
      }

      if (interestingTransactions.length > 0) {
        this.structuredLog(
          job.network,
          `Found ${interestingTransactions.length} interesting transactions on block ${job.block}`,
        )
        this.processTransactions(job.network, interestingTransactions)
      } else {
        this.blockJobHandler()
      }
    } else {
      this.structuredLog(job.network, `${job.network} ${color.red('Dropped block!')} ${job.block}`)
      this.blockJobs.unshift(job)
      this.blockJobHandler()
    }
  }

  // For some reason defining this as function definition causes `this` to be undefined
  blockJobHandler = (): void => {
    if (this.blockJobs.length > 0) {
      const blockJob: BlockJob = this.blockJobs.shift() as BlockJob
      this.processBlock(blockJob)
    } else {
      this.debug('no blocks')
      setTimeout(this.blockJobHandler, 1000)
    }
  }

  async processTransactions(network: string, transactions: ethers.Transaction[]): Promise<void> {
    /* eslint-disable no-await-in-loop */
    if (transactions.length > 0) {
      for (const transaction of transactions) {
        const receipt = await this.providers[network].getTransactionReceipt(transaction.hash as string)
        if (receipt === null) {
          throw new Error(`Could not get receipt for ${transaction.hash}`)
        }

        this.debug(`Processing transaction ${transaction.hash} on ${network} at block ${receipt.blockNumber}`)
        if (transaction.to?.toLowerCase() === this.factoryAddress) {
          this.handleContractDeployedEvents(transaction, receipt, network)
        } else if (transaction.to?.toLowerCase() === this.operatorAddress) {
          this.handleIndexerBridgeEvents(transaction, receipt, network)
        } else {
          this.handleIndexerRequestEvents(transaction, receipt, network)
        }
      }
    }

    this.blockJobHandler()
  }

  handleContractDeployedEvents(
    transaction: ethers.Transaction,
    receipt: ethers.ContractReceipt,
    network: string,
  ): void {
    this.structuredLog(network, `Checking if a new Holograph contract was deployed at tx: ${transaction.hash}`)
    const config = decodeDeploymentConfigInput(transaction.data)
    let event = null
    if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        if (event === null) {
          const log = receipt.logs[i]
          if (log.topics.length > 0 && log.topics[0] === this.targetEvents.BridgeableContractDeployed) {
            event = log.topics
            break
          } else {
            this.structuredLog(network, `BridgeableContractDeployed event not found in ${transaction.hash}`)
          }
        }
      }

      if (event) {
        const deploymentAddress = '0x' + event[1].slice(26)
        this.structuredLog(
          network,
          `\nHolographFactory deployed a new collection on ${capitalize(network)} at address ${deploymentAddress}\n` +
            `Wallet that deployed the collection is ${transaction.from}\n` +
            `The config used for deployHolographableContract was ${JSON.stringify(config, null, 2)}\n` +
            `The transaction hash is: ${transaction.hash}\n`,
        )
      }
    }
  }

  async handleIndexerRequestEvents(
    transaction: ethers.Transaction,
    receipt: ethers.ContractReceipt,
    network: string,
  ): Promise<void> {
    this.structuredLog(
      network,
      `Checking if Indexer was sent a bridge job via the LayerZero Relayer at tx: ${transaction.hash}`,
    )
    let event = null
    if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        if (event === null) {
          const log = receipt.logs[i]
          if (
            log.address.toLowerCase() === this.operatorAddress &&
            log.topics.length > 0 &&
            log.topics[0] === this.targetEvents.AvailableJob
          ) {
            event = log.data
          } else {
            this.structuredLog(
              network,
              `LayerZero transaction is not relevant to AvailableJob event. ` +
                `Transaction was relayed to ${log.address} instead of ` +
                `The Indexer at ${this.operatorAddress}`,
            )
          }
        }
      }

      if (event) {
        const payload = this.abiCoder.decode(['bytes'], event)[0]
        this.structuredLog(
          network,
          `HolographIndexer received a new bridge job on ${capitalize(network)}\nThe job payload is ${payload}\n`,
        )
      }
    }
  }

  async handleIndexerBridgeEvents(
    transaction: ethers.Transaction,
    receipt: ethers.ContractReceipt,
    network: string,
  ): Promise<void> {
    this.structuredLog(
      network,
      `Checking if an indexer executed a job to bridge a contract / collection at tx: ${transaction.hash}`,
    )
    let event = null
    if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        if (event === null) {
          const log = receipt.logs[i]
          if (log.topics.length > 0 && log.topics[0] === this.targetEvents.BridgeableContractDeployed) {
            event = log.topics
          }
        }
      }
    } else {
      this.structuredLog(network, 'Failed to find BridgeableContractDeployed event from indexer job')
    }

    if (event) {
      const deploymentInput = this.abiCoder.decode(['bytes'], '0x' + transaction.data.slice(10))[0]
      const config = decodeDeploymentConfig(this.abiCoder.decode(['bytes'], '0x' + deploymentInput.slice(10))[0])
      const deploymentAddress = '0x' + event[1].slice(26)
      this.structuredLog(
        network,
        '\nHolographIndexer executed a job which bridged a collection\n' +
          `HolographFactory deployed a new collection on ${capitalize(network)} at address ${deploymentAddress}\n` +
          `Indexer that deployed the collection is ${transaction.from}` +
          `The config used for deployHolographableContract function was ${JSON.stringify(config, null, 2)}\n`,
      )

      // First get the collection by the address
      let res
      try {
        res = await axios.get(`${this.baseUrl}/v1/collections/contract/${deploymentAddress}`, {
          headers: {
            Authorization: `Bearer ${this.JWT}`,
            'Content-Type': 'application/json',
          },
        })
        this.debug(JSON.stringify(res.data))
        this.structuredLog(network, `Successfully found collection at ${deploymentAddress}`)
      } catch (error: any) {
        this.structuredLog(network, `Failed to update the Holograph database ${error.message}`)
      }

      // Compose request to API server to update the collection
      const data = JSON.stringify({
        chainId: networks[network].chain,
        status: 'DEPLOYED',
        salt: '0x',
        tx: transaction.hash,
      })

      const params = {
        headers: {
          Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
          'Content-Type': 'application/json',
        },
        data: data,
      }

      try {
        const patchRes = await axios.patch(`${this.baseUrl}/v1/collections/${res?.data.id}`, data, params)
        this.debug(patchRes.data)
        this.structuredLog(network, `Successfully updated collection chainId to ${networks[network].chain}`)
      } catch (error: any) {
        this.structuredLog(network, `Failed to update the Holograph database ${error.message}`)
        this.debug(error)
      }
    }

    // Check if the indexer executed a job to bridge an NFT
    event = null
    this.structuredLog(network, `Checking if an indexer executed a job to bridge an NFT at tx: ${transaction.hash}`)
    if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        if (event === null) {
          const log = receipt.logs[i]
          if (log.topics.length > 0 && log.topics[0] === this.targetEvents.Transfer) {
            event = log.topics
          }
        }
      }
    } else {
      this.structuredLog(network, 'Failed to find Transfer event from indexer job')
    }

    // Compose request to API server to update the NFT
    if (event) {
      this.debug(event)
      const deploymentInput = this.abiCoder.decode(['bytes'], '0x' + transaction.data.slice(10))[0]
      const tokenId = Number.parseInt(event[3], 16)
      const contractAddress = '0x' + deploymentInput.slice(98, 138)

      this.structuredLog(network, `Requesting to get NFT with tokenId ${tokenId} from ${contractAddress}`)
      let res
      try {
        res = await axios.get(`${this.baseUrl}/v1/nfts/${contractAddress}/${tokenId}`, {
          headers: {
            Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
            'Content-Type': 'application/json',
          },
        })
        this.structuredLog(network, `Successfully found NFT with tokenId ${tokenId} from ${contractAddress}`)
      } catch (error: any) {
        this.structuredLog(network, error.message)
        this.debug(error)
      }

      // Compose request to API server to update the nft
      const data = JSON.stringify({
        chainId: networks[network].chain,
        status: 'MINTED',
        tx: transaction.hash,
      })

      const params = {
        headers: {
          Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
          'Content-Type': 'application/json',
        },
        data: data,
      }

      this.structuredLog(network, `Requesting to update NFT with id ${res?.data.id}`)
      try {
        const patchRes = await axios.patch(`${this.baseUrl}/v1/nfts/${res?.data.id}`, data, params)
        this.structuredLog(network, JSON.stringify(patchRes.data))
        this.structuredLog(network, `Successfully updated NFT chainId to ${networks[network].chain}`)
      } catch (error: any) {
        this.structuredLog(network, `Failed to update the database ${error.message}`)
        this.debug(error)
      }
    }
  }

  structuredLog(network: string, msg: string): void {
    const timestamp = new Date(Date.now()).toISOString()
    const timestampColor = color.keyword('green')

    this.log(`[${timestampColor(timestamp)}] [${this.networkColors[network](capitalize(network))}] -> ${msg}`)
  }

  networkSubscribe(network: string): void {
    this.providers[network].on('block', (blockNumber: string) => {
      const block = Number.parseInt(blockNumber, 10)
      if (this.latestBlockHeight[network] !== 0 && block - this.latestBlockHeight[network] > 1) {
        this.debug(`Dropped ${capitalize(network)} websocket connection, gotta do some catching up`)
        let latest = this.latestBlockHeight[network]
        while (block - latest > 1) {
          this.structuredLog(network, `Block ${latest} (Syncing)`)
          this.blockJobs.push({
            network: network,
            block: latest,
          })
          latest++
        }
      }

      this.latestBlockHeight[network] = block
      this.structuredLog(network, `Block ${block}`)
      this.blockJobs.push({
        network: network,
        block: block,
      } as BlockJob)
    })
  }
}
