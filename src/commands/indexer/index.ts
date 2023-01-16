import {Block, TransactionResponse} from '@ethersproject/abstract-provider'
import {hexZeroPad} from '@ethersproject/bytes'
import {Environment} from '@holographxyz/environment'
import {networks} from '@holographxyz/networks'
import {CliUx, Flags} from '@oclif/core'
import color from '@oclif/color'
import {gql} from 'graphql-request'
import dotenv from 'dotenv'

import {Logger, NftStatus, UpdateCrossChainTransactionStatusInput, UpdateNftInput} from '../../types/api'
import {BlockJob, FilterType, NetworkMonitor, networksFlag, repairFlag} from '../../utils/network-monitor'
import {capitalize, functionSignature, numberfy, numericSort, sleep} from '../../utils/utils'
import {BridgeInErc20Args, BridgeOutErc20Args} from '../../utils/bridge'
import {DeploymentConfig} from '../../utils/contract-deployment'
import {HealthCheck} from '../../base-commands/healthcheck'
import {ensureConfigFileIsValid} from '../../utils/config'
import ApiService from '../../services/api-service'
import {Logger, NftStatus, UpdateCrossChainTransactionStatusInput, UpdateNftInput} from '../../types/api'
import {gql} from 'graphql-request'
import {getIpfsCidFromTokenUri, validateIpfsCid} from '../../utils/validation'

import {DBJob, DBJobMap} from '../../types/indexer'
import {
  handleMintEvent,
  handleBridgeInEvent,
  handleBridgeOutEvent,
  handleContractDeployedEvent,
  handleAvailableOperatorJobEvent,
} from './handlers'

dotenv.config()

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
    const continuous = !flags.repair // If repair is set, run network monitor stops after catching up to the latest block
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

    const timestamps: number[] = numberfy(Object.keys(this.dbJobMap))
    if (timestamps.length > 0) {
      timestamps.sort(numericSort)
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
            await handleContractDeployedEvent(
              this.networkMonitor,
              transaction,
              job.network,
              tags,
              this.updateDeployedContract,
            )

            break
          }

          case this.networkMonitor.bridgeAddress: {
            this.networkMonitor.structuredLog(
              job.network,
              `handleBridgeOutEvent ${networks[job.network].explorer}/tx/${transaction.hash}`,
              tags,
            )
            await handleBridgeOutEvent(
              this.networkMonitor,
              this.environment,
              transaction,
              job.network,
              tags,
              this.updateBridgedContract,
              this.updateBridgedERC20,
              this.updateBridgedERC721,
            )

            break
          }

          case this.networkMonitor.operatorAddress: {
            this.networkMonitor.structuredLog(
              job.network,
              `handleBridgeInEvent ${networks[job.network].explorer}/tx/${transaction.hash}`,
              tags,
            )
            await handleBridgeInEvent(
              this.networkMonitor,
              transaction,
              job.network,
              tags,
              this.updateBridgedContract,
              this.updateBridgedERC20,
              this.updateBridgedERC721,
            )

            break
          }

          default:
            if (from === this.networkMonitor.LAYERZERO_RECEIVERS[job.network]) {
              this.networkMonitor.structuredLog(
                job.network,
                `handleAvailableOperatorJobEvent ${networks[job.network].explorer}/tx/${transaction.hash}`,
                tags,
              )
              await handleAvailableOperatorJobEvent(
                this.networkMonitor,
                transaction,
                job.network,
                tags,
                this.updateBridgedContract,
                this.updateBridgedERC20,
                this.updateBridgedERC721,
              )
            } else if (functionSig === functionSignature('cxipMint(uint224,uint8,string)')) {
              this.networkMonitor.structuredLog(
                job.network,
                `handleMintEvent ${networks[job.network].explorer}/tx/${transaction.hash}`,
                tags,
              )
              await handleMintEvent(this.networkMonitor, transaction, job.network, tags, this.updateMintedERC721)
            } else {
              this.networkMonitor.structuredLog(job.network, `irrelevant transaction ${transaction.hash}`, tags)
            }
        }
      }
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
    contractAddress: string,
    deploymentConfig: DeploymentConfig,
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
    transaction: TransactionResponse,
    network: string,
    erc20BeamInfo: BridgeInErc20Args | BridgeOutErc20Args,
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

    this.networkMonitor.cxipERC721Contract.attach(contractAddress)
    const tokenURI: string = await this.networkMonitor.cxipERC721Contract.tokenURI(tokenId)
    this.networkMonitor.structuredLog(network, `Token URI is ${tokenURI}`, tags)
    const ipfsCid = getIpfsCidFromTokenUri(tokenURI)
    this.networkMonitor.structuredLog(network, `IPFS CID is ${ipfsCid}`, tags)
    await validateIpfsCid(ipfsCid)

    // This query is filtered at the API level to only return NFTs with where tx is null
    const query = gql`
      query($ipfsCid: String!) {
        nftByIpfsCid(ipfsCid: $ipfsCid) {
          id
          tx
          status
          chainId
        }
      }
    `

    this.networkMonitor.structuredLog(
      network,
      `Sending minted nft with ipfs cid ${ipfsCid} and tx ${transaction.hash} job to DBJobManager`,
      tags,
    )
    const job: DBJob = {
      attempts: 3,
      network,
      timestamp: await this.getBlockTimestamp(network, transaction.blockNumber!),
      query,
      message: `API: Requesting to update NFT with ipfs cid ${ipfsCid} and transaction hash ${transaction.hash}`,
      callback: this.updateERC721Callback,
      arguments: [transaction, network, tags],
      identifier: {ipfsCid: ipfsCid},
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
      `API: Requesting to update NFT with ${data.nftByIpfsCid.tx} and id ${data.nftByIpfsCid.id}`,
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
    const input: UpdateNftInput = {updateNftInput: data.nftByIpfsCid}
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
      this.networkMonitor.structuredLog(network, `API: Failed to update NFT with tx ${data.nftByIpfsCid.tx}`, tags)
      this.networkMonitor.structuredLogError(network, error, [
        ...tags,
        this.errorColor(`Cross chain transaction ${data.nftByIpfsCid.tx}`),
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
