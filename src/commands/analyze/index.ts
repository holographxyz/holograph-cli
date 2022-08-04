import * as fs from 'fs-extra'
import * as path from 'node:path'

import {Command, Flags} from '@oclif/core'
import {ethers} from 'ethers'

import {CONFIG_FILE_NAME, ensureConfigFileIsValid} from '../../utils/config'
import {ConfigFile, ConfigNetwork, ConfigNetworks} from '../../utils/config'

import {capitalize, NETWORK_COLORS} from '../../utils/utils'
import color from '@oclif/color'

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

interface Scope {
  network: string
  startBlock: number
  endBlock: number
}

const keepAlive = ({provider, onDisconnect, expectedPongBack = 15_000, checkInterval = 7500}: KeepAliveParams) => {
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

export default class Analyze extends Command {
  static LAST_BLOCKS_FILE_NAME = 'analyze-blocks.json'
  static description = 'Extract all operator jobs and get their status'
  static examples = [
    `$ holo analyze --scope='[{"network":"rinkeby","startBlock":10857626,"endBlock":11138178},{"network":"mumbai","startBlock":26758573,"endBlock":27457918},{"network":"fuji","startBlock":11406945,"endBlock":12192217}]'`,
  ]

  static flags = {
    scope: Flags.string({
      description:
        'single-line JSON object array of blocks to analyze "[{ network: string, startBlock: number, endBlock: number }]"',
      multiple: true,
    }),
  }

  runningProcesses = 0

  bridgeAddress!: string
  operatorAddress!: string
  providers: {[key: string]: ethers.providers.JsonRpcProvider | ethers.providers.WebSocketProvider} = {}
  abiCoder = ethers.utils.defaultAbiCoder
  holograph!: ethers.Contract
  bridgeContract!: ethers.Contract
  operatorContract!: ethers.Contract
  HOLOGRAPH_ADDRESS = '0xD11a467dF6C80835A1223473aB9A48bF72eFCF4D'.toLowerCase()
  LAYERZERO_RECEIVERS: any = {
    rinkeby: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
    mumbai: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
    fuji: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
  }

  targetEvents: Record<string, string> = {
    AvailableJob: '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11',
    '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11': 'AvailableJob',
  }

  networkColors: any = {}
  blockJobs: {[key: string]: BlockJob[]} = {}

  exited = false

  disconnectBuilder(network: string, rpcEndpoint: string): (err: any) => void {
    return (err: any) => {
      ;(this.providers[network] as ethers.providers.WebSocketProvider).destroy().then(() => {
        this.log(network, 'WS connection was closed', JSON.stringify(err, null, 2))
        this.providers[network] = this.failoverWebSocketProvider.bind(this)(network, rpcEndpoint)
      })
    }
  }

  failoverWebSocketProvider(network: string, rpcEndpoint: string): ethers.providers.WebSocketProvider {
    const provider = new ethers.providers.WebSocketProvider(rpcEndpoint)
    keepAlive({
      provider,
      onDisconnect: this.disconnectBuilder.bind(this)(network, rpcEndpoint),
    })
    this.providers[network] = provider
    return provider
  }

  async initializeEthers(loadNetworks: string[], configFile: ConfigFile): Promise<void> {
    for (let i = 0, l = loadNetworks.length; i < l; i++) {
      const network = loadNetworks[i]
      const rpcEndpoint = (configFile.networks[network as keyof ConfigNetworks] as ConfigNetwork).providerUrl
      const protocol = new URL(rpcEndpoint).protocol
      switch (protocol) {
        case 'https:':
          this.providers[network] = new ethers.providers.JsonRpcProvider(rpcEndpoint)

          break
        case 'wss:':
          this.providers[network] = this.failoverWebSocketProvider.bind(this)(network, rpcEndpoint)
          break
        default:
          throw new Error('Unsupported RPC provider protocol -> ' + protocol)
      }
    }

    const holographABI = await fs.readJson('./src/abi/Holograph.json')
    this.holograph = new ethers.Contract(
      this.HOLOGRAPH_ADDRESS.toLowerCase(),
      holographABI,
      this.providers[loadNetworks[0]],
    )
    this.bridgeAddress = (await this.holograph.getBridge()).toLowerCase()
    this.operatorAddress = (await this.holograph.getOperator()).toLowerCase()

    const holographBridgeABI = await fs.readJson('./src/abi/HolographBridge.json')
    this.bridgeContract = new ethers.Contract(this.bridgeAddress, holographBridgeABI, this.providers[loadNetworks[0]])

    const holographOperatorABI = await fs.readJson('./src/abi/HolographOperator.json')
    this.operatorContract = new ethers.Contract(
      this.operatorAddress,
      holographOperatorABI,
      this.providers[loadNetworks[0]],
    )
  }

  exitHandler = async (exitCode: number): Promise<void> => {
    /**
     * Before exit, save the block heights to the local db
     */
    if (this.exited === false) {
      this.log('')
      this.log(`Exiting operator with code ${exitCode}...`)
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
        this.log(`Exiting operator with code ${exitCode}...`)
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

  async run(): Promise<void> {
    const {flags} = await this.parse(Analyze)

    this.log('Loading user configurations...')
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    const {configFile} = await ensureConfigFileIsValid(configPath, undefined, false)
    this.log('User configurations loaded.')
    const networks: string[] = []
    const scopeJobs: Scope[] = []
    for (const scopeString of flags.scope) {
      try {
        const scopeArray: {[key: string]: string | number}[] = JSON.parse(scopeString) as {
          [key: string]: string | number
        }[]
        for (const scope of scopeArray) {
          if ('network' in scope && 'startBlock' in scope && 'endBlock' in scope) {
            if (Object.keys(configFile.networks).includes(scope.network as string)) {
              if (!networks.includes(scope.network as string)) {
                networks.push(scope.network as string)
              }

              scopeJobs.push(scope as unknown as Scope)
            } else {
              this.log(`${scope.network} is not a supported network`)
            }
          } else {
            this.log(`${scope} is an invalid Scope object`)
          }
        }
      } catch {
        this.log(`${scopeString} is an invalid Scope[] JSON object`)
      }
    }

    this.log(`${JSON.stringify(scopeJobs, undefined, 4)}`)

    // Color the networks 🌈
    for (let i = 0, l = networks.length; i < l; i++) {
      const network = networks[i]
      this.networkColors[network] = color.hex(NETWORK_COLORS[network])
    }

    await this.initializeEthers(networks, configFile)

    this.log(`Holograph address: ${this.HOLOGRAPH_ADDRESS}`)
    this.log(`Bridge address: ${this.bridgeAddress}`)
    this.log(`Operator address: ${this.operatorAddress}`)

    // Setup websocket subscriptions and start processing blocks
    for (let i = 0, l = networks.length; i < l; i++) {
      const network: string = networks[i]
      this.blockJobs[network] = []
      this.lastBlockJobDone[network] = Date.now()
      for (const scopeJob of scopeJobs) {
        if (scopeJob.network === network) {
          for (let n = scopeJob.startBlock, nl = scopeJob.endBlock; n <= nl; n++) {
            this.blockJobs[network].push({
              network: network,
              block: n,
            } as BlockJob)
          }
        }
      }

      this.runningProcesses += 1
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

  async processBlock(job: BlockJob): Promise<void> {
    const block = await this.providers[job.network].getBlockWithTransactions(job.block)
    if (block !== null && 'transactions' in block) {
      if (block.transactions.length === 0) {
        this.structuredLog(job.network, `Zero block transactions for block ${job.block}`)
      }

      const interestingTransactions = []
      for (let i = 0, l = block.transactions.length; i < l; i++) {
        const transaction = block.transactions[i]
        if (transaction.from.toLowerCase() === this.LAYERZERO_RECEIVERS[job.network]) {
          // We have LayerZero call, need to check it it's directed towards Holograph operators
          interestingTransactions.push(transaction)
        } else if ('to' in transaction && transaction.to !== null && transaction.to !== '') {
          const to: string = transaction.to!.toLowerCase()
          // Check if it's a factory call
          if (to === this.bridgeAddress) {
            // we have a bridge call identified
            // check that the transaction status = true
            interestingTransactions.push(transaction)
          } else if (to === this.operatorAddress) {
            // this means an operator job has been executed
            // maybe cross-reference it to see if it's part of a transaction we are monitoring?
            interestingTransactions.push(transaction)
          }
        }
      }

      if (interestingTransactions.length > 0) {
        this.structuredLog(
          job.network,
          `Found ${interestingTransactions.length} interesting transactions on block ${job.block}`,
        )
        this.processTransactions(job, interestingTransactions)
      } else {
        this.blockJobHandler(job.network)
      }
    } else {
      this.structuredLog(job.network, `${job.network} ${color.red('Dropped block!')} ${job.block}`)
      this.blockJobs[job.network].unshift(job)
      this.blockJobHandler(job.network)
    }
  }

  blockJobThreshold = 15_000 // 15 seconds
  lastBlockJobDone: {[key: string]: number} = {}
  blockJobMonitorProcess: {[key: string]: NodeJS.Timer} = {}

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

  blockJobHandler = (network: string): void => {
    this.lastBlockJobDone[network] = Date.now()
    if (this.blockJobs[network].length > 0) {
      const blockJob: BlockJob = this.blockJobs[network].shift() as BlockJob
      this.processBlock(blockJob)
    } else {
      this.structuredLog(network, 'all jobs done for network')
      clearInterval(this.blockJobMonitorProcess[network])
      this.runningProcesses -= 1
      if (this.runningProcesses === 0) {
        this.log('finished the last job', 'need to output data and exit')
        this.exitRouter({exit: true}, 'SIGINT')
      }
    }
  }

  async processTransactions(job: BlockJob, transactions: ethers.Transaction[]): Promise<void> {
    /* eslint-disable no-await-in-loop */
    if (transactions.length > 0) {
      for (const transaction of transactions) {
        const receipt = await this.providers[job.network].getTransactionReceipt(transaction.hash as string)
        if (receipt === null) {
          throw new Error(`Could not get receipt for ${transaction.hash}`)
        }

        this.debug(`Processing transaction ${transaction.hash} on ${job.network} at block ${receipt.blockNumber}`)
        const to: string | undefined = transaction.to?.toLowerCase()
        const from: string | undefined = transaction.from?.toLowerCase()
        if (to === this.bridgeAddress) {
          // we have bridge job
          await this.handleBridgeOutEvent(transaction, receipt, job.network)
        } else if (to === this.operatorAddress) {
          // we have a bridge job being executed
          // check that it worked?
          await this.handleBridgeInEvent(transaction, receipt, job.network)
        } else if (from === this.LAYERZERO_RECEIVERS[job.network]) {
          // we have an available operator job event
          await this.handleAvailableOperatorJobEvent(transaction, receipt, job.network)
        } else {
          this.structuredLog(
            job.network,
            `processTransactions function stumbled on an unknown transaction ${transaction.hash}`,
          )
        }
      }
    }

    this.blockJobHandler(job.network)
  }

  async handleBridgeOutEvent(
    transaction: ethers.Transaction,
    receipt: ethers.ContractReceipt,
    network: string,
  ): Promise<void> {
    // 0xa1caf2ea == erc721out
    // 0xa45561bb == erc20out
    // 0xa4bd02d7 == deployOut
    // let functionSignature: string = transaction.data.substring(0, 10).toLowerCase()
    const parsedTransaction: ethers.utils.TransactionDescription =
      this.bridgeContract.interface.parseTransaction(transaction)
    switch (parsedTransaction.sighash) {
      case '0xa1caf2ea':
      case '0xa45561bb':
      case '0xa4bd02d7':
        // deployOut
        this.structuredLog(
          network,
          `Bridge-Out event captured: ${parsedTransaction.name} -->> ${parsedTransaction.args}`,
        )
        break
      default:
        this.structuredLog(network, `Unknown Bridge function executed in tx: ${transaction.hash}`)
        break
    }
  }

  async handleBridgeInEvent(
    transaction: ethers.Transaction,
    receipt: ethers.ContractReceipt,
    network: string,
  ): Promise<void> {
    const parsedTransaction: ethers.utils.TransactionDescription =
      this.operatorContract.interface.parseTransaction(transaction)
    let bridgeTransaction: ethers.utils.TransactionDescription
    switch (parsedTransaction.name) {
      case 'executeJob':
        this.structuredLog(
          network,
          `Bridge-In event captured: ${parsedTransaction.name} -->> ${parsedTransaction.args}`,
        )
        bridgeTransaction = this.bridgeContract.interface.parseTransaction({
          data: parsedTransaction.args._payload,
          value: ethers.BigNumber.from('0'),
        })
        this.structuredLog(
          network,
          `Bridge-In trasaction type: ${bridgeTransaction.name} -->> ${bridgeTransaction.args}`,
        )
        break
      default:
        this.structuredLog(network, `Unknown Bridge function executed in tx: ${transaction.hash}`)
        break
    }
  }

  async handleAvailableOperatorJobEvent(
    transaction: ethers.Transaction,
    receipt: ethers.ContractReceipt,
    network: string,
  ): Promise<void> {
    this.structuredLog(
      network,
      `Checking if Operator was sent a bridge job via the LayerZero Relayer at tx: ${transaction.hash}`,
    )
    let event = null
    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
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
                `The Operator at ${this.operatorAddress}`,
            )
          }
        }
      }

      if (event) {
        const payload = this.abiCoder.decode(['bytes'], event)[0]
        this.structuredLog(
          network,
          `HolographOperator received a new bridge job on ${network} with job payload: ${payload}\n`,
        )
        await this.validateOperatorJob(transaction.hash!, network, payload)
      }
    }
  }

  async validateOperatorJob(transactionHash: string, network: string, payload: string): Promise<void> {
    const contract: ethers.Contract = this.operatorContract.connect(this.providers[network])
    let hasError = false
    try {
      await contract.estimateGas.executeJob(payload)
    } catch (error: any) {
      this.error(error.reason)
      hasError = true
    }

    if (hasError) {
      this.structuredLog(network, `${transactionHash} has already been done`)
    } else {
      this.structuredLog(network, `${transactionHash} job needs to be done`)
    }
  }

  structuredLog(network: string, msg: string): void {
    const timestamp = new Date(Date.now()).toISOString()
    const timestampColor = color.keyword('green')

    this.log(
      `[${timestampColor(timestamp)}] [${this.constructor.name}] [${this.networkColors[network](
        capitalize(network),
      )}] -> ${msg}`,
    )
  }
}
