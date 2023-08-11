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
  DecodedEvent,
  HolographableContractEvent,
  TransferERC20Event,
  TransferERC721Event,
  TransferSingleERC1155Event,
  TransferBatchERC1155Event,
  BridgeableContractDeployedEvent,
  CrossChainMessageSentEvent,
  AvailableOperatorJobEvent,
  FinishedOperatorJobEvent,
  FailedOperatorJobEvent,
  decodeHolographableContractEvent,
} from '../../utils/event'

import {BlockJob, NetworkMonitor, networksFlag, replayFlag, processBlockRange} from '../../utils/network-monitor'
import {zeroAddress} from '../../utils/web3'
import {HealthCheck} from '../../base-commands/healthcheck'
import {ensureConfigFileIsValid} from '../../utils/config'
import ApiService from '../../services/api-service'

import {
  sqsHandleContractDeployedEvent,
  sqsHandleAvailableOperatorJobEvent,
  sqsHandleBridgeEvent,
} from '../../handlers/sqs-indexer'
import SqsService from '../../services/sqs-service'
import {shouldSync, syncFlag} from '../../flags/sync.flag'
import {BlockHeightOptions, blockHeightFlag} from '../../flags/update-block-height.flag'
import handleTransferERC721Event from '../../handlers/sqs-indexer/handle-transfer-erc721-event'
import handleFailedOperatorJobEvent from '../../handlers/sqs-indexer/handle-failed-operator-job-event'
import handleTransferBatchERC1155Event from '../../handlers/sqs-indexer/handle-transfer-batch-erc1155-event'
import {CrossChainMessageType} from '../../utils/event/event'

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
      default: 'http://127.0.0.1:6000',
    }),
    ...syncFlag,
    ...blockHeightFlag,
    ...networksFlag,
    ...replayFlag,
    ...processBlockRange,
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

  legacyBlocks = true

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    this.log(`Indexer command has begun!!!`)
    const {flags} = await this.parse(Indexer)
    this.BASE_URL = flags.host
    const enableHealthCheckServer = flags.healthCheck
    const healthCheckPort = flags.healthCheckPort
    let updateBlockHeight = flags.updateBlockHeight
    const syncFlag = flags.sync
    const processBlockRange = flags['process-block-range']
    this.legacyBlocks = !processBlockRange

    this.log('Loading user configurations...')
    const {environment, configFile} = await ensureConfigFileIsValid(this.config.configDir, undefined, false)
    this.log('User configurations loaded.')

    this.environment = environment

    if (flags.replay !== '0') {
      this.log('Replay flag enabled, will not load or save block heights.')
      updateBlockHeight = BlockHeightOptions.DISABLE
    }

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
      replay: flags.replay,
      apiService: this.apiService,
      BlockHeightOptions: updateBlockHeight as BlockHeightOptions,
      processBlockRange: processBlockRange,
    })

    switch (updateBlockHeight) {
      case BlockHeightOptions.API:
        if (flags.host === undefined) {
          this.errorColor(`--blockHeight flag option API requires the --host flag`)
        }

        this.networkMonitor.latestBlockHeight = await this.networkMonitor.loadLastBlocksHeights(
          BlockHeightProcessType.INDEXER,
        )
        break
      case BlockHeightOptions.FILE:
        this.networkMonitor.latestBlockHeight = await this.networkMonitor.loadLastBlocks(this.config.configDir)
        break
      case BlockHeightOptions.DISABLE:
        this.log(`Block height update is disable, it'll not be saved or updated anywhere`)
        this.networkMonitor.latestBlockHeight = {}
        this.networkMonitor.currentBlockHeight = {}
        break
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
    }

    await this.checkSqsServiceAvailability()

    if ((await shouldSync(syncFlag, this.networkMonitor.latestBlockHeight)) === false) {
      this.networkMonitor.latestBlockHeight = {}
      this.networkMonitor.currentBlockHeight = {}
    }

    CliUx.ux.action.start(`Starting indexer`)
    const continuous = flags.replay === '0' // If replay is set, run network monitor stops after catching up to the latest block
    await this.networkMonitor.run(continuous, undefined, this.filterBuilder2)
    CliUx.ux.action.stop('🚀')

    // Start health check server on port 6000 or healthCheckPort
    // Can be used to monitor that the operator is online and running
    if (enableHealthCheckServer) {
      await this.config.runHook('healthCheck', {networkMonitor: this.networkMonitor, healthCheckPort})
    }
  }

  /* eslint-disable @typescript-eslint/no-unused-vars */
  checkAgainstCachedContracts(contractType: ContractType): EventValidator {
    return (network: string, transaction: TransactionResponse, log: Log): boolean => {
      return log.address.toLowerCase() in this.cachedContracts
    }
  }

  bloomFilterAddress = (address: string): Pick<BloomFilter, 'bloomType' | 'bloomValue' | 'bloomValueHashed'> => ({
    bloomType: BloomType.contract,
    bloomValue: address,
    bloomValueHashed: address,
  })

  async filterBuilder2(): Promise<void> {
    const factoryAddress = this.networkMonitor.factoryAddress
    const operatorAddress = this.networkMonitor.operatorAddress
    const registryAddress = this.networkMonitor.registryAddress

    const buildEventFilter = (eventType: EventType, targetAddress?: string, contractType?: ContractType) =>
      buildFilter(
        BloomType.topic,
        eventType,
        undefined,
        targetAddress ? [this.bloomFilterAddress(targetAddress!)] : undefined,
        contractType ? this.checkAgainstCachedContracts(contractType) : undefined,
      )

    let tempBloomFilterMap: BloomFilterMap = {}
    if (this.legacyBlocks) {
      tempBloomFilterMap = {
        [EventType.TransferERC20]: buildEventFilter(EventType.TransferERC20, undefined, ContractType.ERC20),
        [EventType.TransferERC721]: buildEventFilter(EventType.TransferERC721, undefined, ContractType.ERC721),
        [EventType.TransferSingleERC1155]: buildEventFilter(
          EventType.TransferSingleERC1155,
          undefined,
          ContractType.ERC1155,
        ),
        [EventType.TransferBatchERC1155]: buildEventFilter(
          EventType.TransferBatchERC1155,
          undefined,
          ContractType.ERC1155,
        ),
      }
    }

    this.bloomFilters = {
      [EventType.BridgeableContractDeployed]: buildEventFilter(EventType.BridgeableContractDeployed, factoryAddress),
      [EventType.HolographableContractEvent]: buildEventFilter(EventType.HolographableContractEvent, registryAddress),
      [EventType.CrossChainMessageSent]: buildEventFilter(EventType.CrossChainMessageSent, operatorAddress),
      [EventType.AvailableOperatorJob]: buildEventFilter(EventType.AvailableOperatorJob, operatorAddress),
      [EventType.FinishedOperatorJob]: buildEventFilter(EventType.FinishedOperatorJob, operatorAddress),
      [EventType.FailedOperatorJob]: buildEventFilter(EventType.FailedOperatorJob, operatorAddress),
      ...tempBloomFilterMap,
    }

    this.networkMonitor.bloomFilters = Object.values(this.bloomFilters) as BloomFilter[]
  }

  detectCrossChainMessageType(allLogs: Log[]): CrossChainMessageType {
    const foundLog = allLogs.find(
      log =>
        log.topics[0] === this.bloomFilters[EventType.BridgeableContractDeployed]?.bloomValueHashed ||
        log.topics[0] === this.bloomFilters[EventType.TransferERC721]?.bloomValueHashed,
    )

    if (foundLog?.topics[0] === this.bloomFilters[EventType.BridgeableContractDeployed]?.bloomValueHashed) {
      return CrossChainMessageType.CONTRACT
    }

    if (foundLog?.topics[0] === this.bloomFilters[EventType.TransferERC721]?.bloomValueHashed) {
      return CrossChainMessageType.ERC721
    }

    return CrossChainMessageType.UNKNOWN
  }

  async checkSqsServiceAvailability(): Promise<void> {
    this.log('Checking SQS service availability...')
    await SqsService.Instance.healthCheck()
    this.log('SQS service is reachable')
  }

  /**
   * Preprocesses a list of transactions to remove duplicates based on a combination of transaction hash and the bloomId.
   * Specifically, it filters out duplicate entries where the bloomId is 'CrossChainMessageSent'.
   *
   * How it works:
   * 1. Iterates over each transaction.
   * 2. Creates a unique identifier using the transaction hash and bloomId.
   * 3. If the bloomId is 'CrossChainMessageSent' and the identifier is already seen, the transaction is skipped.
   * 4. Otherwise, the transaction is processed: it's added to the groupedByTransactionHashAndBloomId dictionary and the updatedInterestingTransactions array.
   * 5. The end result is a list of transactions with duplicates (based on the specific criteria) removed.
   *
   * @param interestingTransactions - The list of transactions to be preprocessed.
   * @returns A new list of transactions with duplicates removed based on the described criteria.
   */
  preprocessTransactions(interestingTransactions: InterestingTransaction[]): InterestingTransaction[] {
    const groupedByTransactionHashAndBloomId: {[hash: string]: {[bloomId: string]: any}} = {}
    const seenCombinations = new Set()
    const updatedInterestingTransactions: InterestingTransaction[] = []

    for (const item of interestingTransactions) {
      const {hash} = item.transaction
      const {bloomId} = item
      const identifier = `${hash}-${bloomId}`

      const isCrossChainMessageSent = bloomId === 'CrossChainMessageSent'

      // If the current bloomId is "CrossChainMessageSent" and we've seen this combination before, skip the rest of this iteration.
      if (isCrossChainMessageSent && seenCombinations.has(identifier)) {
        continue
      }

      if (isCrossChainMessageSent) {
        seenCombinations.add(identifier)
      }

      const {transaction, log, allLogs} = item

      // Initialize or get existing entry
      const transactionGroup =
        groupedByTransactionHashAndBloomId[hash] || (groupedByTransactionHashAndBloomId[hash] = {})
      const bloomGroup =
        transactionGroup[bloomId] ||
        (transactionGroup[bloomId] = {
          transaction,
          log,
          allLogs: [],
        })

      if (allLogs) {
        bloomGroup.allLogs.push(...allLogs)
      }

      updatedInterestingTransactions.push(item)
    }

    return updatedInterestingTransactions
  }

  async processTransactions2(job: BlockJob, interestingTransactions: InterestingTransaction[]): Promise<void> {
    const startTime = performance.now()

    if (interestingTransactions.length <= 0) {
      return
    }

    // Filter out duplicate transaction / bloomId combinations (only CrossChainMessageSent is considered for now)
    interestingTransactions = this.preprocessTransactions(interestingTransactions)

    // Map over the transactions to create an array of Promises
    const transactionPromises = interestingTransactions.map(interestingTransaction =>
      this.processSingleTransaction(interestingTransaction, job),
    )

    // Use Promise.all to execute all the Promises concurrently
    await Promise.all(transactionPromises)

    const endTime = performance.now()
    const duration = endTime - startTime
    this.networkMonitor.structuredLog(
      job.network,
      `Processed ${transactionPromises.length} transactions in ${duration}ms`,
    )
  }

  /* eslint-disable no-case-declarations, complexity */
  async processSingleTransaction(interestingTransaction: InterestingTransaction, job: BlockJob) {
    const {transaction} = interestingTransaction
    const tags: (string | number)[] = [transaction.blockNumber as number, this.networkMonitor.randomTag()]
    const {bloomId} = interestingTransaction
    let type: EventType = EventType[bloomId as keyof typeof EventType]

    // Log processing of transaction
    this.networkMonitor.structuredLog(
      job.network,
      `Processing transaction ${transaction.hash} at block ${transaction.blockNumber}`,
      tags,
    )
    this.networkMonitor.structuredLog(job.network, `Identified this as a ${bloomId} event`, tags)

    // Depending on the event type, perform relevant actions
    try {
      switch (type) {
        case EventType.BridgeableContractDeployed: {
          try {
            const {log} = interestingTransaction
            const {bloomEvent} = this.bloomFilters[type]!
            const bridgeableContractDeployedEvent: BridgeableContractDeployedEvent | null =
              bloomEvent.decode<BridgeableContractDeployedEvent>(type, log!)

            if (bridgeableContractDeployedEvent !== null) {
              // add contract to holographable contracts cache
              this.cachedContracts[bridgeableContractDeployedEvent.contractAddress.toLowerCase()] = true
              // should optimize SQS logic to not make additional calls since all data is already digested and parsed here
              await sqsHandleContractDeployedEvent.call(
                this,
                this.networkMonitor,
                interestingTransaction.transaction,
                job.network,
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
        }

        case EventType.HolographableContractEvent: {
          const holographableContractEvent: HolographableContractEvent | null = this.bloomFilters[
            type
          ]!.bloomEvent.decode<HolographableContractEvent>(type, interestingTransaction.log!)
          if (holographableContractEvent !== null) {
            const decodedEvent: DecodedEvent | null = decodeHolographableContractEvent(holographableContractEvent)
            if (decodedEvent !== null) {
              switch (decodedEvent.type) {
                case EventType.TransferERC20:
                  type = EventType.TransferERC20
                  const transferERC20Event: TransferERC20Event = decodedEvent as TransferERC20Event
                  // No need to log ERC20 transfers at the moment
                  // this.networkMonitor.structuredLog(job.network, 'HandleTransferERC20Event has been called', tags)
                  break
                case EventType.TransferERC721:
                  type = EventType.TransferERC721
                  // *** START OF TEMP CODE ***
                  // We are adding a temporary filter that skips transfer events inside of bridge-in and bridge-out transactions
                  // A bridge event contains a "TransferERC721" event. Because our process handles a whole event bridge event,
                  // instead of the sub events we have to dedup them. So we make sure that this "TransferERC721" is not part of a bridge event.
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

                  const transferERC721Event: TransferERC721Event = decodedEvent as TransferERC721Event

                  let isNewMint = false
                  if (transferERC721Event.from === zeroAddress) {
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

                  await handleTransferERC721Event.call(
                    this,
                    this.networkMonitor,
                    interestingTransaction.transaction,
                    job.network,
                    transferERC721Event,
                    isNewMint,
                    tags,
                  )
                  break
              }
            }
          }

          break
        }

        case EventType.TransferERC20:
        case EventType.TransferERC721: {
          const testLog = interestingTransaction.log!
          if (!testLog.data || testLog.data === '0x') {
            type = EventType.TransferERC721
            // This is ERC721
            // *** START OF TEMP CODE ***
            // We are adding a temporary filter that skips transfer events inside of bridge-in and bridge-out transactions
            // A bridge event contains a "TransferERC721" event. Because our process handles a whole event bridge event,
            // instead of the sub events we have to dedup them. So we make sure that this "TransferERC721" is not part of a bridge event.
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
              if (transferERC721Event !== null) {
                let isNewMint = false
                if (transferERC721Event.from === zeroAddress) {
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

                await handleTransferERC721Event.call(
                  this,
                  this.networkMonitor,
                  interestingTransaction.transaction,
                  job.network,
                  transferERC721Event,
                  isNewMint,
                  tags,
                )
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
                // No need to log ERC20 transfers at the moment
                // this.networkMonitor.structuredLog(job.network, 'HandleTransferERC20Event has been called', tags)
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
        }

        case EventType.TransferSingleERC1155: {
          const transferSingleERC1155Event: TransferSingleERC1155Event | null = this.bloomFilters[
            type
          ]!.bloomEvent.decode<TransferSingleERC1155Event>(type, interestingTransaction.log!)
          if (transferSingleERC1155Event !== null) {
            await sqsHandleBridgeEvent.call(
              this,
              this.networkMonitor,
              interestingTransaction.transaction,
              job.network,
              CrossChainMessageType.ERC721,
              tags,
            )
          }

          break
        }

        case EventType.TransferBatchERC1155: {
          const transferBatchERC1155Event: TransferBatchERC1155Event | null = this.bloomFilters[
            type
          ]!.bloomEvent.decode<TransferBatchERC1155Event>(type, interestingTransaction.log!)
          if (transferBatchERC1155Event !== null) {
            await handleTransferBatchERC1155Event.call(
              this,
              this.networkMonitor,
              interestingTransaction.transaction,
              job.network,
              transferBatchERC1155Event,
              tags,
            )
          }

          break
        }

        case EventType.CrossChainMessageSent: {
          try {
            const crossChainMessageSentEvent: CrossChainMessageSentEvent | null = this.bloomFilters[
              type
            ]!.bloomEvent.decode<CrossChainMessageSentEvent>(type, interestingTransaction.log!)

            if (!interestingTransaction.allLogs) {
              throw new Error('CrossChainMessageSentEvent has no allLogs')
            }

            const crossChainMessageType = this.detectCrossChainMessageType(interestingTransaction.allLogs)
            if (crossChainMessageSentEvent !== null) {
              // should optimize SQS logic to not make additional calls since all data is already digested and parsed here
              await sqsHandleBridgeEvent.call(
                this,
                this.networkMonitor,
                interestingTransaction.transaction,
                job.network,
                crossChainMessageType,
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
        }

        case EventType.AvailableOperatorJob: {
          try {
            const availableOperatorJobEvent: AvailableOperatorJobEvent | null = this.bloomFilters[
              type
            ]!.bloomEvent.decode<AvailableOperatorJobEvent>(type, interestingTransaction.log!)

            if (!interestingTransaction.allLogs) {
              throw new Error('CrossChainMessageSentEvent has no allLogs')
            }

            const crossChainMessageType = this.detectCrossChainMessageType(interestingTransaction.allLogs)

            if (availableOperatorJobEvent !== null) {
              // should optimize SQS logic to not make additional calls since all data is already digested and parsed here
              await sqsHandleAvailableOperatorJobEvent.call(
                this,
                this.networkMonitor,
                interestingTransaction.transaction,
                job.network,
                crossChainMessageType,
                tags,
              )
            }
          } catch (error: any) {
            this.networkMonitor.structuredLogError(
              job.network,
              this.errorColor(`Decoding AvailableOperatorJobEvent error: `, error),
              tags,
            )
          }

          break
        }

        case EventType.FinishedOperatorJob: {
          try {
            const finishedOperatorJobEvent: FinishedOperatorJobEvent | null = this.bloomFilters[
              type
            ]!.bloomEvent.decode<FinishedOperatorJobEvent>(type, interestingTransaction.log!)

            if (!interestingTransaction.allLogs) {
              throw new Error('CrossChainMessageSentEvent has no allLogs')
            }

            const crossChainMessageType = this.detectCrossChainMessageType(interestingTransaction.allLogs)

            if (finishedOperatorJobEvent !== null) {
              // should optimize SQS logic to not make additional calls since all data is already digested and parsed here
              await sqsHandleBridgeEvent.call(
                this,
                this.networkMonitor,
                interestingTransaction.transaction,
                job.network,
                crossChainMessageType,
                tags,
              )
            }
          } catch (error: any) {
            this.networkMonitor.structuredLogError(
              job.network,
              this.errorColor(`Decoding FinishedOperatorJobEvent error: `, error),
              tags,
            )
          }

          break
        }

        case EventType.FailedOperatorJob: {
          // TODO: Figure out if it's an NFT or Collection
          // Add status field to the payload

          try {
            const failedOperatorJobEvent: FailedOperatorJobEvent | null = this.bloomFilters[
              type
            ]!.bloomEvent.decode<FailedOperatorJobEvent>(type, interestingTransaction.log!)
            if (failedOperatorJobEvent !== null) {
              await handleFailedOperatorJobEvent.call(
                this,
                this.networkMonitor,
                interestingTransaction.transaction,
                job.network,
                failedOperatorJobEvent,
                tags,
              )
            }
          } catch (error: any) {
            this.networkMonitor.structuredLogError(
              job.network,
              this.errorColor(`Decoding FailedOperatorJobEvent error: `, error),
              tags,
            )
          }

          break
        }

        case EventType.TBD: {
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
              // Return the filtered transaction to the caller
              return filterResult
            }
          }

          break
        }

        default: {
          this.networkMonitor.structuredLogError(job.network, `UNKNOWN EVENT`, tags)
          break
        }
      }
    } catch (error: any) {
      this.networkMonitor.structuredLogError(
        job.network,
        this.errorColor(`Error processing transaction: `, error),
        tags,
      )
    }
  }
}
