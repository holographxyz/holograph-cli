import {Log, TransactionResponse} from '@ethersproject/abstract-provider'
import {Environment} from '@holographxyz/environment'
import {CliUx, Flags} from '@oclif/core'
import color from '@oclif/color'
import dotenv from 'dotenv'

import {BlockHeightProcessType, Logger} from '../../types/api'
import {InterestingTransaction} from '../../types/network-monitor'
import {ContractType} from '../../utils/contract'
import {
  EventValidator,
  EventType,
  BloomType,
  BloomFilter,
  buildFilter,
  BloomFilterMap,
  TransferERC20Event,
  TransferERC721Event,
  TransferSingleERC1155Event,
  TransferBatchERC1155Event,
  BridgeableContractDeployedEvent,
  CrossChainMessageSentEvent,
  AvailableOperatorJobEvent,
  FinishedOperatorJobEvent,
  FailedOperatorJobEvent,
} from '../../utils/event'

import {BlockJob, NetworkMonitor, networksFlag, repairFlag} from '../../utils/network-monitor'
import {zeroAddress} from '../../utils/utils'
import {HealthCheck} from '../../base-commands/healthcheck'
import {ensureConfigFileIsValid} from '../../utils/config'
import ApiService from '../../services/api-service'

import {
  sqsHandleMintEvent,
  sqsHandleContractDeployedEvent,
  sqsHandleAvailableOperatorJobEvent,
  sqsHandleBridgeEvent,
  sqsHandleTransferEvent,
} from '../../handlers/sqs-indexer'
import SqsService from '../../services/sqs-service'

dotenv.config()

export default class Indexer extends HealthCheck {
  static hidden = true
  static LAST_BLOCKS_FILE_NAME = 'indexer-blocks.json'
  static description = 'Listen for EVM events and update database network status'
  static examples = ['$ <%= config.bin %> <%= command.id %> --networks goerli mumbai fuji']

  static flags = {
    host: Flags.string({
      description: 'The host to send data to',
      char: 'h',
      default: 'http://localhost:6000',
    }),
    ...networksFlag,
    ...repairFlag,
    ...HealthCheck.flags,
  }

  // API Params
  BASE_URL!: string
  apiService!: ApiService
  apiColor = color.keyword('orange')
  errorColor = color.keyword('red')
  networkMonitor!: NetworkMonitor
  bloomFilters!: BloomFilterMap
  cachedContracts: {[key: string]: boolean} = {}
  allDeployedCollections?: string[]

  environment!: Environment

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    this.log(`Indexer command has begun!!!`)
    const {flags} = await this.parse(Indexer)
    this.BASE_URL = flags.host
    const enableHealthCheckServer = flags.healthCheck
    const healthCheckPort = flags.healthCheckPort

    this.log('Loading user configurations...')
    const {environment, configFile} = await ensureConfigFileIsValid(this.config.configDir, undefined, false)
    this.log('User configurations loaded.')

    this.environment = environment

    if (this.environment === Environment.localhost || this.environment === Environment.experimental) {
      this.log(`Skipping API authentication for ${Environment[this.environment]} environment`)
    } else {
      // Create API Service for GraphQL requests
      try {
        const logger: Logger = {
          log: this.log,
          warn: this.warn,
          debug: this.debug,
          error: this.error,
          jsonEnabled: () => false,
        }
        this.apiService = new ApiService(this.BASE_URL, logger)
        await this.apiService.operatorLogin()
      } catch (error: any) {
        this.log('Error: Failed to get Operator Token from API')
        // NOTE: sample of how to do logs when in production mode
        this.log(JSON.stringify({...error, stack: error.stack}))
        this.exit()
      }

      if (this.apiService === undefined) {
        throw new Error('API service is not defined')
      }

      this.log(this.apiColor(`API: Successfully authenticated as an operator`))
    }

    this.networkMonitor = new NetworkMonitor({
      enableV2: true,
      parent: this,
      configFile,
      networks: flags.networks,
      debug: this.debug,
      processTransactions2: this.processTransactions2,
      lastBlockFilename: 'indexer-blocks.json',
      repair: flags.repair,
      apiService: this.apiService,
    })

    // Start health check server on port 6000 or healthCheckPort
    // Can be used to monitor that the operator is online and running
    if (enableHealthCheckServer) {
      await this.config.runHook('healthCheck', {networkMonitor: this.networkMonitor, healthCheckPort})
    }

    if (this.apiService !== undefined) {
      this.apiService.setStructuredLog(this.networkMonitor.structuredLog.bind(this.networkMonitor))
      this.apiService.setStructuredLogError(this.networkMonitor.structuredLogError.bind(this.networkMonitor))

      this.log(`API: getting all deployed collections from DB`)
      this.allDeployedCollections = await this.apiService.getAllDeployedCollections()
      for (const holographableContract of this.allDeployedCollections!) {
        this.cachedContracts[holographableContract] = true
      }

      // set to empty, to drop memory
      this.allDeployedCollections = []
      // just in case, delete it
      delete this.allDeployedCollections
      this.log(`API: processed all deployed collections from DB`)
      if (flags.repair === 0) {
        this.networkMonitor.latestBlockHeight = await this.networkMonitor.loadLastBlocksHeights(
          BlockHeightProcessType.INDEXER,
        )
      }
    }

    await this.checkSqsServiceAvailability()

    CliUx.ux.action.start(`Starting indexer`)
    const continuous = !flags.repair // If repair is set, run network monitor stops after catching up to the latest block
    await this.networkMonitor.run(continuous, undefined, this.filterBuilder2)
    CliUx.ux.action.stop('🚀')
  }

  /* eslint-disable @typescript-eslint/no-unused-vars */
  checkAgainstCachedContracts(contractType: ContractType): EventValidator {
    return (network: string, transaction: TransactionResponse, log: Log): boolean => {
      return log.address.toLowerCase() in this.cachedContracts
    }
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */

  async filterBuilder2(): Promise<void> {
    this.bloomFilters = {
      [EventType.BridgeableContractDeployed]: buildFilter(
        BloomType.topic,
        EventType.BridgeableContractDeployed,
        undefined,
        [
          {
            bloomType: BloomType.contract,
            bloomValue: this.networkMonitor.factoryAddress,
            bloomValueHashed: this.networkMonitor.factoryAddress,
          },
        ],
      ),
      [EventType.TransferERC20]: buildFilter(
        BloomType.topic,
        EventType.TransferERC20,
        undefined,
        undefined,
        this.checkAgainstCachedContracts(ContractType.ERC20),
      ),
      [EventType.TransferERC721]: buildFilter(
        BloomType.topic,
        EventType.TransferERC721,
        undefined,
        undefined,
        this.checkAgainstCachedContracts(ContractType.ERC721),
      ),
      [EventType.TransferSingleERC1155]: buildFilter(
        BloomType.topic,
        EventType.TransferSingleERC1155,
        undefined,
        undefined,
        this.checkAgainstCachedContracts(ContractType.ERC1155),
      ),
      [EventType.TransferBatchERC1155]: buildFilter(
        BloomType.topic,
        EventType.TransferBatchERC1155,
        undefined,
        undefined,
        this.checkAgainstCachedContracts(ContractType.ERC1155),
      ),
      [EventType.CrossChainMessageSent]: buildFilter(BloomType.topic, EventType.CrossChainMessageSent, undefined, [
        {
          bloomType: BloomType.contract,
          bloomValue: this.networkMonitor.operatorAddress,
          bloomValueHashed: this.networkMonitor.operatorAddress,
        },
      ]),
      [EventType.AvailableOperatorJob]: buildFilter(BloomType.topic, EventType.AvailableOperatorJob, undefined, [
        {
          bloomType: BloomType.contract,
          bloomValue: this.networkMonitor.operatorAddress,
          bloomValueHashed: this.networkMonitor.operatorAddress,
        },
      ]),
      [EventType.FinishedOperatorJob]: buildFilter(BloomType.topic, EventType.FinishedOperatorJob, undefined, [
        {
          bloomType: BloomType.contract,
          bloomValue: this.networkMonitor.operatorAddress,
          bloomValueHashed: this.networkMonitor.operatorAddress,
        },
      ]),
      [EventType.FailedOperatorJob]: buildFilter(BloomType.topic, EventType.FailedOperatorJob, undefined, [
        {
          bloomType: BloomType.contract,
          bloomValue: this.networkMonitor.operatorAddress,
          bloomValueHashed: this.networkMonitor.operatorAddress,
        },
      ]),
    }
    this.networkMonitor.bloomFilters = Object.values(this.bloomFilters) as BloomFilter[]
  }

  async checkSqsServiceAvailability(): Promise<void> {
    this.log('Checking SQS service availability...')
    await SqsService.Instance.healthCheck()
    this.log('SQS service is reachable')
  }

  /* eslint-disable no-case-declarations */
  async processTransactions2(job: BlockJob, interestingTransactions: InterestingTransaction[]): Promise<void> {
    if (interestingTransactions.length > 0) {
      for (let i = 0, l: number = interestingTransactions.length; i < l; i++) {
        const interestingTransaction: InterestingTransaction = interestingTransactions[i]
        const transaction: TransactionResponse = interestingTransaction.transaction
        const tags: (string | number)[] = []
        tags.push(transaction.blockNumber as number, this.networkMonitor.randomTag())
        this.networkMonitor.structuredLog(
          job.network,
          `Processing transaction ${transaction.hash} at block ${transaction.blockNumber}`,
          tags,
        )
        let type: EventType = EventType[interestingTransaction.bloomId as keyof typeof EventType]
        this.networkMonitor.structuredLog(
          job.network,
          `Identified this as a ${interestingTransaction.bloomId} event`,
          tags,
        )
        switch (type) {
          case EventType.BridgeableContractDeployed:
            try {
              const bridgeableContractDeployedEvent: BridgeableContractDeployedEvent | null = this.bloomFilters[
                type
              ]!.bloomEvent.decode<BridgeableContractDeployedEvent>(type, interestingTransaction.log!)

              if (bridgeableContractDeployedEvent !== null) {
                await this.handleBridgeableContractDeployedEvent(
                  job,
                  interestingTransaction,
                  bridgeableContractDeployedEvent,
                  tags,
                )
              }
            } catch (error: any) {
              this.networkMonitor.structuredLogError(
                job.network,
                this.errorColor(`Decoding BridgeableContractDeployedEvent error: `, error),
                tags,
              )
            }

            break
          case EventType.TransferERC20:
          case EventType.TransferERC721:
            const testLog = interestingTransaction.log!
            if (testLog.data === undefined || testLog.data === null || testLog.data === '' || testLog.data === '0x') {
              type = EventType.TransferERC721
              // this is ERC721
              // *** START OF TEMP CODE ***
              // we are adding a temporary filter that skips transfer events inside of bridge-in and bridge-out transactions
              let isPartOfBridgeTx = false
              for (const log of interestingTransaction.allLogs!) {
                if (
                  log.topics[0] === this.bloomFilters[EventType.CrossChainMessageSent]!.bloomValueHashed ||
                  log.topics[0] === this.bloomFilters[EventType.FinishedOperatorJob]!.bloomValueHashed
                ) {
                  isPartOfBridgeTx = true
                  break
                }
              }

              if (isPartOfBridgeTx) {
                break
              }

              // *** END OF TEMP CODE ***
              try {
                const transferERC721Event: TransferERC721Event | null = this.bloomFilters[
                  type
                ]!.bloomEvent.decode<TransferERC721Event>(type, interestingTransaction.log!)
                //            log('transferERC721Event', transferERC721Event);
                if (transferERC721Event !== null) {
                  await this.handleTransferERC721Event(job, interestingTransaction, transferERC721Event, tags)
                }
              } catch (error: any) {
                this.networkMonitor.structuredLogError(
                  job.network,
                  this.errorColor(`Decoding TransferERC721Event error: `, error),
                  tags,
                )
              }
            } else {
              // this is ERC20
              try {
                const transferERC20Event: TransferERC20Event | null = this.bloomFilters[
                  type
                ]!.bloomEvent.decode<TransferERC20Event>(type, interestingTransaction.log!)
                if (transferERC20Event !== null) {
                  await this.handleTransferERC20Event(job, interestingTransaction, transferERC20Event, tags)
                }
              } catch (error: any) {
                this.networkMonitor.structuredLogError(
                  job.network,
                  this.errorColor(`Decoding TransferERC20Event error: `, error),
                  tags,
                )
              }
            }

            break
          case EventType.TransferSingleERC1155:
            const transferSingleERC1155Event: TransferSingleERC1155Event | null = this.bloomFilters[
              type
            ]!.bloomEvent.decode<TransferSingleERC1155Event>(type, interestingTransaction.log!)
            if (transferSingleERC1155Event !== null) {
              await this.handleTransferSingleERC1155Event(job, interestingTransaction, transferSingleERC1155Event, tags)
            }

            break
          case EventType.TransferBatchERC1155:
            const transferBatchERC1155Event: TransferBatchERC1155Event | null = this.bloomFilters[
              type
            ]!.bloomEvent.decode<TransferBatchERC1155Event>(type, interestingTransaction.log!)
            if (transferBatchERC1155Event !== null) {
              await this.handleTransferBatchERC1155Event(job, interestingTransaction, transferBatchERC1155Event, tags)
            }

            break
          case EventType.CrossChainMessageSent:
            try {
              const crossChainMessageSentEvent: CrossChainMessageSentEvent | null = this.bloomFilters[
                type
              ]!.bloomEvent.decode<CrossChainMessageSentEvent>(type, interestingTransaction.log!)
              if (crossChainMessageSentEvent !== null) {
                await this.handleCrossChainMessageSentEvent(
                  job,
                  interestingTransaction,
                  crossChainMessageSentEvent,
                  tags,
                )
              }
            } catch (error: any) {
              this.networkMonitor.structuredLogError(
                job.network,
                this.errorColor(`Decoding CrossChainMessageSentEvent error: `, error),
                tags,
              )
            }

            break
          case EventType.AvailableOperatorJob:
            try {
              const availableOperatorJobEvent: AvailableOperatorJobEvent | null = this.bloomFilters[
                type
              ]!.bloomEvent.decode<AvailableOperatorJobEvent>(type, interestingTransaction.log!)
              if (availableOperatorJobEvent !== null) {
                await this.handleAvailableOperatorJobEvent(job, interestingTransaction, availableOperatorJobEvent, tags)
              }
            } catch (error: any) {
              this.networkMonitor.structuredLogError(
                job.network,
                this.errorColor(`Decoding AvailableOperatorJobEvent error: `, error),
                tags,
              )
            }

            break
          case EventType.FinishedOperatorJob:
            try {
              const finishedOperatorJobEvent: FinishedOperatorJobEvent | null = this.bloomFilters[
                type
              ]!.bloomEvent.decode<FinishedOperatorJobEvent>(type, interestingTransaction.log!)
              if (finishedOperatorJobEvent !== null) {
                await this.handleFinishedOperatorJobEvent(job, interestingTransaction, finishedOperatorJobEvent, tags)
              }
            } catch (error: any) {
              this.networkMonitor.structuredLogError(
                job.network,
                this.errorColor(`Decoding FinishedOperatorJobEvent error: `, error),
                tags,
              )
            }

            break
          case EventType.FailedOperatorJob:
            try {
              const failedOperatorJobEvent: FailedOperatorJobEvent | null = this.bloomFilters[
                type
              ]!.bloomEvent.decode<FailedOperatorJobEvent>(type, interestingTransaction.log!)
              if (failedOperatorJobEvent !== null) {
                await this.handleFailedOperatorJobEvent(job, interestingTransaction, failedOperatorJobEvent, tags)
              }
            } catch (error: any) {
              this.networkMonitor.structuredLogError(
                job.network,
                this.errorColor(`Decoding FailedOperatorJobEvent error: `, error),
                tags,
              )
            }

            break
          case EventType.TBD:
            let filterResult: InterestingTransaction | undefined
            for (const filter of this.networkMonitor.bloomFilters) {
              filterResult = await this.networkMonitor.applyFilter(
                filter,
                interestingTransaction.log!,
                interestingTransaction.transaction,
                this,
                job.network,
              )
              if (filterResult !== undefined) {
                interestingTransactions[i] = filterResult as InterestingTransaction
                i -= 1
                break
              }
            }

            break
          default:
            this.networkMonitor.structuredLogError(job.network, `UNKNOWN EVENT`, tags)
            break
        }
      }
    }
  }
  /* eslint-enable no-case-declarations */

  /* eslint-disable @typescript-eslint/no-unused-vars */
  /* eslint-disable @typescript-eslint/no-empty-function */
  async handleBridgeableContractDeployedEvent(
    job: BlockJob,
    interestingTransaction: InterestingTransaction,
    event: BridgeableContractDeployedEvent,
    tags: (string | number)[] = [],
  ): Promise<void> {
    // add contract to holographable contracts cache
    this.cachedContracts[event.contractAddress.toLowerCase()] = true
    // should optimize SQS logic to not make additional calls since all data is already digested and parsed here
    await sqsHandleContractDeployedEvent.call(
      this,
      this.networkMonitor,
      interestingTransaction.transaction,
      job.network,
      tags,
    )
  }

  async handleTransferERC20Event(
    job: BlockJob,
    interestingTransaction: InterestingTransaction,
    event: TransferERC20Event,
    tags: (string | number)[] = [],
  ): Promise<void> {
    // this.networkMonitor.structuredLog(job.network, 'HandleTransferERC20Event has been called', tags)
  }

  async handleTransferERC721Event(
    job: BlockJob,
    interestingTransaction: InterestingTransaction,
    event: TransferERC721Event,
    tags: (string | number)[] = [],
  ): Promise<void> {
    let isNewMint = false
    if (event.from === zeroAddress) {
      isNewMint = true
      for (const log of interestingTransaction.allLogs!) {
        if (
          this.networkMonitor.operatorAddress === log.address.toLowerCase() &&
          this.bloomFilters[EventType.FinishedOperatorJob]!.bloomEvent.sigHash === log.topics[0]
        ) {
          isNewMint = false
          break
        }
      }
    }

    await (isNewMint
      ? sqsHandleMintEvent.call(this, this.networkMonitor, interestingTransaction.transaction, job.network, tags)
      : sqsHandleTransferEvent.call(
          this,
          this.networkMonitor,
          interestingTransaction.transaction,
          job.network,
          event,
          tags,
        ))
  }

  async handleTransferSingleERC1155Event(
    job: BlockJob,
    interestingTransaction: InterestingTransaction,
    event: TransferSingleERC1155Event,
    tags: (string | number)[] = [],
  ): Promise<void> {}

  async handleTransferBatchERC1155Event(
    job: BlockJob,
    interestingTransaction: InterestingTransaction,
    event: TransferBatchERC1155Event,
    tags: (string | number)[] = [],
  ): Promise<void> {}

  async handleCrossChainMessageSentEvent(
    job: BlockJob,
    interestingTransaction: InterestingTransaction,
    event: CrossChainMessageSentEvent,
    tags: (string | number)[] = [],
  ): Promise<void> {
    // should optimize SQS logic to not make additional calls since all data is already digested and parsed here
    await sqsHandleBridgeEvent.call(this, this.networkMonitor, interestingTransaction.transaction, job.network, tags)
  }

  async handleAvailableOperatorJobEvent(
    job: BlockJob,
    interestingTransaction: InterestingTransaction,
    event: AvailableOperatorJobEvent,
    tags: (string | number)[] = [],
  ): Promise<void> {
    // should optimize SQS logic to not make additional calls since all data is already digested and parsed here
    await sqsHandleAvailableOperatorJobEvent.call(
      this,
      this.networkMonitor,
      interestingTransaction.transaction,
      job.network,
      tags,
    )
  }

  async handleFinishedOperatorJobEvent(
    job: BlockJob,
    interestingTransaction: InterestingTransaction,
    event: FinishedOperatorJobEvent,
    tags: (string | number)[] = [],
  ): Promise<void> {
    // should optimize SQS logic to not make additional calls since all data is already digested and parsed here
    await sqsHandleBridgeEvent.call(this, this.networkMonitor, interestingTransaction.transaction, job.network, tags)
  }

  async handleFailedOperatorJobEvent(
    job: BlockJob,
    interestingTransaction: InterestingTransaction,
    event: FailedOperatorJobEvent,
    tags: (string | number)[] = [],
  ): Promise<void> {}
  /* eslint-enable @typescript-eslint/no-unused-vars */
  /* eslint-enable @typescript-eslint/no-empty-function */
}
