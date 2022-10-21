import * as fs from 'fs-extra'
import {Command, Flags} from '@oclif/core'
import {BigNumber, Contract} from 'ethers'
import {TransactionResponse, TransactionReceipt} from '@ethersproject/abstract-provider'
import {TransactionDescription} from '@ethersproject/abi'

import {ensureConfigFileIsValid, supportedNetworks} from '../../utils/config'
import {Environment, getEnvironment} from '../../utils/environment'
import {toAscii, getNetworkByHolographId, sha3, storageSlot} from '../../utils/utils'

import {FilterType, BlockJob, NetworkMonitor, TransactionType} from '../../utils/network-monitor'

enum LogType {
  ContractDeployment = 'ContractDeployment',
  AvailableJob = 'AvailableJob',
}

type TransactionLog = {
  messageTx: string
  messageNetwork: string
  messageBlock: number
  logType: LogType
}

interface Scope {
  network: string
  startBlock: number
  endBlock: number
}

interface ContractDeployment extends TransactionLog {
  address: string
  networks: string[]
}

interface AvailableJob extends TransactionLog {
  jobHash: string
  bridgeTx: string
  bridgeNetwork: string
  bridgeBlock: number
  jobType: TransactionType
  completed: boolean
  operatorTx: string
  operatorNetwork: string
  operatorBlock: number
}

export default class Analyze extends Command {
  static description = 'Extract all operator jobs and get their status'
  static examples = [
    `$ holograph analyze --scope='{"network":"eht_goerli","startBlock":10857626,"endBlock":11138178}' --scope='{"network":"mumbai","startBlock":26758573,"endBlock":27457918}' --scope='{"network":"fuji","startBlock":11406945,"endBlock":12192217}'`,
  ]

  static flags = {
    scope: Flags.string({
      description: 'JSON object of blocks to analyze "{ network: string, startBlock: number, endBlock: number }"',
      multiple: true,
    }),
    output: Flags.string({
      description: 'Specify a file to output the results to (ie "~/Desktop/analyzeResults.json")',
      default: `./${getEnvironment()}.analyzeResults.json`,
      multiple: false,
    }),
  }

  environment!: Environment
  outputFile!: string
  collectionMap: {[key: string]: boolean} = {}
  operatorJobIndexMap: {[key: string]: number} = {}
  operatorJobCounterMap: {[key: string]: number} = {}
  transactionLogs: (ContractDeployment | AvailableJob)[] = []
  networkMonitor!: NetworkMonitor

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    const {flags} = await this.parse(Analyze)
    this.log('Loading user configurations...')
    const {environment, configFile} = await ensureConfigFileIsValid(this.config.configDir, undefined, false)
    this.log('User configurations loaded.')
    this.environment = environment
    const {networks, scopeJobs} = this.scopeItOut(flags.scope as string[])
    this.log(`${JSON.stringify(scopeJobs, undefined, 2)}`)

    this.outputFile = flags.output as string
    if (await fs.pathExists(this.outputFile)) {
      this.transactionLogs = (await fs.readJson(this.outputFile)) as (ContractDeployment | AvailableJob)[]
      let i = 0
      for (const logRaw of this.transactionLogs) {
        if (logRaw.logType === LogType.AvailableJob) {
          const log: AvailableJob = logRaw as AvailableJob
          this.operatorJobIndexMap[log.jobHash] = i
          this.operatorJobCounterMap[log.jobHash] = 0
          if ('messageTx' in log && log.messageTx !== '') {
            this.operatorJobCounterMap[log.jobHash] += 1
          }

          if ('bridgeTx' in log && log.bridgeTx !== '') {
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
          let endBlock: number = scopeJob.endBlock
          // Allow syncing up to current block height if endBlock is set to 0
          if (endBlock === 0) {
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

  /**
   * Keeps track of the operator jobs
   */
  manageOperatorJobMaps(index: number, operatorJobHash: string, beam: AvailableJob): void {
    if (index >= 0) {
      this.transactionLogs[index] = beam
      this.operatorJobCounterMap[operatorJobHash] = 1
    } else {
      this.operatorJobIndexMap[operatorJobHash] = this.transactionLogs.push(beam) - 1
      this.operatorJobCounterMap[operatorJobHash] += 1
    }

    if (this.operatorJobCounterMap[operatorJobHash] === 3) {
      delete this.operatorJobIndexMap[operatorJobHash]
      delete this.operatorJobCounterMap[operatorJobHash]
    }
  }

  /**
   * Validates that the input scope is valid and using a supported network
   */
  validateScope(scope: Scope, networks: string[], scopeJobs: Scope[]): void {
    if ('network' in scope && 'startBlock' in scope && 'endBlock' in scope) {
      if (supportedNetworks.includes(scope.network)) {
        if (!networks.includes(scope.network)) {
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

  /**
   * Checks all the input scopes and validates them
   */
  scopeItOut(scopeFlags: string[]): {networks: string[]; scopeJobs: Scope[]} {
    const networks: string[] = []
    const scopeJobs: Scope[] = []
    for (const scopeString of scopeFlags) {
      try {
        const scope: Scope = JSON.parse(scopeString) as Scope
        this.validateScope(scope, networks, scopeJobs)
      } catch {
        this.log(`${scopeString} is an invalid Scope JSON object`)
      }
    }

    return {networks, scopeJobs}
  }

  exitCallback(): void {
    fs.writeFileSync(this.outputFile, JSON.stringify(this.transactionLogs, undefined, 2))
  }

  /**
   * Build the filters to search for events via the network monitor
   */
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

  /**
   * Process the transactions in each block job
   */
  async processTransactions(job: BlockJob, transactions: TransactionResponse[]): Promise<void> {
    /* eslint-disable no-await-in-loop */
    if (transactions.length > 0) {
      for (const transaction of transactions) {
        const tags: (string | number)[] = []
        tags.push(transaction.blockNumber as number, this.networkMonitor.randomTag())
        this.networkMonitor.structuredLog(job.network, `Processing transaction ${transaction.hash}`, tags)
        const to: string | undefined = transaction.to?.toLowerCase()
        const from: string | undefined = transaction.from?.toLowerCase()
        if (to === this.networkMonitor.bridgeAddress) {
          // We have bridge job
          this.log('handleBridgeOutEvent')
          await this.handleBridgeOutEvent(transaction, job.network, tags)
        } else if (to === this.networkMonitor.operatorAddress) {
          // We have a bridge job being executed
          // Check that it worked?
          this.log('handleBridgeInEvent')
          await this.handleBridgeInEvent(transaction, job.network, tags)
        } else if (from === this.networkMonitor.LAYERZERO_RECEIVERS[job.network]) {
          // We have an available operator job event
          this.log('handleAvailableOperatorJobEvent')
          await this.handleAvailableOperatorJobEvent(transaction, job.network, tags)
        } else {
          this.networkMonitor.structuredLog(
            job.network,
            `Function processTransactions stumbled on an unknown transaction ${transaction.hash}`,
            tags,
          )
        }
      }
    }
  }

  /**
   * Finds bridge out events and keeps track of them
   */
  async handleBridgeOutEvent(
    transaction: TransactionResponse,
    network: string,
    tags: (string | number)[],
  ): Promise<void> {
    const receipt: TransactionReceipt | null = await this.networkMonitor.getTransactionReceipt({
      network,
      transactionHash: transaction.hash,
      attempts: 10,
      canFail: true,
    })
    if (receipt === null) {
      throw new Error(`Could not get receipt for ${transaction.hash}`)
    }

    if (receipt.status === 1) {
      let operatorJobHash: string | undefined
      let operatorJobPayload: string | undefined
      let args: any[] | undefined
      switch (this.environment) {
        case Environment.localhost:
          operatorJobHash = this.networkMonitor.decodeCrossChainMessageSentEvent(
            receipt,
            this.networkMonitor.operatorAddress,
          )
          if (operatorJobHash !== undefined) {
            args = this.networkMonitor.decodeLzEvent(receipt, this.networkMonitor.lzEndpointAddress[network])
            if (args !== undefined) {
              operatorJobPayload = args[2] as string
            }
          }

          break
        default:
          operatorJobHash = this.networkMonitor.decodeCrossChainMessageSentEvent(
            receipt,
            this.networkMonitor.operatorAddress,
          )
          if (operatorJobHash !== undefined) {
            operatorJobPayload = this.networkMonitor.decodeLzPacketEvent(receipt)
          }

          break
      }

      if (operatorJobHash === undefined) {
        this.networkMonitor.structuredLog(network, `Could not find a bridgeOutRequest for ${transaction.hash}`, tags)
      } else {
        // check that operatorJobPayload and operatorJobHash are the same
        if (sha3(operatorJobPayload) !== operatorJobHash) {
          throw new Error('The hashed operatorJobPayload does not equal operatorJobHash!')
        }

        const index: number =
          operatorJobHash in this.operatorJobIndexMap ? this.operatorJobIndexMap[operatorJobHash] : -1
        const beam: AvailableJob =
          index >= 0 ? (this.transactionLogs[index] as AvailableJob) : ({completed: false} as AvailableJob)
        beam.logType = LogType.AvailableJob
        beam.jobHash = operatorJobHash
        beam.bridgeTx = transaction.hash
        beam.bridgeNetwork = network
        beam.bridgeBlock = transaction.blockNumber!
        const parsedTransaction: TransactionDescription | null =
          this.networkMonitor.bridgeContract.interface.parseTransaction(transaction)
        if (parsedTransaction === null) {
          beam.jobType = TransactionType.unknown
        } else {
          const toNetwork: string = getNetworkByHolographId(parsedTransaction.args[0])
          beam.messageNetwork = toNetwork
          beam.operatorNetwork = toNetwork
          const holographableContractAddress: string = (parsedTransaction.args[1] as string).toLowerCase()
          if (holographableContractAddress === this.networkMonitor.factoryAddress) {
            beam.jobType = TransactionType.deploy
          } else {
            const slot: string = await this.networkMonitor.providers[network].getStorageAt(
              holographableContractAddress,
              storageSlot('eip1967.Holograph.contractType'),
            )
            const contractType: string = toAscii(slot)
            if (contractType === 'HolographERC20') {
              beam.jobType = TransactionType.erc20
            } else if (contractType === 'HolographERC721' || contractType === 'CxipERC721') {
              beam.jobType = TransactionType.erc721
            }
          }
        }

        this.networkMonitor.structuredLog(network, `Found a valid bridgeOutRequest for ${transaction.hash}`, tags)
        this.manageOperatorJobMaps(index, operatorJobHash, beam)
      }
    }
  }

  /**
   * Handle the AvailableOperatorJob event from the Holograph Operator, when one is picked up while processing transactions
   */
  async handleAvailableOperatorJobEvent(
    transaction: TransactionResponse,
    network: string,
    tags: (string | number)[],
  ): Promise<void> {
    const receipt: TransactionReceipt | null = await this.networkMonitor.getTransactionReceipt({
      network,
      transactionHash: transaction.hash,
      attempts: 10,
      canFail: true,
    })
    if (receipt === null) {
      throw new Error(`Could not get receipt for ${transaction.hash}`)
    }

    if (receipt.status === 1) {
      const args: any[] | undefined = this.networkMonitor.decodeAvailableOperatorJobEvent(
        receipt,
        this.networkMonitor.operatorAddress,
      )
      const operatorJobHash: string | undefined = args === undefined ? undefined : sha3(args[0])
      const operatorJobPayload: string | undefined = args === undefined ? undefined : sha3(args[1])
      if (operatorJobHash === undefined) {
        this.networkMonitor.structuredLog(
          network,
          `Could not find an availableOperatorJob event for ${transaction.hash}`,
          tags,
        )
      } else {
        // check that operatorJobPayload and operatorJobHash are the same
        if (sha3(operatorJobPayload) !== operatorJobHash) {
          throw new Error('The hashed operatorJobPayload does not equal operatorJobHash!')
        }

        const index: number =
          operatorJobHash in this.operatorJobIndexMap ? this.operatorJobIndexMap[operatorJobHash] : -1
        const beam: AvailableJob = index >= 0 ? (this.transactionLogs[index] as AvailableJob) : ({} as AvailableJob)
        beam.logType = LogType.AvailableJob
        beam.jobHash = operatorJobHash
        beam.messageTx = transaction.hash
        beam.messageNetwork = network
        beam.messageBlock = transaction.blockNumber!
        if (!beam.completed) {
          beam.completed = await this.validateOperatorJob(transaction.hash, network, operatorJobPayload!, tags)
        }

        this.networkMonitor.structuredLog(network, `Found a valid availableOperatorJob for ${transaction.hash}`, tags)
        this.manageOperatorJobMaps(index, operatorJobHash, beam)
      }
    }
  }

  /**
   * Finds bridge in events and keeps track of them
   */
  async handleBridgeInEvent(
    transaction: TransactionResponse,
    network: string,
    tags: (string | number)[],
  ): Promise<void> {
    const receipt: TransactionReceipt | null = await this.networkMonitor.getTransactionReceipt({
      network,
      transactionHash: transaction.hash,
      attempts: 10,
      canFail: true,
    })
    if (receipt === null) {
      throw new Error(`Could not get receipt for ${transaction.hash}`)
    }

    if (receipt.status === 1) {
      const parsedTransaction: TransactionDescription =
        this.networkMonitor.operatorContract.interface.parseTransaction(transaction)
      if (parsedTransaction.name === 'executeJob') {
        const args: any[] | undefined = Object.values(parsedTransaction.args)
        const operatorJobPayload: string | undefined = args === undefined ? undefined : sha3(args[0])
        const operatorJobHash: string | undefined =
          operatorJobPayload === undefined ? undefined : sha3(operatorJobPayload)
        if (operatorJobHash === undefined) {
          this.networkMonitor.structuredLog(network, `Could not find a bridgeInRequest for ${transaction.hash}`, tags)
        } else {
          const index: number =
            operatorJobHash in this.operatorJobIndexMap ? this.operatorJobIndexMap[operatorJobHash] : -1
          const beam: AvailableJob =
            index >= 0 ? (this.transactionLogs[index] as AvailableJob) : ({completed: false} as AvailableJob)
          beam.logType = LogType.AvailableJob
          beam.operatorTx = transaction.hash
          beam.operatorBlock = transaction.blockNumber!
          beam.completed = true

          const bridgeTransaction: TransactionDescription | null =
            this.networkMonitor.bridgeContract.interface.parseTransaction(transaction)
          if (parsedTransaction === null) {
            beam.jobType = TransactionType.unknown
          } else {
            const fromNetwork: string = getNetworkByHolographId(bridgeTransaction.args[1])
            beam.bridgeNetwork = fromNetwork
            const holographableContractAddress: string = (bridgeTransaction.args[2] as string).toLowerCase()
            if (holographableContractAddress === this.networkMonitor.factoryAddress) {
              beam.jobType = TransactionType.deploy
            } else {
              const slot: string = await this.networkMonitor.providers[network].getStorageAt(
                holographableContractAddress,
                storageSlot('eip1967.Holograph.contractType'),
              )
              const contractType: string = toAscii(slot)
              if (contractType === 'HolographERC20') {
                beam.jobType = TransactionType.erc20
              } else if (contractType === 'HolographERC721' || contractType === 'CxipERC721') {
                beam.jobType = TransactionType.erc721
              }
            }
          }

          this.networkMonitor.structuredLog(network, `Found a valid bridgeOutRequest for ${transaction.hash}`, tags)
          this.manageOperatorJobMaps(index, operatorJobHash, beam)
        }
      } else {
        this.networkMonitor.structuredLog(network, `Unknown bridge function executed for ${transaction.hash}`, tags)
      }
    }
  }

  /**
   * Checks if the operator job is valid and has not already been executed
   */
  async validateOperatorJob(
    transactionHash: string,
    network: string,
    payload: string,
    tags: (string | number)[],
  ): Promise<boolean> {
    const contract: Contract = this.networkMonitor.operatorContract.connect(this.networkMonitor.providers[network])
    const gasLimit: BigNumber | null = await this.networkMonitor.getGasLimit({
      network,
      contract,
      methodName: 'executeJob',
      args: [payload],
    })
    if (gasLimit === null) {
      this.networkMonitor.structuredLog(network, `Transaction: ${transactionHash} has already been done`, tags)
      return true
    }

    this.networkMonitor.structuredLog(network, `Transaction: ${transactionHash} job needs to be done`, tags)
    return false
  }
}
