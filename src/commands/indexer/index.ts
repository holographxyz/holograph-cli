import dotenv from 'dotenv'
dotenv.config()

import {CliUx, Flags} from '@oclif/core'
import color from '@oclif/color'
import {BigNumber} from '@ethersproject/bignumber'
import {TransactionDescription} from '@ethersproject/abi'
import {Block, TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'
import {hexZeroPad} from '@ethersproject/bytes'

import {Environment} from '@holographxyz/environment'
import {getNetworkByHolographId, networks} from '@holographxyz/networks'

import {ensureConfigFileIsValid} from '../../utils/config'
import {
  create2address,
  decodeDeploymentConfig,
  decodeDeploymentConfigInput,
  DeploymentConfig,
  deploymentConfigHash,
} from '../../utils/contract-deployment'
import {capitalize, functionSignature, sha3, sleep, storageSlot, toAscii} from '../../utils/utils'
import {
  BridgeInArgs,
  BridgeInErc20Args,
  BridgeInErc721Args,
  BridgeOutArgs,
  BridgeOutErc20Args,
  BridgeOutErc721Args,
  decodeBridgeInErc20Args,
  decodeBridgeInErc721Args,
  decodeBridgeOutErc20Args,
  decodeBridgeOutErc721Args,
} from '../../utils/bridge'
import {BlockJob, FilterType, NetworkMonitor, networksFlag, repairFlag} from '../../utils/network-monitor'
import {HealthCheck} from '../../base-commands/healthcheck'
import ApiService from '../../services/api-service'
import {Logger, NftStatus, UpdateCrossChainTransactionStatusInput, UpdateNftInput} from '../../types/api'
import {gql} from 'graphql-request'

type DBJob = {
  attempts: number
  timestamp: number
  network: string
  query: string
  identifier?: any
  message: string
  callback: (...args: any[]) => Promise<void>
  arguments: any[]
  tags: (string | number)[]
}

type DBJobMap = {
  [key: number]: DBJob[]
}

export default class Indexer extends HealthCheck {
  static hidden = true
  static LAST_BLOCKS_FILE_NAME = 'indexer-blocks.json'
  static description = 'Listen for EVM events and update database network status'
  static examples = [
    '$ <%= config.bin %> <%= command.id %> --networks ethereumTestnetGoerli polygonTestnet avalancheTestnet',
  ]

  static flags = {
    host: Flags.string({
      description: 'The host to send data to',
      char: 'h',
      default: 'http://localhost:9001',
    }),
    ...networksFlag,
    ...repairFlag,
    ...HealthCheck.flags,
  }

  // API Params
  BASE_URL!: string
  JWT!: string
  DELAY = 20_000
  apiService!: ApiService
  apiColor = color.keyword('orange')
  errorColor = color.keyword('red')
  networkMonitor!: NetworkMonitor
  dbJobMap: DBJobMap = {}
  environment!: Environment

  numericSort(a: number, b: number): number {
    return a - b
  }

  numberfy(arr: string[]): number[] {
    const numbers: number[] = []
    for (const a of arr) {
      numbers.push(Number.parseInt(a, 10))
    }

    return numbers
  }

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    this.log(`Operator command has begun!!!`)
    const {flags} = await this.parse(Indexer)
    this.BASE_URL = flags.host
    const enableHealthCheckServer = flags.healthCheck
    const healthCheckPort = flags.healthCheckPort

    this.log('Loading user configurations...')
    const {environment, configFile} = await ensureConfigFileIsValid(this.config.configDir, undefined, false)
    this.log('User configurations loaded.')

    this.environment = environment

    if (this.environment === Environment.localhost || this.environment === Environment.experimental) {
      this.log(`Skiping API authentication for ${Environment[this.environment]} environment`)
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
        this.error(error)
      }

      if (this.apiService === undefined) {
        throw new Error('API service is not defined')
      }

      this.debug(`process.env.OPERATOR_API_KEY = ${process.env.OPERATOR_API_KEY}`)
      this.debug(`this.JWT = ${this.JWT}`)
      this.log(this.apiColor(`API: Successfully authenticated as an operator`))
    }

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      networks: flags.networks,
      debug: this.debug,
      processTransactions: this.processTransactions,
      lastBlockFilename: 'indexer-blocks.json',
      repair: flags.repair,
    })

    if (this.apiService !== undefined) {
      this.apiService.setStructuredLog(this.networkMonitor.structuredLog.bind(this.networkMonitor))
      this.apiService.setStructuredLogError(this.networkMonitor.structuredLogError.bind(this.networkMonitor))
    }

    // TODO: It doesn't seems like sync is working
    // Indexer always synchronizes missed blocks
    // this.networkMonitor.latestBlockHeight = await this.networkMonitor.loadLastBlocks(this.config.configDir)

    CliUx.ux.action.start(`Starting indexer`)
    const continuous = flags.repair > 0 ? false : true // If repair is set, run network monitor stops after catching up to the latest block
    await this.networkMonitor.run(continuous, undefined, this.filterBuilder)
    CliUx.ux.action.stop('🚀')

    // Start health check server on port 6000 or healthCheckPort
    // Can be used to monitor that the operator is online and running
    if (enableHealthCheckServer) {
      await this.config.runHook('healthCheck', {networkMonitor: this.networkMonitor, healthCheckPort})
    }

    this.processDBJobs()
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
        match: this.networkMonitor.factoryAddress,
        networkDependant: false,
      },
      {
        type: FilterType.to,
        match: this.networkMonitor.operatorAddress,
        networkDependant: false,
      },
      {
        type: FilterType.functionSig,
        match: functionSignature('cxipMint(uint224,uint8,string)'),
        networkDependant: false,
      },
    ]
  }

  async processDBJob(timestamp: number, job: DBJob): Promise<void> {
    this.networkMonitor.structuredLog(job.network, job.message, job.tags)
    if (this.environment === Environment.localhost || this.environment === Environment.experimental) {
      this.networkMonitor.structuredLog(
        job.network,
        `Environment is ${this.environment}: Skipping GraphQL call to ${job.query} with input ${JSON.stringify(
          job.arguments,
        )}
        )}`,
        job.tags,
      )
      await job.callback.bind(this)('', ...job.arguments)
      this.processDBJobs()
    } else {
      const structuredLogInfo = {network: job.network, tagId: job.tags}
      try {
        const rawResponse = await this.apiService.sendQueryRequest(job.query, job.identifier, structuredLogInfo)

        if (rawResponse !== undefined) {
          const {data: response, headers} = rawResponse

          const requestId = headers.get('x-request-id') ?? ''
          try {
            this.networkMonitor.structuredLog(job.network, `Query response ${JSON.stringify(response)}`, [
              ...job.tags,
              requestId,
            ])
            await job.callback.bind(this)(response, ...job.arguments)
            this.processDBJobs()
          } catch (error: any) {
            this.networkMonitor.structuredLogError(job.network, error, [
              ...job.tags,
              this.errorColor(`Request failed with errors ${job.query}`),
            ])

            // Sleep for 1 second and add job back to the queue
            await sleep(1000)
            this.processDBJobs(timestamp, job)
          }
        }
      } catch (extError: any) {
        this.networkMonitor.structuredLogError(job.network, extError, [
          ...job.tags,
          this.errorColor(`SendQueryRequest failed with errors ${job.query}`),
        ])
        // Sleep for 1 second and add job back to the queue
        await sleep(1000)
        this.processDBJobs(timestamp, job)
      }
    }
  }

  processDBJobs(timestamp?: number, job?: DBJob): void {
    if (timestamp !== undefined && job !== undefined) {
      /*
       * @dev Temporary addition to unblock other DB jobs from getting delayed when current DB job fails.
       *      Remove this once proper Registry checks are implemented for cxipMint events.
       */
      timestamp += 30
      if (!(timestamp in this.dbJobMap)) {
        this.networkMonitor.structuredLog(job.network, `Adding ${timestamp} to dbJobMap`, job.tags)
        this.dbJobMap[timestamp] = []
      }

      job.attempts += 1
      this.networkMonitor.structuredLog(
        job.network,
        `Job ${job.query} is being executed with attempt ${job.attempts}`,
        job.tags,
      )
      if (job.attempts >= 10) {
        // we have exhausted attempts, need to drop it entirely
        this.networkMonitor.structuredLog(
          job.network,
          `Failed to execute API query ${job.query}. Arguments were ${JSON.stringify(job.arguments, undefined, 2)}`,
          job.tags,
        )
      } else if (job.attempts >= 9) {
        // push to end of array as a final attempt
        this.networkMonitor.structuredLog(
          job.network,
          `Final attempt to add job to timestamp ${timestamp} at dbJobMap`,
          job.tags,
        )
        this.dbJobMap[timestamp].push(job)
      } else {
        this.networkMonitor.structuredLog(job.network, `Adding job to timestamp ${timestamp} at dbJobMap`, job.tags)
        this.dbJobMap[timestamp].unshift(job)
      }
    }

    const timestamps: number[] = this.numberfy(Object.keys(this.dbJobMap))
    if (timestamps.length > 0) {
      timestamps.sort(this.numericSort)
      const timestamp: number = timestamps[0]

      if (job === undefined) {
        this.log(`Checking if jobs exist for timestamp ${timestamp}...`)
      } else {
        this.networkMonitor.structuredLog(job.network, `Checking if jobs exist for timestamp ${timestamp}...`, job.tags)
      }

      if (this.dbJobMap[timestamp].length > 0) {
        const job: DBJob = this.dbJobMap[timestamp].shift()!

        if (job === undefined) {
          this.log(`Processing job...`)
        } else {
          this.networkMonitor.structuredLog(job.network, `Processing job...`, job.tags)
        }

        this.processDBJob(timestamp, job)
      } else {
        if (job === undefined) {
          this.log(`No jobs found`)
        } else {
          this.networkMonitor.structuredLog(job.network, `No jobs found`, job.tags)
        }

        delete this.dbJobMap[timestamp]
        setTimeout(this.processDBJobs.bind(this), 1000)
      }
    } else {
      if (job !== undefined) {
        this.networkMonitor.structuredLog(job.network, `No timestamps found, setting timeout...`, job.tags)
      }

      setTimeout(this.processDBJobs.bind(this), 1000)
    }
  }

  async processTransactions(job: BlockJob, transactions: TransactionResponse[]): Promise<void> {
    if (transactions.length > 0) {
      for (const transaction of transactions) {
        const tags: (string | number)[] = []
        tags.push(transaction.blockNumber as number, this.networkMonitor.randomTag())
        this.networkMonitor.structuredLog(
          job.network,
          `Processing transaction ${transaction.hash} at block ${transaction.blockNumber}`,
          tags,
        )
        const to: string | undefined = transaction.to?.toLowerCase()
        const from: string | undefined = transaction.from?.toLowerCase()
        const functionSig: string | undefined = transaction.data?.slice(0, 10)
        switch (to) {
          case this.networkMonitor.factoryAddress: {
            this.networkMonitor.structuredLog(
              job.network,
              `handleContractDeployedEvent ${networks[job.network].explorer}/tx/${transaction.hash}`,
              tags,
            )
            await this.handleContractDeployedEvent(transaction, job.network, tags)

            break
          }

          case this.networkMonitor.bridgeAddress: {
            this.networkMonitor.structuredLog(
              job.network,
              `handleBridgeOutEvent ${networks[job.network].explorer}/tx/${transaction.hash}`,
              tags,
            )
            await this.handleBridgeOutEvent(transaction, job.network, tags)

            break
          }

          case this.networkMonitor.operatorAddress: {
            this.networkMonitor.structuredLog(
              job.network,
              `handleBridgeInEvent ${networks[job.network].explorer}/tx/${transaction.hash}`,
              tags,
            )
            await this.handleBridgeInEvent(transaction, job.network, tags)

            break
          }

          default:
            if (from === this.networkMonitor.LAYERZERO_RECEIVERS[job.network]) {
              this.networkMonitor.structuredLog(
                job.network,
                `handleAvailableOperatorJobEvent ${networks[job.network].explorer}/tx/${transaction.hash}`,
                tags,
              )
              await this.handleAvailableOperatorJobEvent(transaction, job.network, tags)
            } else if (functionSig === functionSignature('cxipMint(uint224,uint8,string)')) {
              this.networkMonitor.structuredLog(
                job.network,
                `handleMintEvent ${networks[job.network].explorer}/tx/${transaction.hash}`,
                tags,
              )
              await this.handleMintEvent(transaction, job.network, tags)
            } else {
              this.networkMonitor.structuredLog(job.network, `irrelevant transaction ${transaction.hash}`, tags)
            }
        }
      }
    }
  }

  async handleContractDeployedEvent(
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
      this.networkMonitor.structuredLog(network, `Checking for deployment details`, tags)
      const deploymentEvent: string[] | undefined = this.networkMonitor.decodeBridgeableContractDeployedEvent(
        receipt,
        this.networkMonitor.factoryAddress,
      )
      if (deploymentEvent === undefined) {
        this.networkMonitor.structuredLog(network, `No BridgeableContractDeployed event found`, tags)
      } else {
        this.networkMonitor.structuredLog(network, `Decoding DeploymentConfig`, tags)
        const deploymentConfig: DeploymentConfig = decodeDeploymentConfigInput(transaction.data)
        const deploymentHash: string = deploymentConfigHash(deploymentConfig)
        const contractAddress = create2address(deploymentConfig, this.networkMonitor.factoryAddress)
        if (deploymentHash !== deploymentEvent[1]) {
          throw new Error(`DeploymentConfig hashes ${deploymentHash} and ${deploymentEvent[1]} do not match!`)
        }

        if (contractAddress !== deploymentEvent[0]) {
          throw new Error(`Deployment addresses ${contractAddress} and ${deploymentEvent[0]} do not match!`)
        }

        this.networkMonitor.structuredLog(network, `updateDeployedContract`, tags)
        await this.updateDeployedContract(
          transaction,
          network,
          contractAddress,
          deploymentEvent,
          deploymentConfig,
          tags,
        )
      }
    } else {
      this.networkMonitor.structuredLog(network, `Transaction failed, ignoring it`, tags)
    }
  }

  async handleMintEvent(transaction: TransactionResponse, network: string, tags: (string | number)[]): Promise<void> {
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
      this.networkMonitor.structuredLog(network, `Checking for mint details`, tags)
      const holographableContractAddress: string = transaction.to!
      const erc721TransferEvent: string[] | undefined = this.networkMonitor.decodeErc721TransferEvent(
        receipt,
        holographableContractAddress,
      )
      if (erc721TransferEvent === undefined) {
        this.networkMonitor.structuredLog(network, `No Transfer event found`, tags)
      } else {
        this.networkMonitor.structuredLog(network, `Decoding contractType`, tags)
        const slot: string = await this.networkMonitor.providers[network].getStorageAt(
          holographableContractAddress,
          storageSlot('eip1967.Holograph.contractType'),
        )
        const contractType: string = toAscii(slot)
        this.networkMonitor.structuredLog(network, `updateMintedERC721`, tags)
        await this.updateMintedERC721(
          transaction,
          network,
          contractType,
          holographableContractAddress,
          erc721TransferEvent,
          tags,
        )
      }
    } else {
      this.networkMonitor.structuredLog(network, `Transaction failed, ignoring it`, tags)
    }
  }

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
      this.networkMonitor.structuredLog(network, `Checking for executeJob function`, tags)
      const parsedTransaction: TransactionDescription =
        this.networkMonitor.operatorContract.interface.parseTransaction(transaction)

      if (parsedTransaction.name === 'executeJob') {
        this.networkMonitor.structuredLog(network, `Extracting bridgeInRequest from transaction`, tags)
        const args: any[] | undefined = Object.values(parsedTransaction.args)
        const operatorJobPayload: string | undefined = args === undefined ? undefined : args[0]
        const operatorJobHash: string | undefined =
          operatorJobPayload === undefined ? undefined : sha3(operatorJobPayload)
        if (operatorJobHash === undefined) {
          this.networkMonitor.structuredLog(network, `Could not find bridgeInRequest in ${transaction.hash}`, tags)
        } else {
          const finishedOperatorJobEvent = this.networkMonitor.decodeFinishedOperatorJobEvent(receipt)

          if (finishedOperatorJobEvent !== undefined) {
            this.networkMonitor.structuredLog(
              network,
              `FinishedOperatorJob Event: {"tx": ${transaction.hash}, "jobHash": ${finishedOperatorJobEvent[0]}, "operator": ${finishedOperatorJobEvent[1]} }`,
              tags,
            )
          }

          const failedOperatorJobEvent = this.networkMonitor.decodeFailedOperatorJobEvent(receipt)

          if (failedOperatorJobEvent !== undefined) {
            this.networkMonitor.structuredLog(
              network,
              `FailedOperator Event: {"tx": ${transaction.hash}, "jobHash": ${failedOperatorJobEvent} }`,
              tags,
            )
          }

          this.networkMonitor.structuredLog(network, `Decoding bridgeInRequest`, tags)
          const bridgeTransaction: TransactionDescription | null =
            this.networkMonitor.bridgeContract.interface.parseTransaction({data: operatorJobPayload!})
          if (bridgeTransaction === null) {
            this.networkMonitor.structuredLog(network, `Could not decode bridgeInRequest in ${transaction.hash}`, tags)
          } else {
            this.networkMonitor.structuredLog(network, `Parsing bridgeInRequest data`, tags)
            const bridgeIn: BridgeInArgs = bridgeTransaction.args as unknown as BridgeInArgs
            const fromNetwork: string = getNetworkByHolographId(bridgeIn.fromChain).key
            const toNetwork: string = network
            const bridgeInPayload: string = bridgeIn.bridgeInPayload
            const holographableContractAddress: string = bridgeIn.holographableContract.toLowerCase()
            if (holographableContractAddress === this.networkMonitor.factoryAddress) {
              this.networkMonitor.structuredLog(network, `BridgeInRequest identified as contract deployment`, tags)
              this.networkMonitor.structuredLog(network, `Extracting deployment details`, tags)
              const deploymentEvent: string[] | undefined = this.networkMonitor.decodeBridgeableContractDeployedEvent(
                receipt,
                this.networkMonitor.factoryAddress,
              )
              if (deploymentEvent === undefined) {
                this.networkMonitor.structuredLog(
                  network,
                  `Failed extracting deployment details from BridgeableContractDeployed event`,
                  tags,
                )
              } else {
                this.networkMonitor.structuredLog(network, `Decoding DeploymentConfig`, tags)
                const deploymentConfig: DeploymentConfig = decodeDeploymentConfig(bridgeInPayload)
                const deploymentHash: string = deploymentConfigHash(deploymentConfig)
                const contractAddress = create2address(deploymentConfig, this.networkMonitor.factoryAddress)
                if (deploymentHash !== deploymentEvent[1]) {
                  throw new Error(`DeploymentConfig hashes ${deploymentHash} and ${deploymentEvent[1]} do not match!`)
                }

                if (contractAddress !== deploymentEvent[0]) {
                  throw new Error(`Deployment addresses ${contractAddress} and ${deploymentEvent[0]} do not match!`)
                }

                const direction = 'in'
                this.networkMonitor.structuredLog(
                  network,
                  `Calling updateBridgedContract with direction ${direction}`,
                  tags,
                )
                await this.updateBridgedContract(
                  direction,
                  transaction,
                  network,
                  fromNetwork,
                  contractAddress,
                  deploymentEvent,
                  deploymentConfig,
                  operatorJobHash,
                  tags,
                )
              }
            } else {
              this.networkMonitor.structuredLog(network, `Decoding contractType`, tags)
              const slot: string = await this.networkMonitor.providers[network].getStorageAt(
                holographableContractAddress,
                storageSlot('eip1967.Holograph.contractType'),
              )
              const contractType: string = toAscii(slot)
              if (contractType === 'HolographERC20') {
                this.networkMonitor.structuredLog(network, `BridgeInRequest identified as ERC20 transfer`, tags)
                // BRIDGE IN ERC20 TOKENS
                const erc20BeamInfo: BridgeInErc20Args = decodeBridgeInErc20Args(bridgeInPayload)
                const erc20TransferEvent: any[] | undefined = this.networkMonitor.decodeErc20TransferEvent(
                  receipt,
                  holographableContractAddress,
                )
                if (erc20TransferEvent === undefined) {
                  this.networkMonitor.structuredLog(network, `Could not find a valid ERC20 Transfer event`, tags)
                } else {
                  const direction = 'in'
                  this.networkMonitor.structuredLog(
                    network,
                    `Calling updateBridgedERC20 with direction ${direction}`,
                    tags,
                  )
                  await this.updateBridgedERC20(
                    direction,
                    transaction,
                    network,
                    fromNetwork,
                    holographableContractAddress,
                    erc20TransferEvent,
                    erc20BeamInfo,
                    operatorJobHash,
                    tags,
                  )
                }
              } else if (contractType === 'HolographERC721') {
                this.networkMonitor.structuredLog(network, `BridgeInRequest identified as ERC721 transfer`, tags)
                // Bridge i
                const erc721BeamInfo: BridgeInErc721Args = decodeBridgeInErc721Args(bridgeInPayload)
                const erc721TransferEvent: any[] | undefined = this.networkMonitor.decodeErc721TransferEvent(
                  receipt,
                  holographableContractAddress,
                )
                if (erc721TransferEvent === undefined) {
                  this.networkMonitor.structuredLog(network, `Could not find a valid ERC721 Transfer event`, tags)
                } else {
                  this.networkMonitor.structuredLog(network, `updateBridgedERC721`, tags)
                  const direction = 'in'
                  this.networkMonitor.structuredLog(
                    network,
                    `Calling updateBridgedERC721 with direction ${direction}`,
                    tags,
                  )
                  await this.updateBridgedERC721(
                    direction,
                    transaction,
                    network,
                    fromNetwork,
                    toNetwork,
                    contractType,
                    holographableContractAddress,
                    erc721TransferEvent,
                    erc721BeamInfo,
                    operatorJobHash,
                    tags,
                  )
                }
              } else {
                this.networkMonitor.structuredLog(network, `unknown BridgeInRequest contractType`, tags)
              }
            }
          }
        }
      } else {
        this.networkMonitor.structuredLog(
          network,
          `Function call was ${parsedTransaction.name} and not executeJob`,
          tags,
        )
      }
    } else {
      this.networkMonitor.structuredLog(network, `Transaction failed, ignoring it`, tags)
    }
  }

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
      this.networkMonitor.structuredLog(network, `Checking for job hash`, tags)
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
        this.networkMonitor.structuredLog(network, `No CrossChainMessageSent event found`, tags)
      } else {
        // check that operatorJobPayload and operatorJobHash are the same
        if (sha3(operatorJobPayload) !== operatorJobHash) {
          throw new Error('The hashed operatorJobPayload does not equal operatorJobHash!')
        }

        const bridgeTransaction: TransactionDescription =
          this.networkMonitor.bridgeContract.interface.parseTransaction(transaction)
        if (bridgeTransaction.name === 'bridgeOutRequest') {
          const bridgeOut: BridgeOutArgs = bridgeTransaction.args as unknown as BridgeOutArgs
          const fromNetwork: string = network
          const toNetwork: string = getNetworkByHolographId(bridgeOut.toChain).key
          const bridgeOutPayload: string = bridgeOut.bridgeOutPayload
          const holographableContractAddress: string = bridgeOut.holographableContract.toLowerCase()
          if (holographableContractAddress === this.networkMonitor.factoryAddress) {
            // Bridge out contract deployment
            const deploymentConfig: DeploymentConfig = decodeDeploymentConfig(bridgeOutPayload)
            const deploymentHash: string = deploymentConfigHash(deploymentConfig)
            const contractAddress = create2address(deploymentConfig, this.networkMonitor.factoryAddress)
            const deploymentEvent: string[] = [contractAddress, deploymentHash]
            const direction = 'out'
            this.networkMonitor.structuredLog(
              network,
              `Calling updateBridgedContract with direction ${direction}`,
              tags,
            )
            await this.updateBridgedContract(
              direction,
              transaction,
              network,
              toNetwork,
              contractAddress,
              deploymentEvent,
              deploymentConfig,
              operatorJobHash,
              tags,
            )
          } else {
            const slot: string = await this.networkMonitor.providers[network].getStorageAt(
              holographableContractAddress,
              storageSlot('eip1967.Holograph.contractType'),
            )
            const contractType: string = toAscii(slot)
            if (contractType === 'HolographERC20') {
              // Bridge out ERC20 token
              const erc20BeamInfo: BridgeOutErc20Args = decodeBridgeOutErc20Args(bridgeOutPayload)
              const erc20TransferEvent: any[] | undefined = this.networkMonitor.decodeErc20TransferEvent(
                receipt,
                holographableContractAddress,
              )
              if (erc20TransferEvent === undefined) {
                this.networkMonitor.structuredLog(
                  network,
                  `Bridge erc20 transfer event not found for ${transaction.hash}`,
                  tags,
                )
              } else {
                // We do not currently capture bridge events for ERC20 tokens
                const direction = 'out'
                this.networkMonitor.structuredLog(
                  network,
                  `Calling updateBridgedERC20 with direction ${direction}`,
                  tags,
                )
                await this.updateBridgedERC20(
                  direction,
                  transaction,
                  network,
                  toNetwork,
                  holographableContractAddress,
                  erc20TransferEvent,
                  erc20BeamInfo,
                  operatorJobHash,
                  tags,
                )
              }
            } else if (contractType === 'HolographERC721') {
              // Bridge in ERC721 token
              const erc721BeamInfo: BridgeOutErc721Args = decodeBridgeOutErc721Args(bridgeOutPayload)
              const erc721TransferEvent: any[] | undefined = this.networkMonitor.decodeErc721TransferEvent(
                receipt,
                holographableContractAddress,
              )
              if (erc721TransferEvent === undefined) {
                this.networkMonitor.structuredLog(
                  network,
                  `Bridge erc721 transfer event not found for ${transaction.hash}`,
                  tags,
                )
              } else {
                const direction = 'out'
                this.networkMonitor.structuredLog(
                  network,
                  `Calling updateBridgedERC721 with direction ${direction}`,
                  tags,
                )
                await this.updateBridgedERC721(
                  direction,
                  transaction,
                  network,
                  fromNetwork,
                  toNetwork,
                  contractType,
                  holographableContractAddress,
                  erc721TransferEvent,
                  erc721BeamInfo,
                  operatorJobHash,
                  tags,
                )
              }
            } else {
              this.networkMonitor.structuredLog(network, `unknown bridgeOutRequest contractType`, tags)
            }
          }
        } else {
          this.networkMonitor.structuredLog(
            network,
            `Function call was ${bridgeTransaction.name} and not bridgeOutRequest`,
            tags,
          )
        }
      }
    } else {
      this.networkMonitor.structuredLog(network, `Transaction failed, ignoring it`, tags)
    }
  }

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
      this.networkMonitor.structuredLog(network, `Checking for job hash`, tags)
      const operatorJobPayloadData = this.networkMonitor.decodeAvailableOperatorJobEvent(
        receipt,
        this.networkMonitor.operatorAddress,
      )
      const operatorJobHash = operatorJobPayloadData === undefined ? undefined : operatorJobPayloadData[0]
      const operatorJobPayload = operatorJobPayloadData === undefined ? undefined : operatorJobPayloadData[1]
      if (operatorJobHash === undefined) {
        this.networkMonitor.structuredLog(network, `No AvailableOperatorJob event found`, tags)
      } else {
        // Check that operatorJobPayload and operatorJobHash are the same
        if (sha3(operatorJobPayload) !== operatorJobHash) {
          throw new Error('The hashed operatorJobPayload does not equal operatorJobHash!')
        }

        this.networkMonitor.structuredLog(network, `Decoding bridgeInRequest`, tags)
        const bridgeTransaction: TransactionDescription = this.networkMonitor.bridgeContract.interface.parseTransaction(
          {data: operatorJobPayload!},
        )
        if (bridgeTransaction.name === 'bridgeInRequest') {
          const bridgeIn: BridgeInArgs = bridgeTransaction.args as unknown as BridgeInArgs
          const fromNetwork: string = getNetworkByHolographId(bridgeIn.fromChain).key
          const toNetwork: string = network
          const bridgeInPayload: string = bridgeIn.bridgeInPayload
          const holographableContractAddress: string = bridgeIn.holographableContract.toLowerCase()

          // Bridge out contract deployment
          if (holographableContractAddress === this.networkMonitor.factoryAddress) {
            const deploymentConfig: DeploymentConfig = decodeDeploymentConfig(bridgeInPayload)
            const deploymentHash: string = deploymentConfigHash(deploymentConfig)
            const contractAddress = create2address(deploymentConfig, this.networkMonitor.factoryAddress)
            const deploymentEvent: string[] = [contractAddress, deploymentHash]
            const direction = 'msg'
            this.networkMonitor.structuredLog(
              network,
              `Calling updateBridgedContract with direction ${direction}`,
              tags,
            )
            await this.updateBridgedContract(
              direction,
              transaction,
              network,
              toNetwork,
              contractAddress,
              deploymentEvent,
              deploymentConfig,
              operatorJobHash,
              tags,
            )
          } else {
            const slot: string = await this.networkMonitor.providers[network].getStorageAt(
              holographableContractAddress,
              storageSlot('eip1967.Holograph.contractType'),
            )
            const contractType: string = toAscii(slot)
            if (contractType === 'HolographERC20') {
              // Bridge out ERC20 token
              const erc20BeamInfo: BridgeOutErc20Args = decodeBridgeOutErc20Args(bridgeInPayload)
              const erc20TransferEvent: any[] | undefined = this.networkMonitor.decodeErc20TransferEvent(
                receipt,
                holographableContractAddress,
              )
              if (erc20TransferEvent === undefined) {
                this.networkMonitor.structuredLog(
                  network,
                  `Bridge erc20 transfer event not found for ${transaction.hash}`,
                  tags,
                )
              } else {
                // We do not currently capture bridge events for ERC
                const direction = 'msg'
                this.networkMonitor.structuredLog(
                  network,
                  `Calling updateBridgedERC20 with direction ${direction}`,
                  tags,
                )
                await this.updateBridgedERC20(
                  direction,
                  transaction,
                  network,
                  toNetwork,
                  holographableContractAddress,
                  erc20TransferEvent,
                  erc20BeamInfo,
                  operatorJobHash,
                  tags,
                )
              }
            } else if (contractType === 'HolographERC721') {
              // Bridge in ERC721 token
              const erc721BeamInfo: BridgeInErc721Args = decodeBridgeInErc721Args(bridgeInPayload)
              const direction = 'msg'
              this.networkMonitor.structuredLog(
                network,
                `Calling updateBridgedERC721 with direction ${direction}`,
                tags,
              )
              await this.updateBridgedERC721(
                direction,
                transaction,
                network,
                fromNetwork,
                toNetwork,
                contractType,
                holographableContractAddress,
                [erc721BeamInfo.from, erc721BeamInfo.to, BigNumber.from(erc721BeamInfo.tokenId)],
                erc721BeamInfo,
                operatorJobHash,
                tags,
              )
            }
          }

          this.networkMonitor.structuredLog(network, `Found a valid bridgeInRequest for ${transaction.hash}`, tags)
        } else {
          this.networkMonitor.structuredLog(network, `Unknown bridgeIn function executed for ${transaction.hash}`, tags)
        }

        this.networkMonitor.structuredLog(
          network,
          `Bridge-In transaction type: ${bridgeTransaction.name} -->> ${bridgeTransaction.args}`,
        )
      }
    } else {
      this.networkMonitor.structuredLog(network, `Transaction failed, ignoring it`, tags)
    }
  }

  async updateContractCallback(
    data: any,
    transaction: TransactionResponse,
    network: string,
    contractAddress: string,
    deploymentConfig: DeploymentConfig,
    tags: (string | number)[],
  ): Promise<void> {
    this.networkMonitor.structuredLog(network, `Successfully found Collection with address ${contractAddress}`, tags)
    this.networkMonitor.structuredLog(
      network,
      `API: Requesting to update Collection ${contractAddress} with id ${data.id}`,
      tags,
    )

    const input = {
      updateCollectionInput: {
        id: data.collectionByContractAddress.id,
        contractAddress,
        // TODO: decide if this should be included in API call
        // contractCreator: deploymentConfig.signer,
        chainId: transaction.chainId,
        status: 'DEPLOYED',
        salt: deploymentConfig.config.salt,
        tx: transaction.hash,
        // TODO: decide if this should be included in API call
        // blockTimestamp: transaction.timestamp,
      },
    }

    const mutation = gql`
    mutation($updateCollectionInput: UpdateCollectionInput!) {
      updateCollection(updateCollectionInput: $updateCollectionInput) {
        id
        name
        description
        status
        chainId
        tx
      }
    }
    `

    const structuredLogInfo = {network: network, tagId: tags}
    const rawResponse = await this.apiService.sendMutationRequest(mutation, input, structuredLogInfo)
    if (rawResponse !== undefined) {
      const {data: response, headers} = rawResponse

      const requestId = headers.get('x-request-id') ?? ''

      this.networkMonitor.structuredLog(
        network,
        `API: Successfully updated Collection ${contractAddress} with id ${data.id}. Response: ${JSON.stringify(
          response,
        )}`,
        [...tags, requestId],
      )
    }
  }

  async updateDeployedContract(
    transaction: TransactionResponse,
    network: string,
    contractAddress: string,
    deploymentEvent: string[],
    deploymentConfig: DeploymentConfig,
    tags: (string | number)[],
  ): Promise<void> {
    // Here we need to extract origin chain from config
    // to know if this is the main deployment chain for the contract or not
    // this would allow us to update the db contract deployment tx and to set chain column
    this.networkMonitor.structuredLog(
      network,
      `HolographFactory deployed a new collection on ${capitalize(
        network,
      )} at address ${contractAddress}. Wallet that deployed the collection is ${
        transaction.from
      }. The config used for deployHolographableContract was ${JSON.stringify(
        deploymentConfig,
        undefined,
        2,
      )}. The transaction hash is: ${transaction.hash}`,
    )
    this.networkMonitor.structuredLog(
      network,
      `Sending deployed collection job to DBJobManager ${contractAddress}`,
      tags,
    )
    const query = gql`
    query($contractAddress: String!) {
      collectionByContractAddress(contractAddress: $contractAddress) {
        id
        contractAddress
        name
      }
    }
    `
    const job: DBJob = {
      attempts: 0,
      network,
      timestamp: await this.getBlockTimestamp(network, transaction.blockNumber!),
      message: `API: Requesting to get Collection with address ${contractAddress}`,
      query,
      callback: this.updateContractCallback,
      arguments: [transaction, network, contractAddress, deploymentConfig, tags],
      identifier: {contractAddress: contractAddress},
      tags,
    }
    if (!(job.timestamp in this.dbJobMap)) {
      this.dbJobMap[job.timestamp] = []
    }

    this.dbJobMap[job.timestamp].push(job)
  }

  async updateBridgedContract(
    direction: string,
    transaction: TransactionResponse,
    network: string,
    fromNetwork: string,
    contractAddress: string,
    deploymentEvent: string[],
    deploymentConfig: DeploymentConfig,
    operatorJobHash: string,
    tags: (string | number)[],
  ): Promise<void> {
    // Not updating DB for any initial call outs since there is no beam status table for this yet
    if (direction === 'in') {
      // Here we need to extract origin chain from config
      // to know if this is the main deployment chain for the contract or not
      // this would allow us to update the db contract deployment tx and to set chain column
      this.networkMonitor.structuredLog(
        network,
        `HolographOperator executed a job which bridged a collection. HolographFactory deployed a new collection on ${capitalize(
          network,
        )} at address ${contractAddress}. Operator that deployed the collection is ${
          transaction.from
        }. The config used for deployHolographableContract function was ${JSON.stringify(
          deploymentConfig,
          undefined,
          2,
        )}`,
        tags,
      )
      this.networkMonitor.structuredLog(
        network,
        `Sending bridged collection job to DBJobManager ${contractAddress}`,
        tags,
      )
      const query = gql`
      query($contractAddress: String!) {
        collectionByContractAddress(contractAddress: $contractAddress) {
          id
          contractAddress
          name
        }
      }
      `

      const job: DBJob = {
        attempts: 0,
        network,
        timestamp: await this.getBlockTimestamp(network, transaction.blockNumber!),
        query,
        message: `API: Requesting to get Collection with address ${contractAddress}`,
        callback: this.updateContractCallback,
        arguments: [transaction, network, contractAddress, deploymentConfig, tags],
        identifier: {contractAddress: contractAddress},
        tags,
      }
      if (!(job.timestamp in this.dbJobMap)) {
        this.dbJobMap[job.timestamp] = []
      }

      this.dbJobMap[job.timestamp].push(job)
    }
  }

  async updateBridgedERC20(
    direction: string,
    transaction: TransactionResponse,
    network: string,
    fromNetwork: string,
    contractAddress: string,
    erc20TransferEvent: any[],
    erc20BeamInfo: BridgeInErc20Args | BridgeOutErc20Args,
    operatorJobHash: string,
    tags: (string | number)[],
  ): Promise<void> {
    this.networkMonitor.structuredLog(
      network,
      `${transaction.hash} for ERC20 not yet managed ${JSON.stringify(erc20BeamInfo)}`,
      tags,
    )
  }

  async updateBridgedERC721(
    direction: string,
    transaction: TransactionResponse,
    network: string,
    fromNetwork: string,
    toNetwork: string,
    contractType: string,
    contractAddress: string,
    erc721TransferEvent: any[],
    erc721BeamInfo: BridgeInErc721Args | BridgeOutErc721Args,
    operatorJobHash: string,
    tags: (string | number)[],
  ): Promise<void> {
    const tokenId = hexZeroPad(erc721TransferEvent[2].toHexString(), 32)

    this.networkMonitor.structuredLog(
      network,
      `HolographOperator executed a job which minted an ERC721 NFT. Holographer minted a new NFT on ${capitalize(
        network,
      )} at address ${contractAddress}. The ID of the NFT is ${tokenId}. Operator that minted the nft is ${
        transaction.from
      }`,
      tags,
    )
    this.networkMonitor.structuredLog(network, `Sending bridged nft job to DBJobManager ${contractAddress}`, tags)
    const query = gql`
      query($contractAddress: String!, $tokenId: String!) {
        nftByContractAddressAndTokenId(contractAddress: $contractAddress, tokenId: $tokenId) {
          id
          tx
          chainId
          status
          collectionId
          contractAddress
          tokenId
        }
      }
    `
    const job: DBJob = {
      attempts: 0,
      network,
      timestamp: await this.getBlockTimestamp(network, transaction.blockNumber!),
      query,
      message: `API: Requesting to get NFT with tokenId ${tokenId} from ${contractAddress}`,
      callback: this.updateBridgedERC721Callback,
      arguments: [transaction, network, direction, contractAddress, tokenId, tags],
      identifier: {contractAddress: contractAddress, tokenId: tokenId},
      tags,
    }
    if (!(job.timestamp in this.dbJobMap)) {
      this.dbJobMap[job.timestamp] = []
    }

    this.dbJobMap[job.timestamp].push(job)

    const crossChainTxType: string =
      direction === 'in' ? 'bridgeIn' : direction === 'out' ? 'bridgeOut' : 'relayMessage'

    await this.updateCrossChainTransaction(
      crossChainTxType,
      network,
      transaction,
      fromNetwork,
      toNetwork,
      contractAddress,
      contractType,
      tokenId,
      operatorJobHash,
      tags,
    )
  }

  async updateMintedERC721(
    transaction: TransactionResponse,
    network: string,
    contractType: string,
    contractAddress: string,
    erc721TransferEvent: any[],
    tags: (string | number)[],
  ): Promise<void> {
    const tokenId = hexZeroPad(erc721TransferEvent[2].toHexString(), 32)
    this.networkMonitor.structuredLog(
      network,
      `Indexer identified a minted an ERC721 NFT. Holographer minted a new NFT on ${capitalize(
        network,
      )} at address ${contractAddress}. The ID of the NFT is ${tokenId}. Account that minted the nft is ${
        transaction.from
      }`,
      tags,
    )

    this.networkMonitor.structuredLog(network, `Checking if contract ${contractAddress} is on registry ...`, tags)

    this.networkMonitor.structuredLog(
      network,
      `registry Contract address = ${this.networkMonitor.registryContract.address}`,
      tags,
    )

    const isHolographable: boolean = await this.networkMonitor.registryContract.isHolographedContract(contractAddress)
    this.networkMonitor.structuredLog(
      network,
      `isHolographable = ${isHolographable} with type = ${typeof isHolographable}`,
      tags,
    )

    if (isHolographable === false) {
      this.networkMonitor.structuredLog(network, `Contract ${contractAddress} is not on registry`, tags)
      // return
    }

    this.networkMonitor.structuredLog(
      network,
      `Contract ${contractAddress} is in registry at ${this.environment}`,
      tags,
    )

    const query = gql`
      query($tx: String!) {
        nftByTx(tx: $tx) {
          id
          tx
          status
          chainId
        }
      }
    `
    this.networkMonitor.structuredLog(
      network,
      `Sending minted nft with tx ${transaction.hash} job to DBJobManager`,
      tags,
    )
    const job: DBJob = {
      attempts: 3,
      network,
      timestamp: await this.getBlockTimestamp(network, transaction.blockNumber!),
      query,
      message: `API: Requesting to update NFT with transaction hash ${transaction.hash}`,
      callback: this.updateERC721Callback,
      arguments: [transaction, network, tags],
      identifier: {tx: transaction.hash},
      tags,
    }
    if (!(job.timestamp in this.dbJobMap)) {
      this.dbJobMap[job.timestamp] = []
    }

    this.dbJobMap[job.timestamp].push(job)
  }

  async updateERC721Callback(
    data: any,
    transaction: TransactionResponse,
    network: string,
    tags: (string | number)[],
  ): Promise<void> {
    this.networkMonitor.structuredLog(network, `Successfully found NFT with tx ${transaction.hash} `, tags)
    this.networkMonitor.structuredLog(
      network,
      `API: Requesting to update NFT with ${data.nftByTx.tx} and id ${data.nftByTx.id}`,
      tags,
    )
    const mutation = gql`
    mutation($updateNftInput: UpdateNftInput!) {
      updateNft(updateNftInput: $updateNftInput) {
        id
        tx
        status
        chainId
      }
    }
    `
    // Include the on chain data in the update input
    const input: UpdateNftInput = {updateNftInput: data.nftByTx}
    input.updateNftInput.status = NftStatus.MINTED
    input.updateNftInput.chainId = transaction.chainId
    input.updateNftInput.tx = transaction.hash

    try {
      const structuredLogInfo = {network: network, tagId: tags}
      const rawResponse = await this.apiService.sendMutationRequest(mutation, input, structuredLogInfo)
      if (rawResponse !== undefined) {
        const {data: response, headers} = rawResponse

        const requestId = headers.get('x-request-id') ?? ''

        this.networkMonitor.structuredLog(
          network,
          `Successfully updated NFT with transaction hash ${response.updateNft?.tx}`,
          [...tags, requestId],
        )
      }
    } catch (error: any) {
      this.networkMonitor.structuredLog(network, `API: Failed to update NFT with tx ${data.nftByTx.tx}`, tags)
      this.networkMonitor.structuredLogError(network, error, [
        ...tags,
        this.errorColor(`Cross chain transaction ${data.nftByTx.tx}`),
      ])
    }
  }

  async updateBridgedERC721Callback(
    data: any,
    transaction: TransactionResponse,
    network: string,
    direction: string,
    tags: (string | number)[],
  ): Promise<void> {
    this.networkMonitor.structuredLog(
      network,
      `Successfully found NFT with contract address ${data.nftByContractAddressAndTokenId.contractAddress} and token id ${data.nftByContractAddressAndTokenId.tokenId} `,
      tags,
    )
    this.networkMonitor.structuredLog(
      network,
      `API: Requesting to update NFT with id ${data.nftByContractAddressAndTokenId.id} and tx ${data.nftByContractAddressAndTokenId.tx}`,
      tags,
    )

    const mutation = gql`
    mutation($updateNftInput: UpdateNftInput!) {
      updateNft(updateNftInput: $updateNftInput) {
        id
        tx
        status
        chainId
      }
    }
    `

    // Set the status and chainId of the NFT
    let status
    if (direction === 'in') {
      status = NftStatus.MINTED
    } else if (direction === 'out') {
      status = NftStatus.BRIDGING
    } else {
      status = NftStatus.BRIDGING
    }

    data.nftByContractAddressAndTokenId.status = status
    data.nftByContractAddressAndTokenId.chainId = transaction.chainId

    const input: UpdateNftInput = {updateNftInput: data.nftByContractAddressAndTokenId}
    const structuredLogInfo = {network: network, tagId: tags}
    const rawResponse = await this.apiService.sendMutationRequest(mutation, input, structuredLogInfo)
    if (rawResponse !== undefined) {
      const {data: response, headers} = rawResponse

      const requestId = headers.get('x-request-id') ?? ''

      this.networkMonitor.structuredLog(
        network,
        `Successfully updated NFT with transaction hash ${response.updateNft?.tx}. Response: ${JSON.stringify(
          response,
        )}`,
        [...tags, requestId],
      )
    }
  }

  async updateCrossChainTransactionCallback(
    data: any, // NftByContractAddressAndTokenIdQuery
    transaction: TransactionResponse,
    network: string,
    fromNetwork: string,
    toNetwork: string,
    contractAddress: string,
    tokenId: string,
    crossChainTxType: string,
    jobHash: string,
    tags: (string | number)[],
  ): Promise<void> {
    this.networkMonitor.structuredLog(
      network,
      `Successfully found NFT with tokenId ${tokenId} from ${contractAddress}`,
      tags,
    )

    // Get and convert the destination chain id from network name to chain id
    const destinationChainid = networks[toNetwork].chain

    let input
    this.networkMonitor.structuredLog(network, `Cross chain transaction type is ${crossChainTxType}`, tags)
    // Set the columns to update based on the type of cross-chain transaction
    switch (crossChainTxType) {
      case 'bridgeOut':
        input = {
          jobHash,
          jobType: 'ERC721',
          sourceTx: transaction.hash,
          sourceBlockNumber: transaction.blockNumber,
          sourceChainId: transaction.chainId,
          sourceStatus: 'COMPLETED',
          sourceAddress: transaction.from,
          nftId: data.nftByContractAddressAndTokenId.id,
          collectionId: data.nftByContractAddressAndTokenId.collectionId,
          // Include the destination chain id if the transaction is a bridge out
          messageChainId: destinationChainid,
          operatorChainId: destinationChainid,
        } as UpdateCrossChainTransactionStatusInput
        this.networkMonitor.structuredLog(
          network,
          this.apiColor(
            `API: Requesting to update cross chain transaction with ${jobHash} for brigdeOut with input ${JSON.stringify(
              input,
            )}`,
          ),
          tags,
        )

        if (this.environment === Environment.localhost || this.environment === Environment.experimental) {
          this.networkMonitor.structuredLog(
            network,
            `Environment is ${
              this.environment
            }: Skipping GraphQL call to update cross chain transaction with input ${JSON.stringify(input)}
            )}`,
            tags,
          )
        } else {
          try {
            const response = await this.apiService.updateCrossChainTransactionStatus(input)
            this.networkMonitor.structuredLog(
              network,
              this.apiColor(`API: Mutation cross chain transaction ${jobHash} response ${JSON.stringify(response)}`),
              tags,
            )
            this.networkMonitor.structuredLog(
              network,
              `Successfully updated cross chain transaction with ${jobHash}. Response: ${JSON.stringify(response)}`,
              tags,
            )
          } catch (error: any) {
            this.networkMonitor.structuredLog(network, `API: Failed to update cross chain transaction ${jobHash}`, tags)
            this.networkMonitor.structuredLogError(network, error, [
              ...tags,
              this.errorColor(`Cross chain transaction ${jobHash}`),
            ])
          }
        }

        break
      case 'relayMessage':
        input = {
          jobHash,
          jobType: 'ERC721',
          messageTx: transaction.hash,
          messageBlockNumber: transaction.blockNumber,
          messageChainId: transaction.chainId,
          messageStatus: 'COMPLETED',
          messageAddress: transaction.from,
          nftId: data.nftByContractAddressAndTokenId.id,
          collectionId: data.nftByContractAddressAndTokenId.collectionId,
        } as UpdateCrossChainTransactionStatusInput

        this.networkMonitor.structuredLog(
          network,
          this.apiColor(
            `API: Mutation cross chain transaction with ${jobHash} for relayMessage with input ${JSON.stringify(
              input,
            )}`,
          ),
          tags,
        )
        if (this.environment === Environment.localhost || this.environment === Environment.experimental) {
          this.networkMonitor.structuredLog(
            network,
            `Environment is ${
              this.environment
            }: Skipping GraphQL call to update cross chain transaction with input ${JSON.stringify(input)}
            )}`,
            tags,
          )
        } else {
          try {
            const response = await this.apiService.updateCrossChainTransactionStatus(input)
            this.networkMonitor.structuredLog(
              network,
              this.apiColor(`API: Cross chain transaction ${jobHash} mutation response ${JSON.stringify(response)}`),
              tags,
            )
            this.networkMonitor.structuredLog(
              network,
              `Successfully updated cross chain transaction with ${jobHash}. Response: ${JSON.stringify(response)}`,
              tags,
            )
          } catch (error: any) {
            this.networkMonitor.structuredLog(network, `API: Failed to update cross chain transaction ${jobHash}`, tags)
            this.networkMonitor.structuredLogError(network, error, [
              ...tags,
              this.errorColor(`Cross chain transaction ${jobHash}`),
            ])
          }
        }

        break
      case 'bridgeIn':
        input = {
          jobHash,
          jobType: 'ERC721',
          operatorTx: transaction.hash,
          operatorBlockNumber: transaction.blockNumber,
          operatorChainId: transaction.chainId,
          operatorStatus: 'COMPLETED',
          operatorAddress: transaction.from,
          nftId: data.nftByContractAddressAndTokenId.id,
          collectionId: data.nftByContractAddressAndTokenId.collectionId,
        } as UpdateCrossChainTransactionStatusInput

        this.networkMonitor.structuredLog(
          network,
          this.apiColor(
            `API:Cross chain transaction mutation with ${jobHash} for bridgeIn with input ${JSON.stringify(input)}`,
          ),
          tags,
        )
        if (this.environment === Environment.localhost || this.environment === Environment.experimental) {
          this.networkMonitor.structuredLog(
            network,
            `Environment is ${
              this.environment
            }: Skipping GraphQL call to update cross chain transaction with input ${JSON.stringify(input)}
            )}`,
            tags,
          )
        } else {
          try {
            const response = await this.apiService.updateCrossChainTransactionStatus(input)
            this.networkMonitor.structuredLog(
              network,
              this.apiColor(`API: Cross chain transaction ${jobHash} mutation response ${JSON.stringify(response)}`),
              tags,
            )
            this.networkMonitor.structuredLog(
              network,
              `Successfully updated cross chain transaction with ${jobHash}. Response: ${JSON.stringify(response)}`,
              tags,
            )
          } catch (error: any) {
            this.networkMonitor.structuredLog(network, `API: Failed to update cross chain transaction ${jobHash}`, tags)
            this.networkMonitor.structuredLogError(network, error, [
              ...tags,
              this.errorColor(`CrossChainTransaction ${jobHash}`),
            ])
          }
        }

        break
      default:
        // Unknown cross-chain transaction type
        this.networkMonitor.structuredLog(
          network,
          `Unknown cross chain type event ${crossChainTxType}. Will not process`,
        )
    }
  }

  async updateCrossChainTransaction(
    crossChainTxType: string,
    network: string,
    transaction: TransactionResponse,
    fromNetwork: string,
    toNetwork: string,
    contractAddress: string,
    contractType: string,
    tokenId: string,
    operatorJobHash: string,
    tags: (string | number)[],
  ): Promise<void> {
    this.networkMonitor.structuredLog(
      network,
      `Sending cross chain transaction job to DBJobManager ${contractAddress}`,
      tags,
    )

    const query = gql`
    query($contractAddress: String!, $tokenId: String!) {
      nftByContractAddressAndTokenId(contractAddress: $contractAddress, tokenId: $tokenId) {
        id
        tx
        chainId
        status
        collectionId
        contractAddress
        tokenId
      }
    }
    `
    const job: DBJob = {
      attempts: 0,
      network,
      timestamp: await this.getBlockTimestamp(network, transaction.blockNumber!),
      query,
      message: `API: Requesting to get NFT with tokenId ${tokenId} from ${contractAddress}`,
      callback: this.updateCrossChainTransactionCallback,
      arguments: [
        transaction,
        network,
        fromNetwork,
        toNetwork,
        contractAddress,
        tokenId,
        crossChainTxType,
        operatorJobHash,
        tags,
      ],
      identifier: {contractAddress, tokenId},
      tags,
    }
    if (!(job.timestamp in this.dbJobMap)) {
      this.dbJobMap[job.timestamp] = []
    }

    this.dbJobMap[job.timestamp].push(job)
  }

  async getBlockTimestamp(network: string, blockNumber: number): Promise<number> {
    let timestamp = 0
    const block: Block | null = await this.networkMonitor.getBlock({network, blockNumber, canFail: false})
    if (block !== null) {
      timestamp = block.timestamp
    }

    return timestamp
  }
}
