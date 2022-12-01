import * as fs from 'fs-extra'

import {Command, Flags} from '@oclif/core'
import {Contract} from '@ethersproject/contracts'
import {BigNumber} from '@ethersproject/bignumber'
import {TransactionResponse, TransactionReceipt} from '@ethersproject/abstract-provider'
import {TransactionDescription} from '@ethersproject/abi'
import {Environment, getEnvironment} from '@holographxyz/environment'
import {
  networks,
  getNetworkByHolographId,
  supportedNetworks,
  supportedShortNetworks,
  getNetworkByShortKey,
} from '@holographxyz/networks'

import {ensureConfigFileIsValid} from '../../utils/config'
import {toAscii, sha3, storageSlot} from '../../utils/utils'
import {FilterType, BlockJob, NetworkMonitor, TransactionType} from '../../utils/network-monitor'
import ApiService from '../../services/api-service'
import {CrossChainTransaction, TransactionStatus, Logger} from '../../types/api'

enum LogType {
  ContractDeployment = 'ContractDeployment',
  AvailableJob = 'AvailableJob',
}

type TransactionLog = {
  messageTx: string
  messageNetwork: string
  messageBlock: number
  messageAddress: string
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
  jobType: TransactionType
  jobHash: string
  bridgeTx: string
  bridgeNetwork: string
  bridgeBlock: number
  bridgeAddress: string
  operatorTx: string
  operatorNetwork: string
  operatorBlock: number
  operatorAddress: string
  completed: boolean
}

interface RawData {
  data?: string
  tokenId?: string
  collection?: string
  holographId?: number
  operatorJobPayload?: string
  from?: string
  to?: string
}

const getCorrectValue = (val1: any, val2: any) => (val1 && val1 !== val2 ? val1 : val2)
const getTxStatus = (tx?: string, currentStatus?: string) => {
  let status: TransactionStatus
  if (typeof currentStatus === 'string' && currentStatus === TransactionStatus.COMPLETED) {
    status = currentStatus
  } else if (typeof tx === 'string') {
    status = TransactionStatus.COMPLETED
  } else {
    status = TransactionStatus.PENDING
  }

  return status
}

export default class Analyze extends Command {
  static hidden = true
  static description = 'Extract all operator jobs and get their status'
  static examples = [
    `$ <%= config.bin %> <%= command.id %> --scope='{"network":"goerli","startBlock":10857626,"endBlock":11138178}' --scope='{"network":"mumbai","startBlock":26758573,"endBlock":27457918}' --scope='{"network":"fuji","startBlock":11406945,"endBlock":12192217}' --updateApiUrl='https://api.holograph.xyz'`,
  ]

  static flags = {
    scope: Flags.string({
      description: 'JSON object of blocks to analyze "{ network: string, startBlock: number, endBlock: number }"',
      multiple: true,
    }),
    scopeFile: Flags.string({
      description: 'JSON file path of blocks to analyze (ie "./scopeFile.json")',
      exclusive: ['scope'],
      required: false,
    }),
    output: Flags.string({
      description: 'Specify a file to output the results to (ie "../../analyzeResults.json")',
      default: `./${getEnvironment()}.analyzeResults.json`,
      multiple: false,
    }),
    updateApiUrl: Flags.string({
      description: 'Update database cross-chain table with correct beam status',
    }),
  }

  environment!: Environment
  outputFile!: string
  collectionMap: {[key: string]: boolean} = {}
  operatorJobIndexMap: {[key: string]: number} = {}
  operatorJobCounterMap: {[key: string]: number} = {}
  transactionLogs: (ContractDeployment | AvailableJob)[] = []
  networkMonitor!: NetworkMonitor
  blockJobs: {[key: string]: BlockJob[]} = {}
  apiService!: ApiService | undefined

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    const {flags} = await this.parse(Analyze)
    const updateApiUrl = flags.updateApiUrl

    this.log('Loading user configurations...')
    const {environment, configFile} = await ensureConfigFileIsValid(this.config.configDir, undefined, false)
    this.log('User configurations loaded.')
    this.environment = environment

    if (updateApiUrl !== undefined) {
      try {
        const logger: Logger = {
          log: this.log,
          warn: this.warn,
          debug: this.debug,
          error: this.error,
          jsonEnabled: () => false,
        }
        this.apiService = new ApiService(updateApiUrl, logger)
        await this.apiService.operatorLogin()
      } catch (error: any) {
        this.error(error)
      }
    }

    const {networks, scopeJobs} = await this.scopeItOut(flags.scope, flags.scopeFile)
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

    const injectBlocks = async (): Promise<void> => {
      // Setup websocket subscriptions and start processing blocks
      for (let i = 0, l = networks.length; i < l; i++) {
        const network: string = networks[i]
        blockJobs[network] = []
        for (const scopeJob of scopeJobs) {
          if (scopeJob.network === network) {
            let endBlock: number = scopeJob.endBlock
            // Allow syncing up to current block height if endBlock is set to 0
            if (endBlock === 0) {
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

      await this.filterBuilder()
    }

    this.networkMonitor.exitCallback = this.exitCallback.bind(this)
    await this.networkMonitor.run(false, blockJobs, injectBlocks.bind(this))
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
      if (supportedShortNetworks.includes(scope.network)) {
        scope.network = getNetworkByShortKey(scope.network).key
      }

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
  async scopeItOut(scopeFlags?: string[], scopeFile?: string): Promise<{networks: string[]; scopeJobs: Scope[]}> {
    const networks: string[] = []
    const scopeJobs: Scope[] = []

    if (scopeFlags === undefined && scopeFile === undefined) {
      this.error('scope or scopeFile should be informed')
    }

    if (scopeFlags) {
      for (const scopeString of scopeFlags) {
        try {
          const scope: Scope = JSON.parse(scopeString) as Scope
          this.validateScope(scope, networks, scopeJobs)
        } catch {
          this.log(`${scopeString} is an invalid Scope JSON object`)
        }
      }
    } else if (scopeFile) {
      if (!(await fs.pathExists(scopeFile))) {
        this.error(`Problem reading ${scopeFile}`)
      }

      try {
        const scopes = (await fs.readJson(scopeFile)) as Scope[]
        for (const scope of scopes) this.validateScope(scope, networks, scopeJobs)
      } catch {
        this.error(`One or more lines are an invalid Scope JSON object`)
      }
    } else {
      this.error(`Invalid scope`)
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
    return Promise.resolve()
  }

  /**
   * Update cross chain transaction on DB
   */
  async updateBeamStatusDB(beam: AvailableJob, rawData?: RawData): Promise<void> {
    if (this.apiService === undefined) {
      throw new Error('API service is not defined')
    }

    let crossChainTx: CrossChainTransaction
    let updatedTx: CrossChainTransaction

    try {
      crossChainTx = await this.apiService.getCrossChainTransaction(beam.jobHash)
    } catch (error: any) {
      this.error(error)
    }

    const sourceChainId: number = networks[beam.bridgeNetwork].chain
    const messageChainId: number = networks[beam.messageNetwork].chain
    const operatorChainId: number = networks[beam.operatorNetwork].chain

    if (crossChainTx) {
      if (
        crossChainTx.sourceStatus === TransactionStatus.COMPLETED &&
        crossChainTx.messageStatus === TransactionStatus.COMPLETED &&
        crossChainTx.operatorStatus === TransactionStatus.COMPLETED &&
        crossChainTx.sourceAddress !== undefined &&
        crossChainTx.messageAddress !== undefined &&
        crossChainTx.operatorAddress !== undefined &&
        crossChainTx.data !== undefined
      ) {
        this.log('Beaming is completed')
        return
      }

      if (
        (crossChainTx.sourceChainId && crossChainTx.sourceChainId !== sourceChainId) ||
        (crossChainTx.messageChainId && crossChainTx.messageChainId !== messageChainId) ||
        (crossChainTx.operatorChainId && crossChainTx.operatorChainId !== operatorChainId)
      ) {
        this.log('Job hash collision')
        return
      }

      updatedTx = crossChainTx

      updatedTx = {
        ...updatedTx,
        sourceTx: getCorrectValue(beam.bridgeTx, crossChainTx.sourceTx),
        sourceChainId: getCorrectValue(sourceChainId, crossChainTx.sourceChainId),
        sourceBlockNumber: getCorrectValue(beam.bridgeBlock, crossChainTx.sourceBlockNumber),
        sourceAddress: getCorrectValue(beam.operatorAddress, crossChainTx.sourceAddress),
        sourceStatus: getTxStatus(beam.bridgeTx, crossChainTx.sourceStatus),
        messageTx: getCorrectValue(beam.messageTx, crossChainTx.messageTx),
        messageChainId: getCorrectValue(messageChainId, crossChainTx.messageChainId),
        messageBlockNumber: getCorrectValue(beam.messageBlock, crossChainTx.messageBlockNumber),
        messageAddress: getCorrectValue(beam.messageAddress, crossChainTx.messageAddress),
        messageStatus: getTxStatus(beam.messageTx, crossChainTx.messageStatus),
        operatorTx: getCorrectValue(beam.operatorTx, crossChainTx.operatorTx),
        operatorChainId: getCorrectValue(operatorChainId, crossChainTx.operatorChainId),
        operatorBlockNumber: getCorrectValue(beam.operatorBlock, crossChainTx.operatorBlockNumber),
        operatorAddress: getCorrectValue(beam.operatorAddress, crossChainTx.operatorAddress),
        operatorStatus: getTxStatus(beam.operatorTx, crossChainTx.operatorStatus),
      }

      if (rawData !== undefined && crossChainTx.data === undefined) {
        updatedTx.data = JSON.stringify(rawData)
      } else if (rawData === undefined && crossChainTx.data === undefined) {
        delete updatedTx.data
      }

      delete updatedTx.id
    } else {
      this.log('No source job found in DB')

      if (!beam.jobType) return

      this.log('Creating job instance in DB...')

      updatedTx = {
        jobType: beam.jobType.toUpperCase(),
        jobHash: beam.jobHash,
        sourceTx: beam.bridgeTx,
        sourceChainId: sourceChainId,
        sourceBlockNumber: beam.bridgeBlock,
        sourceAddress: beam.bridgeAddress,
        sourceStatus: getTxStatus(beam.bridgeTx),
        messageTx: beam.messageTx,
        messageChainId: messageChainId,
        messageBlockNumber: beam.messageBlock,
        messageAddress: beam.messageAddress,
        messageStatus: getTxStatus(beam.messageTx),
        operatorTx: beam.operatorTx,
        operatorChainId: operatorChainId,
        operatorBlockNumber: beam.operatorBlock,
        operatorAddress: beam.operatorAddress,
        operatorStatus: getTxStatus(beam.operatorTx),
      }

      if (rawData !== undefined) {
        updatedTx.data = JSON.stringify(rawData)
      }
    }

    try {
      const response = await this.apiService.updateCrossChainTransactionStatus(updatedTx)
      this.log(`Updated cross chain transaction ${response.id}`)
    } catch (error: any) {
      this.error(error)
    }
  }

  /**
   * Process the transactions in each block job
   */
  async processTransactions(job: BlockJob, transactions: TransactionResponse[]): Promise<void> {
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
      let rawData: RawData | undefined

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
        beam.bridgeAddress = transaction.from
        const parsedTransaction: TransactionDescription | null =
          this.networkMonitor.bridgeContract.interface.parseTransaction(transaction)
        if (parsedTransaction === null) {
          beam.jobType = TransactionType.unknown
        } else {
          const toNetwork: string = getNetworkByHolographId(parsedTransaction.args[0]).key
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
            } else if (contractType === 'HolographERC721') {
              beam.jobType = TransactionType.erc721

              // creating json data field
              const erc721TransferEvent: string[] | undefined = this.networkMonitor.decodeErc721TransferEvent(
                receipt,
                holographableContractAddress,
              )

              if (erc721TransferEvent === undefined) {
                this.warn("Couldn't create raw json data, since the tokenId is undefined")
                this.exit()
              }

              const from: string = erc721TransferEvent![0]
              const to: string = erc721TransferEvent![1]
              const tokenId: string = erc721TransferEvent![2]

              rawData = {
                operatorJobPayload,
                from,
                to,
                tokenId,
                holographId: networks[beam.bridgeNetwork].holographId,
                collection: holographableContractAddress,
              }
            }
          }
        }

        this.networkMonitor.structuredLog(network, `Found a valid bridgeOutRequest for ${transaction.hash}`, tags)
        this.manageOperatorJobMaps(index, operatorJobHash, beam)
        await this.updateBeamStatusDB(beam, rawData)
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
      const operatorJobHash: string | undefined = args === undefined ? undefined : args[0]
      const operatorJobPayload: string | undefined = args === undefined ? undefined : args[1]
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
        beam.messageAddress = transaction.from
        if (beam.completed !== true) {
          beam.completed = await this.validateOperatorJob(transaction.hash, network, operatorJobPayload!, tags)
        }

        this.networkMonitor.structuredLog(network, `Found a valid availableOperatorJob for ${transaction.hash}`, tags)
        this.manageOperatorJobMaps(index, operatorJobHash, beam)
        await this.updateBeamStatusDB(beam)
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
        const operatorJobPayload: string | undefined = args === undefined ? undefined : args[0]
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
          beam.operatorAddress = transaction.from
          beam.completed = true

          const bridgeTransaction: TransactionDescription | null =
            this.networkMonitor.bridgeContract.interface.parseTransaction({data: operatorJobPayload!})
          if (parsedTransaction === null) {
            beam.jobType = TransactionType.unknown
          } else {
            const fromNetwork: string = getNetworkByHolographId(bridgeTransaction.args[1]).key
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
              } else if (contractType === 'HolographERC721') {
                beam.jobType = TransactionType.erc721
              }
            }
          }

          this.networkMonitor.structuredLog(network, `Found a valid bridgeOutRequest for ${transaction.hash}`, tags)
          this.manageOperatorJobMaps(index, operatorJobHash, beam)
          await this.updateBeamStatusDB(beam)
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
