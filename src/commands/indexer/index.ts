import axios from 'axios'

import {CliUx, Command, Flags} from '@oclif/core'
import {TransactionDescription} from '@ethersproject/abi'
import {Block, TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'
import {hexZeroPad} from '@ethersproject/bytes'

import {ensureConfigFileIsValid} from '../../utils/config'
import {Environment} from '@holographxyz/environment'
import {getNetworkByHolographId} from '@holographxyz/networks'
import {capitalize, sleep, sha3, functionSignature, storageSlot, toAscii} from '../../utils/utils'
import {
  DeploymentConfig,
  decodeDeploymentConfig,
  decodeDeploymentConfigInput,
  deploymentConfigHash,
  create2address,
} from '../../utils/contract-deployment'

import {networksFlag, warpFlag, FilterType, BlockJob, NetworkMonitor} from '../../utils/network-monitor'
import {
  BridgeInArgs,
  BridgeInErc20Args,
  BridgeInErc721Args,
  decodeBridgeIn,
  decodeBridgeInErc20Args,
  decodeBridgeInErc721Args,
  BridgeOutArgs,
  BridgeOutErc20Args,
  BridgeOutErc721Args,
  decodeBridgeOutErc20Args,
  decodeBridgeOutErc721Args,
} from '../../utils/bridge'
import {healthcheckFlag, startHealthcheckServer} from '../../utils/health-check-server'

import dotenv from 'dotenv'
import color from '@oclif/color'
dotenv.config()

type DBJob = {
  attempts: number
  timestamp: number
  network: string
  query: string
  message: string
  // eslint-disable-next-line @typescript-eslint/ban-types
  callback: Function
  arguments: any[]
  tags: (string | number)[]
}

type DBJobMap = {
  [key: number]: DBJob[]
}

type PatchOptions = {
  responseData: any
  network: string
  query: string
  data: any
  messages: string[]
}

export default class Indexer extends Command {
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
    ...healthcheckFlag,
    ...warpFlag,
  }

  // API Params
  BASE_URL!: string
  JWT!: string
  DELAY = 20_000
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

    this.log('Loading user configurations...')
    const {environment, configFile} = await ensureConfigFileIsValid(this.config.configDir, undefined, false)
    this.log('User configurations loaded.')

    this.environment = environment

    if (this.environment === Environment.localhost || this.environment === Environment.experimental) {
      this.log(`Skiping API authentication for ${Environment[this.environment]} environment`)
    } else {
      this.log(this.apiColor(`API: Authenticating with ${this.BASE_URL}`))
      let res
      try {
        res = await axios.post(`${this.BASE_URL}/v1/auth/operator`, {
          hash: process.env.OPERATOR_API_KEY,
        })
        this.debug(JSON.stringify(res.data))
      } catch (error: any) {
        this.error(error.message)
      }

      this.JWT = res!.data.accessToken

      if (typeof this.JWT === 'undefined') {
        this.error('Failed to authorize as an operator')
      }

      this.debug(`process.env.OPERATOR_API_KEY = ${process.env.OPERATOR_API_KEY}`)
      this.debug(`this.JWT = ${this.JWT}`)
    }

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      networks: flags.networks,
      debug: this.debug,
      processTransactions: this.processTransactions,
      lastBlockFilename: 'indexer-blocks.json',
      warp: flags.warp,
    })

    // Indexer always synchronizes missed blocks
    this.networkMonitor.latestBlockHeight = await this.networkMonitor.loadLastBlocks(this.config.configDir)

    CliUx.ux.action.start(`Starting indexer`)
    await this.networkMonitor.run(!(flags.warp > 0), undefined, this.filterBuilder)
    CliUx.ux.action.stop('🚀')

    // Start server
    if (enableHealthCheckServer) {
      startHealthcheckServer(this.networkMonitor)
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
    return Promise.resolve()
  }

  async processDBJob(timestamp: number, job: DBJob): Promise<void> {
    this.networkMonitor.structuredLog(job.network, job.message)
    let res: any
    if (this.environment === Environment.localhost || this.environment === Environment.experimental) {
      this.networkMonitor.structuredLog(job.network, `Should make an API GET call with query ${job.query}`, job.tags)
      await job.callback.bind(this)('', ...job.arguments)
      this.processDBJobs()
    } else {
      try {
        res = await axios.get(job.query, {
          maxRedirects: 0,
          headers: {
            Authorization: `Bearer ${this.JWT}`,
            'Content-Type': 'application/json',
          },
        })
        this.networkMonitor.structuredLog(job.network, `GET response ${JSON.stringify(res.data)}`, job.tags)
        await job.callback.bind(this)(res.data, ...job.arguments)
        this.processDBJobs()
      } catch (error: any) {
        this.networkMonitor.structuredLogError(job.network, error.response.data, [
          ...job.tags,
          this.errorColor(`Failed to GET ${job.query}`),
        ])
        // one second interval
        await sleep(1000)
        this.processDBJobs(timestamp, job)
      }
    }
  }

  processDBJobs(timestamp?: number, job?: DBJob): void {
    if (timestamp !== undefined && job !== undefined) {
      if (!(timestamp in this.dbJobMap)) {
        this.dbJobMap[timestamp] = []
      }

      job.attempts += 1
      this.networkMonitor.structuredLog(
        job.network,
        `JOB ${job.query} is being executed with attempt ${job.attempts}`,
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
        this.dbJobMap[timestamp].push(job)
      } else {
        this.dbJobMap[timestamp].unshift(job)
      }
    }

    const timestamps: number[] = this.numberfy(Object.keys(this.dbJobMap))
    if (timestamps.length > 0) {
      timestamps.sort(this.numericSort)
      const timestamp: number = timestamps[0]
      if (this.dbJobMap[timestamp].length > 0) {
        const job: DBJob = this.dbJobMap[timestamp].shift()!
        this.processDBJob(timestamp, job)
      } else {
        delete this.dbJobMap[timestamp]
        setTimeout(this.processDBJobs.bind(this), 1000)
      }
    } else {
      setTimeout(this.processDBJobs.bind(this), 1000)
    }
  }

  async processTransactions(job: BlockJob, transactions: TransactionResponse[]): Promise<void> {
    /* eslint-disable no-await-in-loop */
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
            this.networkMonitor.structuredLog(job.network, `handleContractDeployedEvent`, tags)
            await this.handleContractDeployedEvent(transaction, job.network, tags)

            break
          }

          case this.networkMonitor.bridgeAddress: {
            this.networkMonitor.structuredLog(job.network, `handleBridgeOutEvent`, tags)
            await this.handleBridgeOutEvent(transaction, job.network, tags)

            break
          }

          case this.networkMonitor.operatorAddress: {
            this.networkMonitor.structuredLog(job.network, `handleBridgeInEvent`, tags)
            await this.handleBridgeInEvent(transaction, job.network, tags)

            break
          }

          default:
            if (from === this.networkMonitor.LAYERZERO_RECEIVERS[job.network]) {
              this.networkMonitor.structuredLog(job.network, `handleAvailableOperatorJobEvent`, tags)
              await this.handleAvailableOperatorJobEvent(transaction, job.network, tags)
            } else if (functionSig === functionSignature('cxipMint(uint224,uint8,string)')) {
              this.networkMonitor.structuredLog(job.network, `handleMintEvent`, tags)
              await this.handleMintEvent(transaction, job.network, tags)
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
      this.networkMonitor.structuredLog(
        network,
        `Checking if a new Holograph contract was deployed at tx: ${transaction.hash}`,
        tags,
      )
      const deploymentEvent: any[] | undefined = this.networkMonitor.decodeBridgeableContractDeployedEvent(
        receipt,
        this.networkMonitor.factoryAddress,
      )
      if (deploymentEvent !== undefined) {
        const deploymentConfig: DeploymentConfig = decodeDeploymentConfigInput(transaction.data)
        const deploymentHash: string = deploymentConfigHash(deploymentConfig)
        const contractAddress = create2address(deploymentConfig, this.networkMonitor.factoryAddress)
        if (deploymentHash !== deploymentEvent[1]) {
          throw new Error(`Deployment config hashes ${deploymentHash} and ${deploymentEvent[1]} do not match!`)
        }

        if (contractAddress !== deploymentEvent[0]) {
          throw new Error(`Deployment addresses ${contractAddress} and ${deploymentEvent[0]} do not match!`)
        }

        await this.updateDeployedContract(
          transaction,
          network,
          contractAddress,
          deploymentEvent,
          deploymentConfig,
          tags,
        )
      }
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

    const holographableContractAddress: string = transaction.to!
    const erc721TransferEvent: any[] | undefined = this.networkMonitor.decodeErc721TransferEvent(
      receipt,
      holographableContractAddress,
    )
    if (erc721TransferEvent === undefined) {
      this.networkMonitor.structuredLog(network, `Could not find a ERC721 Transfer event for ${transaction.hash}`, tags)
    } else {
      const slot: string = await this.networkMonitor.providers[network].getStorageAt(
        holographableContractAddress,
        storageSlot('eip1967.Holograph.contractType'),
      )
      const contractType: string = toAscii(slot)
      await this.updateMintedERC721(
        transaction,
        network,
        contractType,
        holographableContractAddress,
        erc721TransferEvent,
        tags,
      )
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
          const bridgeTransaction: TransactionDescription | null =
            this.networkMonitor.bridgeContract.interface.parseTransaction({data: operatorJobPayload!})
          if (bridgeTransaction === null) {
            this.networkMonitor.structuredLog(network, `Could not decode Bridge function for ${transaction.hash}`, tags)
          } else {
            const bridgeIn: BridgeInArgs = bridgeTransaction.args as unknown as BridgeInArgs
            const fromNetwork: string = getNetworkByHolographId(bridgeIn.fromChain).key
            const bridgeInPayload: string = bridgeIn.bridgeInPayload
            const holographableContractAddress: string = bridgeIn.holographableContract.toLowerCase()
            if (holographableContractAddress === this.networkMonitor.factoryAddress) {
              // BRIDGE IN CONTRACT DEPLOYMENT
              const deploymentEvent: string[] | undefined = this.networkMonitor.decodeBridgeableContractDeployedEvent(
                receipt,
                this.networkMonitor.factoryAddress,
              )
              if (deploymentEvent === undefined) {
                this.networkMonitor.structuredLog(
                  network,
                  `Bridge contract deployment event not found for ${transaction.hash}`,
                  tags,
                )
              } else {
                const deploymentConfig: DeploymentConfig = decodeDeploymentConfig(bridgeInPayload)
                const deploymentHash: string = deploymentConfigHash(deploymentConfig)
                const contractAddress = create2address(deploymentConfig, this.networkMonitor.factoryAddress)
                if (deploymentHash !== deploymentEvent[1]) {
                  throw new Error(`Deployment config hashes ${deploymentHash} and ${deploymentEvent[1]} do not match!`)
                }

                if (contractAddress !== deploymentEvent[0]) {
                  throw new Error(`Deployment addresses ${contractAddress} and ${deploymentEvent[0]} do not match!`)
                }

                await this.updateBridgedContract(
                  'in',
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
              const slot: string = await this.networkMonitor.providers[network].getStorageAt(
                holographableContractAddress,
                storageSlot('eip1967.Holograph.contractType'),
              )
              const contractType: string = toAscii(slot)
              if (contractType === 'HolographERC20') {
                // BRIDGE IN ERC20 TOKENS
                const erc20BeamInfo: BridgeInErc20Args = decodeBridgeInErc20Args(bridgeInPayload)
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
                  await this.updateBridgedERC20(
                    'in',
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
                // BRIDGE IN ERC721 NFT
                const erc721BeamInfo: BridgeInErc721Args = decodeBridgeInErc721Args(bridgeInPayload)
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
                  await this.updateBridgedERC721(
                    'in',
                    transaction,
                    network,
                    fromNetwork,
                    contractType,
                    holographableContractAddress,
                    erc721TransferEvent,
                    erc721BeamInfo,
                    operatorJobHash,
                    tags,
                  )
                }
              }
            }
          }

          this.networkMonitor.structuredLog(network, `Found a valid bridgeInRequest for ${transaction.hash}`, tags)
        }
      } else {
        this.networkMonitor.structuredLog(network, `Unknown bridgeIn function executed for ${transaction.hash}`, tags)
      }
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
        this.networkMonitor.structuredLog(
          network,
          `Could not find a LayerZero packet event for ${transaction.hash}`,
          tags,
        )
      } else {
        // check that operatorJobPayload and operatorJobHash are the same
        if (sha3(operatorJobPayload) !== operatorJobHash) {
          throw new Error('The hashed operatorJobPayload does not equal operatorJobHash!')
        }

        const bridgeTransaction: TransactionDescription =
          this.networkMonitor.bridgeContract.interface.parseTransaction(transaction)
        if (bridgeTransaction.name === 'bridgeOutRequest') {
          const bridgeOut: BridgeOutArgs = bridgeTransaction.args as unknown as BridgeOutArgs
          const toNetwork: string = getNetworkByHolographId(bridgeOut.toChain).key
          const bridgeOutPayload: string = bridgeOut.bridgeOutPayload
          const holographableContractAddress: string = bridgeOut.holographableContract.toLowerCase()
          if (holographableContractAddress === this.networkMonitor.factoryAddress) {
            // BRIDGE OUT CONTRACT DEPLOYMENT
            const deploymentConfig: DeploymentConfig = decodeDeploymentConfig(bridgeOutPayload)
            const deploymentHash: string = deploymentConfigHash(deploymentConfig)
            const contractAddress = create2address(deploymentConfig, this.networkMonitor.factoryAddress)
            const deploymentEvent: string[] = [contractAddress, deploymentHash]
            await this.updateBridgedContract(
              'out',
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
              // BRIDGE OUT ERC20 TOKENS
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
                // we do not currently capture
                await this.updateBridgedERC20(
                  'out',
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
              // BRIDGE IN ERC721 NFT
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
                await this.updateBridgedERC721(
                  'out',
                  transaction,
                  network,
                  toNetwork,
                  contractType,
                  holographableContractAddress,
                  erc721TransferEvent,
                  erc721BeamInfo,
                  operatorJobHash,
                  tags,
                )
              }
            }
          }

          this.networkMonitor.structuredLog(network, `Found a valid bridgeOutRequest for ${transaction.hash}`, tags)
        } else {
          this.networkMonitor.structuredLog(
            network,
            `Unknown bridgeOut function executed for ${transaction.hash}`,
            tags,
          )
        }
      }
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
      const operatorJobPayloadData = this.networkMonitor.decodeAvailableOperatorJobEvent(
        receipt,
        this.networkMonitor.operatorAddress,
      )
      const operatorJobHash = operatorJobPayloadData === undefined ? undefined : operatorJobPayloadData[0]
      const operatorJobPayload = operatorJobPayloadData === undefined ? undefined : operatorJobPayloadData[1]
      if (operatorJobHash === undefined) {
        this.networkMonitor.structuredLog(
          network,
          `Could not extract relayer available job for ${transaction.hash}`,
          tags,
        )
      } else {
        // check that operatorJobPayload and operatorJobHash are the same
        if (sha3(operatorJobPayload) !== operatorJobHash) {
          throw new Error('The hashed operatorJobPayload does not equal operatorJobHash!')
        }

        const bridgeTransaction: TransactionDescription = this.networkMonitor.bridgeContract.interface.parseTransaction(
          {data: operatorJobPayload!},
        )
        if (bridgeTransaction.name === 'bridgeOutRequest') {
          const bridgeOut: BridgeOutArgs = bridgeTransaction.args as unknown as BridgeOutArgs
          const toNetwork: string = getNetworkByHolographId(bridgeOut.toChain).key
          const bridgeOutPayload: string = decodeBridgeIn(bridgeOut.bridgeOutPayload).payload
          const holographableContractAddress: string = bridgeOut.holographableContract.toLowerCase()

          if (holographableContractAddress === this.networkMonitor.factoryAddress) {
            // BRIDGE OUT CONTRACT DEPLOYMENT
            const deploymentConfig: DeploymentConfig = decodeDeploymentConfig(bridgeOutPayload)
            const deploymentHash: string = deploymentConfigHash(deploymentConfig)
            const contractAddress = create2address(deploymentConfig, this.networkMonitor.factoryAddress)
            const deploymentEvent: string[] = [contractAddress, deploymentHash]
            await this.updateBridgedContract(
              'msg',
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
              // BRIDGE OUT ERC20 TOKENS
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
                // we do not currently capture
                await this.updateBridgedERC20(
                  'msg',
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
              // BRIDGE IN ERC721 NFT
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
                await this.updateBridgedERC721(
                  'msg',
                  transaction,
                  network,
                  toNetwork,
                  contractType,
                  holographableContractAddress,
                  erc721TransferEvent,
                  erc721BeamInfo,
                  operatorJobHash,
                  tags,
                )
              }
            }
          }

          this.networkMonitor.structuredLog(network, `Found a valid bridgeOutRequest for ${transaction.hash}`, tags)
        } else {
          this.networkMonitor.structuredLog(
            network,
            `Unknown bridgeOut function executed for ${transaction.hash}`,
            tags,
          )
        }

        this.networkMonitor.structuredLog(
          network,
          `Bridge-In transaction type: ${bridgeTransaction.name} -->> ${bridgeTransaction.args}`,
        )
      }
    }
  }

  async updateContractCallback(
    responseData: any,
    transaction: TransactionResponse,
    network: string,
    contractAddress: string,
    deploymentConfig: DeploymentConfig,
    tags: (string | number)[],
  ): Promise<void> {
    const data = JSON.stringify({
      contractAddress,
      // TODO: decide if this should be included in API call
      // contractCreator: deploymentConfig.signer,
      chainId: transaction.chainId,
      status: 'DEPLOYED',
      salt: deploymentConfig.config.salt,
      tx: transaction.hash,
      blockNumber: transaction.blockNumber,
      // TODO: decide if this should be included in API call
      // blockTimestamp: transaction.timestamp,
    })
    this.networkMonitor.structuredLog(network, `Successfully found Collection with address ${contractAddress}`, tags)
    this.networkMonitor.structuredLog(
      network,
      `API: Requesting to update Collection ${contractAddress} with id ${responseData.id}`,
      tags,
    )
    await this.sendPatchRequest(
      {
        responseData,
        network,
        query: `${this.BASE_URL}/v1/collections/${responseData.id}`,
        data,
        messages: [
          `PATCH response for collection ${contractAddress}`,
          `Successfully updated collection ${contractAddress} chainId to ${transaction.chainId}`,
          `Failed to update the Holograph database ${contractAddress}`,
          contractAddress,
        ],
      },
      tags,
    )
  }

  async updateDeployedContract(
    transaction: TransactionResponse,
    network: string,
    contractAddress: string,
    deploymentEvent: string[],
    deploymentConfig: DeploymentConfig,
    tags: (string | number)[],
  ): Promise<void> {
    // here we need to extract origin chain from config
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

    const job: DBJob = {
      attempts: 0,
      network,
      timestamp: await this.getBlockTimestamp(network, transaction.blockNumber!),
      message: `API: Requesting to get Collection with address ${contractAddress}`,
      query: `${this.BASE_URL}/v1/collections/contract/${contractAddress}`,
      callback: this.updateContractCallback,
      arguments: [transaction, network, contractAddress, deploymentConfig, tags],
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
    // not updating DB for any initial call outs since there is no beam status table for this yet
    if (direction === 'in') {
      // here we need to extract origin chain from config
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

      const job: DBJob = {
        attempts: 0,
        network,
        timestamp: await this.getBlockTimestamp(network, transaction.blockNumber!),
        query: `${this.BASE_URL}/v1/collections/contract/${contractAddress}`,
        message: `API: Requesting to get Collection with address ${contractAddress}`,
        callback: this.updateContractCallback,
        arguments: [transaction, network, contractAddress, deploymentConfig, tags],
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

  async updateERC721Callback(
    responseData: any,
    transaction: TransactionResponse,
    network: string,
    contractAddress: string,
    tokenId: string,
    tags: (string | number)[],
  ): Promise<void> {
    const data = JSON.stringify({
      chainId: transaction.chainId,
      status: 'MINTED',
      tx: transaction.hash,
    })
    this.networkMonitor.structuredLog(
      network,
      `Successfully found NFT with tokenId ${tokenId} from ${contractAddress}`,
      tags,
    )
    this.networkMonitor.structuredLog(
      network,
      `API: Requesting to update NFT with collection ${contractAddress} and tokeId ${tokenId} and id ${responseData.id}`,
      tags,
    )

    await this.sendPatchRequest(
      {
        responseData,
        network,
        query: `${this.BASE_URL}/v1/nfts/${responseData.id}`,
        data,
        messages: [
          `PATCH collection ${contractAddress} tokeId ${tokenId}`,
          `Successfully updated NFT collection ${contractAddress} and tokeId ${tokenId}`,
          `Failed to update the database for collection ${contractAddress} and tokeId ${tokenId}`,
          `collection ${contractAddress} and tokeId ${tokenId}`,
        ],
      },
      tags,
    )
    Promise.resolve()
  }

  async updateBridgedERC721(
    direction: string,
    transaction: TransactionResponse,
    network: string,
    fromNetwork: string,
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

    const job: DBJob = {
      attempts: 0,
      network,
      timestamp: await this.getBlockTimestamp(network, transaction.blockNumber!),
      query: `${this.BASE_URL}/v1/nfts/${contractAddress}/${tokenId}`,
      message: `API: Requesting to get NFT with tokenId ${tokenId} from ${contractAddress}`,
      callback: this.updateERC721Callback,
      arguments: [transaction, network, contractAddress, tokenId, tags],
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
      network, // fromNetwork
      network, // toNetwork
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
    this.networkMonitor.structuredLog(network, `Sending minted nft job to DBJobManager ${contractAddress}`, tags)

    const job: DBJob = {
      attempts: 3,
      network,
      timestamp: await this.getBlockTimestamp(network, transaction.blockNumber!),
      query: `${this.BASE_URL}/v1/nfts/${contractAddress}/${tokenId}`,
      message: `API: Requesting to get NFT with tokenId ${tokenId} from ${contractAddress}`,
      callback: this.updateERC721Callback,
      arguments: [transaction, network, contractAddress, tokenId, tags],
      tags,
    }
    if (!(job.timestamp in this.dbJobMap)) {
      this.dbJobMap[job.timestamp] = []
    }

    this.dbJobMap[job.timestamp].push(job)
  }

  async updateCrossChainTransactionCallback(
    responseData: any,
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

    // Get and convert the destination chain id from holograph id in the trasaction args
    // const destinationChainid = networks[getNetworkByHolographId(bridgeTransaction.args[0])].chain
    const destinationChainid = toNetwork

    let data = {}
    const params = {
      headers: {
        Authorization: `Bearer ${this.JWT}`,
        'Content-Type': 'application/json',
      },
      data: data,
    }
    // Set the columns to update based on the type of cross-chain transaction
    switch (crossChainTxType) {
      case 'bridgeOut':
        data = JSON.stringify({
          jobHash,
          jobType: 'ERC721',
          sourceTx: transaction.hash,
          sourceBlockNumber: transaction.blockNumber,
          sourceChainId: transaction.chainId,
          sourceStatus: 'COMPLETED',
          sourceAddress: transaction.from,
          nftId: responseData.id,
          collectionId: responseData.collectionId,
          // Include the destination chain id if the transaction is a bridge out
          messageChainId: destinationChainid,
          operatorChainId: destinationChainid,
        })

        this.networkMonitor.structuredLog(
          network,
          this.apiColor(`API: Requesting to update CrossChainTransaction with ${jobHash}`),
          tags,
        )

        if (this.environment === Environment.localhost || this.environment === Environment.experimental) {
          this.networkMonitor.structuredLog(
            network,
            `Should make an API POST call to "${this.BASE_URL}/v1/cross-chain-transactions" with data ${data}`,
            tags,
          )
        } else {
          try {
            const req = await axios.post(`${this.BASE_URL}/v1/cross-chain-transactions`, data, params)
            this.networkMonitor.structuredLog(
              network,
              this.apiColor(`API: POST CrossChainTransaction ${jobHash} response ${JSON.stringify(req.data)}`),
              tags,
            )
            this.networkMonitor.structuredLog(
              network,
              `Successfully updated CrossChainTransaction ${jobHash} ID ${req.data.id}`,
              tags,
            )
          } catch (error: any) {
            this.networkMonitor.structuredLog(
              network,
              `Failed to update the database for CrossChainTransaction ${jobHash}`,
              tags,
            )
            this.networkMonitor.structuredLogError(network, error.response.data, [
              ...tags,
              this.errorColor(`CrossChainTransaction ${jobHash}`),
            ])
          }
        }

        break
      case 'relayMessage':
        data = JSON.stringify({
          jobHash,
          jobType: 'ERC721',
          messageTx: transaction.hash,
          messageBlockNumber: transaction.blockNumber,
          messageChainId: transaction.chainId,
          messageStatus: 'COMPLETED',
          messageAddress: transaction.from,
          nftId: responseData.id,
          collectionId: responseData.collectionId,
        })

        this.networkMonitor.structuredLog(
          network,
          this.apiColor(`API: Requesting to update CrossChainTransaction with ${jobHash}`),
          tags,
        )
        if (this.environment === Environment.localhost || this.environment === Environment.experimental) {
          this.networkMonitor.structuredLog(
            network,
            `Should make an API POST call to "${this.BASE_URL}/v1/cross-chain-transactions" with data ${data}`,
            tags,
          )
        } else {
          try {
            const req = await axios.post(`${this.BASE_URL}/v1/cross-chain-transactions`, data, params)
            this.networkMonitor.structuredLog(
              network,
              this.apiColor(`API: POST CrossChainTransaction ${jobHash} response ${JSON.stringify(req.data)}`),
              tags,
            )
            this.networkMonitor.structuredLog(
              network,
              `Successfully updated CrossChainTransaction ${jobHash} ID ${req.data.id}`,
              tags,
            )
          } catch (error: any) {
            this.networkMonitor.structuredLog(
              network,
              `Failed to update the database for CrossChainTransaction ${jobHash}`,
              tags,
            )
            this.networkMonitor.structuredLogError(network, error.response.data, [
              ...tags,
              this.errorColor(`CrossChainTransaction ${jobHash}`),
            ])
          }
        }

        break
      case 'bridgeIn':
        data = JSON.stringify({
          jobHash,
          jobType: 'ERC721',
          operatorTx: transaction.hash,
          operatorBlockNumber: transaction.blockNumber,
          operatorChainId: transaction.chainId,
          operatorStatus: 'COMPLETED',
          operatorAddress: transaction.from,
          nftId: responseData.id,
          collectionId: responseData.collectionId,
        })

        this.networkMonitor.structuredLog(
          network,
          this.apiColor(`API: Requesting to update CrossChainTransaction with ${jobHash}`),
          tags,
        )
        if (this.environment === Environment.localhost || this.environment === Environment.experimental) {
          this.networkMonitor.structuredLog(
            network,
            `Should make an API POST call to "${this.BASE_URL}/v1/cross-chain-transactions" with data ${data}`,
            tags,
          )
        } else {
          try {
            const req = await axios.post(`${this.BASE_URL}/v1/cross-chain-transactions`, data, params)
            this.networkMonitor.structuredLog(
              network,
              this.apiColor(`API: POST CrossChainTransaction ${jobHash} response ${JSON.stringify(req.data)}`),
              tags,
            )
            this.networkMonitor.structuredLog(
              network,
              `Successfully updated CrossChainTransaction ${jobHash} ID ${req.data.id}`,
              tags,
            )
          } catch (error: any) {
            this.networkMonitor.structuredLog(
              network,
              `Failed to update the database for CrossChainTransaction ${jobHash}`,
              tags,
            )
            this.networkMonitor.structuredLogError(network, error.response.data, [
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
        return
    }

    return Promise.resolve()
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
    const job: DBJob = {
      attempts: 0,
      network,
      timestamp: await this.getBlockTimestamp(network, transaction.blockNumber!),
      query: `${this.BASE_URL}/v1/nfts/${contractAddress}/${tokenId}`,
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
      tags,
    }
    if (!(job.timestamp in this.dbJobMap)) {
      this.dbJobMap[job.timestamp] = []
    }

    this.dbJobMap[job.timestamp].push(job)
  }

  async sendPatchRequest(options: PatchOptions, tags: (string | number)[]): Promise<void> {
    const responseData = options.responseData
    const network = options.network
    const query = options.query
    const data = options.data
    const messages = options.messages
    const params = {
      maxRedirects: 0,
      headers: {
        Authorization: `Bearer ${this.JWT}`,
        'Content-Type': 'application/json',
      },
      data: data,
    }
    if (this.environment === Environment.localhost || this.environment === Environment.experimental) {
      this.networkMonitor.structuredLog(
        network,
        `Should make an API PATCH call to ${query} with data ${JSON.stringify(data)}`,
        tags,
      )
    } else {
      try {
        const patchRes = await axios.patch(query, data, params)
        this.networkMonitor.structuredLog(
          network,
          `${messages} and id ${responseData.id} response ${JSON.stringify(patchRes.data)}`,
          tags,
        )
        this.networkMonitor.structuredLog(network, messages[1])
      } catch (error: any) {
        this.networkMonitor.structuredLog(network, messages[2])
        this.networkMonitor.structuredLogError(network, error.response.data, this.errorColor(messages[3]))
      }
    }
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
