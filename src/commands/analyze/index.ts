import * as fs from 'fs-extra'
import {Command, Flags} from '@oclif/core'
import {ethers} from 'ethers'

import {ConfigFile, ensureConfigFileIsValid} from '../../utils/config'

import {FilterType, BlockJob, Scope, NetworkMonitor} from '../../utils/network-monitor'

enum LogType {
  ContractDeployment = 'ContractDeployment',
  AvailableJob = 'AvailableJob',
}

enum TransactionType {
  unknown = 'unknown',
  erc20 = 'erc20',
  erc721 = 'erc721',
  deploy = 'deploy',
}

type TransactionLog = {
  tx: string
  network: string
  block: number
  logType: LogType
}

interface ContractDeployment extends TransactionLog {
  address: string
  networks: string[]
}

interface AvailableJob extends TransactionLog {
  jobHash: string
  originTx: string
  originNetwork: string
  originBlock: number
  jobType: TransactionType
  completed: boolean
  operatorTx: string
  operatorBlock: number
}

export default class Analyze extends Command {
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
    output: Flags.string({
      description: 'specify a file to output the results to (ie "~/Desktop/analyze_results.json")',
      default: './analyze_results.json',
      multiple: false,
    }),
  }

  static iface: ethers.utils.Interface = new ethers.utils.Interface([])
  static packetEventFragment: ethers.utils.EventFragment = ethers.utils.EventFragment.from('Packet(uint16 chainId, bytes payload)')
  static availableJobEventFragment: ethers.utils.EventFragment = ethers.utils.EventFragment.from('AvailableJob(bytes payload)')

  decodePacketEvent(receipt: ethers.ContractReceipt): string | undefined {
    const toFind = this.networkMonitor.operatorAddress.slice(2, 42)
    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (log.topics[0] === this.networkMonitor.targetEvents.Packet) {
          const packetPayload = Analyze.iface.decodeEventLog(Analyze.packetEventFragment, log.data, log.topics)[1] as string
          if (packetPayload.indexOf(toFind) > 0) {
            const payload = '0x' + packetPayload.split(this.networkMonitor.operatorAddress.slice(2, 42).repeat(2))[1]
            return ethers.utils.keccak256(payload)
          }
        }
      }
    }

    return undefined
  }

  decodeAvailableJobEvent(receipt: ethers.ContractReceipt): string | undefined {
    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        const log = receipt.logs[i]
        if (log.address.toLowerCase() === this.networkMonitor.operatorAddress && log.topics[0] === this.networkMonitor.targetEvents.AvailableJob) {
          return Analyze.iface.decodeEventLog(Analyze.availableJobEventFragment, log.data, log.topics)[0] as string
        }
      }
    }

    return undefined
  }

  outputFile!: string
  collectionMap: {[key: string]: boolean} = {}
  operatorJobIndexMap: {[key: string]: number} = {}
  operatorJobCounterMap: {[key: string]: number} = {}
  transactionLogs: (ContractDeployment | AvailableJob)[] = []
  networkMonitor!: NetworkMonitor

  manageOperatorJobMaps(index: number, operatorJobHash: string, operatorJob: AvailableJob): void {
    if (index >= 0) {
      this.transactionLogs[index] = operatorJob
      this.operatorJobCounterMap[operatorJobHash] = 1
    } else {
      this.operatorJobIndexMap[operatorJobHash] = this.transactionLogs.push(operatorJob) - 1
      this.operatorJobCounterMap[operatorJobHash] += 1
    }

    if (this.operatorJobCounterMap[operatorJobHash] === 3) {
      delete this.operatorJobIndexMap[operatorJobHash]
      delete this.operatorJobCounterMap[operatorJobHash]
    }
  }

  validateScope(scope: Scope, configFile: ConfigFile, networks: string[], scopeJobs: Scope[]): void {
    if ('network' in scope && 'startBlock' in scope && 'endBlock' in scope) {
      if (Object.keys(configFile.networks).includes(scope.network as string)) {
        if (!networks.includes(scope.network as string)) {
          networks.push(scope.network as string)
        }

        scopeJobs.push(scope)
      } else {
        this.log(`${scope.network} is not a supported network`)
      }
    } else {
      this.log(`${scope} is an invalid Scope object`)
    }
  }

  scopeItOut(configFile: ConfigFile, scopeFlags: string[]): {networks: string[]; scopeJobs: Scope[]} {
    const networks: string[] = []
    const scopeJobs: Scope[] = []
    for (const scopeString of scopeFlags) {
      try {
        const scopeArray: Scope[] = JSON.parse(scopeString)
        for (const scope of scopeArray) {
          this.validateScope(scope, configFile, networks, scopeJobs)
        }
      } catch {
        this.log(`${scopeString} is an invalid Scope[] JSON object`)
      }
    }

    return {networks, scopeJobs}
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Analyze)
    this.log('Loading user configurations...')
    const {configFile} = await ensureConfigFileIsValid(this.config.configDir, undefined, false)
    this.log('User configurations loaded.')

    const {networks, scopeJobs} = this.scopeItOut(configFile, flags.scope)
    this.log(`${JSON.stringify(scopeJobs, undefined, 2)}`)

    this.outputFile = flags.output as string
    if (await fs.pathExists(this.outputFile)) {
      this.transactionLogs = await fs.readJson(this.outputFile) as (ContractDeployment | AvailableJob)[]
      let i = 0
      for (const logRaw of this.transactionLogs) {
        if (logRaw.logType === LogType.AvailableJob) {
          const log: AvailableJob = logRaw as AvailableJob
          this.operatorJobIndexMap[log.jobHash] = i
          this.operatorJobCounterMap[log.jobHash] = 0
          if ('tx' in log && log.tx !== '') {
            this.operatorJobCounterMap[log.jobHash] += 1
          }

          if ('originTx' in log && log.originTx !== '') {
            this.operatorJobCounterMap[log.jobHash] += 1
          }

          if ('operatorTx' in log && log.operatorTx !== '') {
            this.operatorJobCounterMap[log.jobHash] += 1
          }

          if (this.operatorJobIndexMap[log.jobHash] === 3) {
            delete this.operatorJobIndexMap[log.jobHash]
            delete this.operatorJobCounterMap[log.jobHash]
          }
        }

        i++
      }
    }

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      networks,
      debug: this.debug,
      processTransactions: this.processTransactions,
    })

    const blockJobs: {[key: string]: BlockJob[]} = {}

    // Setup websocket subscriptions and start processing blocks
    for (let i = 0, l = networks.length; i < l; i++) {
      const network: string = networks[i]
      blockJobs[network] = []
      for (const scopeJob of scopeJobs) {
        if (scopeJob.network === network) {
          // Allow syncing up to current block height if endBlock is set to 0
          let endBlock = scopeJob.endBlock
          if (scopeJob.endBlock === 0) {
            /* eslint-disable no-await-in-loop */
            endBlock = await this.networkMonitor.providers[network].getBlockNumber()
          }

          for (let n = scopeJob.startBlock, nl = endBlock; n <= nl; n++) {
            blockJobs[network].push({
              network: network,
              block: n,
            } as BlockJob)
          }
        }
      }
    }

    this.networkMonitor.exitCallback = this.exitCallback.bind(this)
    await this.networkMonitor.run(false, blockJobs, this.filterBuilder)
  }

  exitCallback(): void {
    fs.writeFileSync(this.outputFile, JSON.stringify(this.transactionLogs, undefined, 2))
  }

  async filterBuilder(): Promise<void> {
    this.networkMonitor.filters = [
      {
        type: FilterType.from,
        match: this.networkMonitor.LAYERZERO_RECEIVERS,
        networkDependant: true,
      },
      {
        type: FilterType.to,
        match: this.networkMonitor.bridgeAddress,
        networkDependant: false,
      },
      {
        type: FilterType.to,
        match: this.networkMonitor.operatorAddress,
        networkDependant: false,
      },
    ]
    Promise.resolve()
  }

  async processTransactions(job: BlockJob, transactions: ethers.providers.TransactionResponse[]): Promise<void> {
    /* eslint-disable no-await-in-loop */
    if (transactions.length > 0) {
      for (const transaction of transactions) {
        this.networkMonitor.structuredLog(
          job.network,
          `Processing transaction ${transaction.hash} on ${job.network} at block ${transaction.blockNumber}`,
        )
        const to: string | undefined = transaction.to?.toLowerCase()
        const from: string | undefined = transaction.from?.toLowerCase()
        if (to === this.networkMonitor.bridgeAddress) {
          // We have bridge job
          await this.handleBridgeOutEvent(transaction, job.network)
        } else if (to === this.networkMonitor.operatorAddress) {
          // We have a bridge job being executed
          // Check that it worked?
          await this.handleBridgeInEvent(transaction, job.network)
        } else if (from === this.networkMonitor.LAYERZERO_RECEIVERS[job.network]) {
          // We have an available operator job event
          await this.handleAvailableOperatorJobEvent(transaction, job.network)
        } else {
          this.networkMonitor.structuredLog(
            job.network,
            `Function processTransactions stumbled on an unknown transaction ${transaction.hash}`,
          )
        }
      }
    }
  }

  async handleBridgeOutEvent(transaction: ethers.providers.TransactionResponse, network: string): Promise<void> {
    const receipt = await this.networkMonitor.providers[network].getTransactionReceipt(transaction.hash)
    if (receipt === null) {
      throw new Error(`Could not get receipt for ${transaction.hash}`)
    }

    // make sure the transaction has succeeded before trying to process it
    if (receipt.status === 1) {
      const operatorJobHash = this.decodePacketEvent(receipt)
      if (operatorJobHash === undefined) {
        this.networkMonitor.structuredLog(network, `Could not extract cross-chain packet for ${transaction.hash}`)
      } else {
        const index: number = (operatorJobHash in this.operatorJobIndexMap) ? this.operatorJobIndexMap[operatorJobHash] : -1
        const operatorJob: AvailableJob = index >= 0 ? this.transactionLogs[index] as AvailableJob : {completed: false} as AvailableJob
        operatorJob.logType = LogType.AvailableJob
        operatorJob.jobHash = operatorJobHash
        operatorJob.originTx = transaction.hash
        operatorJob.originNetwork = network
        operatorJob.originBlock = transaction.blockNumber!
        const parsedTransaction: ethers.utils.TransactionDescription = this.networkMonitor.bridgeContract.interface.parseTransaction(transaction)
        switch (parsedTransaction.name) {
          case 'deployOut':
            operatorJob.jobType = TransactionType.deploy
            break
          case 'erc20out':
            operatorJob.jobType = TransactionType.erc20
            break
          case 'erc721out':
            operatorJob.jobType = TransactionType.erc721
            break
          default:
            operatorJob.jobType = TransactionType.unknown
            break
        }

        switch (parsedTransaction.name) {
          case 'deployOut':
          case 'erc20out':
          case 'erc721out':
            this.networkMonitor.structuredLog(
              network,
              `Bridge-Out event captured: ${parsedTransaction.name} -->> ${parsedTransaction.args}`,
            )
            break
          default:
            this.networkMonitor.structuredLog(network, `Unknown Bridge function executed in tx: ${transaction.hash}`)
            break
        }

        this.manageOperatorJobMaps(index, operatorJobHash, operatorJob)
      }
    }
  }

  async handleBridgeInEvent(transaction: ethers.providers.TransactionResponse, network: string): Promise<void> {
    const parsedTransaction: ethers.utils.TransactionDescription = this.networkMonitor.operatorContract.interface.parseTransaction(transaction)
    let bridgeTransaction: ethers.utils.TransactionDescription
    let operatorJobHash: string
    let index: number
    let operatorJob: AvailableJob
    let receipt: ethers.ContractReceipt
    switch (parsedTransaction.name) {
      case 'executeJob':
        receipt = await this.networkMonitor.providers[network].getTransactionReceipt(transaction.hash)
        if (receipt === null) {
          throw new Error(`Could not get receipt for ${transaction.hash}`)
        }

        // make sure the transaction has succeeded before trying to process it
        if (receipt.status === 1) {
          this.networkMonitor.structuredLog(
            network,
            `Bridge-In event captured: ${parsedTransaction.name} -->> ${parsedTransaction.args}`,
          )
          operatorJobHash = ethers.utils.keccak256(parsedTransaction.args._payload)
          index = (operatorJobHash in this.operatorJobIndexMap) ? this.operatorJobIndexMap[operatorJobHash] : -1
          operatorJob = index >= 0 ? this.transactionLogs[index] as AvailableJob : {completed: false} as AvailableJob
          operatorJob.logType = LogType.AvailableJob
          operatorJob.operatorTx = transaction.hash
          operatorJob.operatorBlock = transaction.blockNumber!
          // we mark the job as completed since the bridge job is done
          operatorJob.completed = true
          bridgeTransaction = this.networkMonitor.bridgeContract.interface.parseTransaction({
            data: parsedTransaction.args._payload,
            value: ethers.BigNumber.from('0'),
          })
          switch (bridgeTransaction.name) {
            case 'deployIn':
              operatorJob.jobType = TransactionType.deploy
              break
            case 'erc20in':
              operatorJob.jobType = TransactionType.erc20
              break
            case 'erc721in':
              operatorJob.jobType = TransactionType.erc721
              break
            default:
              operatorJob.jobType = TransactionType.unknown
              break
          }

          this.manageOperatorJobMaps(index, operatorJobHash, operatorJob)
          this.networkMonitor.structuredLog(
            network,
            `Bridge-In trasaction type: ${bridgeTransaction.name} -->> ${bridgeTransaction.args}`,
          )
        }

        break
      default:
        this.networkMonitor.structuredLog(network, `Unknown Bridge function executed in tx: ${transaction.hash}`)
        break
    }
  }

  async handleAvailableOperatorJobEvent(transaction: ethers.providers.TransactionResponse, network: string): Promise<void> {
    const receipt = await this.networkMonitor.providers[network].getTransactionReceipt(transaction.hash)
    if (receipt === null) {
      throw new Error(`Could not get receipt for ${transaction.hash}`)
    }

    // make sure the transaction has succeeded before trying to process it
    if (receipt.status === 1) {
      const operatorJobPayload = this.decodeAvailableJobEvent(receipt)
      const operatorJobHash = operatorJobPayload === undefined ? undefined : ethers.utils.keccak256(operatorJobPayload)
      if (operatorJobHash === undefined) {
        this.networkMonitor.structuredLog(network, `Could not extract relayer available job for ${transaction.hash}`)
      } else {
        const index: number = (operatorJobHash in this.operatorJobIndexMap) ? this.operatorJobIndexMap[operatorJobHash] : -1
        const operatorJob: AvailableJob = index >= 0 ? this.transactionLogs[index] as AvailableJob : {} as AvailableJob
        operatorJob.logType = LogType.AvailableJob
        operatorJob.jobHash = operatorJobHash
        operatorJob.tx = transaction.hash
        operatorJob.network = network
        operatorJob.block = transaction.blockNumber!
        if (!operatorJob.completed) {
          operatorJob.completed = await this.validateOperatorJob(transaction.hash, network, operatorJobPayload!)
        }

        this.manageOperatorJobMaps(index, operatorJobHash, operatorJob)
      }
    }
  }

  async validateOperatorJob(transactionHash: string, network: string, payload: string): Promise<boolean> {
    const contract: ethers.Contract = this.networkMonitor.operatorContract.connect(
      this.networkMonitor.providers[network],
    )
    let hasError = false
    try {
      await contract.estimateGas.executeJob(payload)
    } catch (error: any) {
      hasError = true
      if (error.reason !== 'execution reverted: HOLOGRAPH: invalid job') {
        this.networkMonitor.structuredLog(network, error.reason)
      }
    }

    if (hasError) {
      this.networkMonitor.structuredLog(network, `Transaction: ${transactionHash} has already been done`)
      return true
    }

      this.networkMonitor.structuredLog(network, `Transaction: ${transactionHash} job needs to be done`)
      return false

  }
}
