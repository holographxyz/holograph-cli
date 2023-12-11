import color from '@oclif/color'
import {gql, GraphQLClient} from 'graphql-request' // eslint-disable-line node/no-missing-import
import {GraphQLClientResponse} from 'graphql-request/build/esm/types'
import {
  Logger,
  AuthOperatorResponse,
  CrossChainTransactionResponse,
  CrossChainTransaction,
  UpdateCrossChainTransactionStatusInput,
  UpdateCrossChainTransactionStatusInputWithoutData,
  Nft,
  UpdateNftInput,
  NftQueryResponse,
  NftMutationResponse,
  BlockHeightProcessType,
  BlockHeightResponse,
  DeployedCollectionsResponse,
  BlockHeight,
  HolographVersion,
} from '../types/api'
import {AbstractError} from '../types/errors'
import {StructuredLogInfo} from '../types/interfaces'
import {cleanRequest} from '../utils/utils'

const HOLOGRAPH_VERSION_ENV = process.env.HOLOGRAPH_VERSION
  ? (process.env.HOLOGRAPH_VERSION.toUpperCase() as HolographVersion)
  : HolographVersion.V1
if (!(HOLOGRAPH_VERSION_ENV in HolographVersion)) {
  throw new Error('Provided Holograph Version does not exist!')
}
class ApiService {
  static readonly holographVersion: HolographVersion = HOLOGRAPH_VERSION_ENV
  logger: Logger
  client: GraphQLClient
  baseUrl: string
  errorColor = color.keyword('red')

  constructor(baseURL: string, logger: Logger) {
    this.logger = logger
    this.baseUrl = baseURL
    this.client = new GraphQLClient(`${baseURL}/graphql`, {errorPolicy: 'none'})
  }

  setStructuredLog(
    structuredLog: (network: string, msg: string, tagId?: string | number | (number | string)[]) => void,
  ): void {
    this.logger.structuredLog = structuredLog
  }

  setStructuredLogError(
    structuredLogError: (
      network: string,
      error: string | Error | AbstractError,
      tagId?: string | number | (number | string)[],
    ) => void,
  ): void {
    this.logger.structuredLogError = structuredLogError
  }

  logInfo(description: string, structuredLogInfo?: StructuredLogInfo): void {
    if (this.logger.structuredLog !== undefined && structuredLogInfo !== undefined) {
      this.logger.structuredLog(structuredLogInfo.network, description, structuredLogInfo.tagId)
    } else {
      this.logger.log(description)
    }
  }

  /*  eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types */
  logError(description: string, error: any, structuredLogInfo?: StructuredLogInfo): void {
    if (this.logger.structuredLogError !== undefined && structuredLogInfo !== undefined) {
      this.logger.structuredLogError(structuredLogInfo.network, error, [
        ...(structuredLogInfo.tagId as (string | number)[]),
        this.errorColor(description),
      ])
    } else {
      this.logger.error(`${description}: ${error}`)
    }
  }

  async operatorLogin(): Promise<void> {
    if (!process.env.OPERATOR_API_KEY) {
      throw new Error('OPERATOR_API_KEY env is required')
    }

    const mutation = gql`
      mutation AuthOperator($authOperatorInput: AuthOperatorInput!) {
        authOperator(authOperatorInput: $authOperatorInput) {
          accessToken
        }
      }
    `
    const data: AuthOperatorResponse = await this.client.request(mutation, {
      authOperatorInput: {
        hash: process.env.OPERATOR_API_KEY,
      },
    })

    const JWT = data.authOperator.accessToken
    if (typeof JWT === 'undefined') {
      throw new TypeError('Failed to authorize as an operator')
    }

    this.client.setHeader('authorization', `Bearer ${JWT}`)
    // this.logger.log(`Operator JWT: ${JWT}`)
  }

  async sendQueryRequest<T = any>(
    query: string,
    props: any, // eslint-disable-line @typescript-eslint/explicit-module-boundary-types
    structuredLogInfo?: StructuredLogInfo,
  ): Promise<GraphQLClientResponse<T> | undefined> {
    this.logInfo(`Sending query request ${cleanRequest(query)} with props ${JSON.stringify(props)}`, structuredLogInfo)
    try {
      return await this.client.rawRequest(query, props)
    } catch (error: any) {
      this.logError('Error sending query request', error, structuredLogInfo)
    }
  }

  async sendMutationRequest<T = any>(
    mutation: string,
    props: any, // eslint-disable-line @typescript-eslint/explicit-module-boundary-types
    structuredLogInfo?: StructuredLogInfo,
  ): Promise<GraphQLClientResponse<T> | undefined> {
    this.logInfo(
      `Sending mutation request ${cleanRequest(mutation)} with props ${JSON.stringify(props)}`,
      structuredLogInfo,
    )
    try {
      return await this.client.rawRequest(mutation, props)
    } catch (error: any) {
      this.logError('Error sending mutation request', error, structuredLogInfo)
    }
  }

  async getAllDeployedCollections(): Promise<string[]> {
    const query = gql`
        query Query {
          deployedCollections
        }
    `
    try {
      const data: DeployedCollectionsResponse = await this.client.request(query)
      return data.deployedCollections
    } catch (error: any) {
      this.logger.error(`Error sending query request ${error}`)
    }
  }

  // Note: This is not currently used since queries are passed into the sendQueryRequest function via dbJobMap
  // THis can be updated when we move the jobs to a queue service
  async queryNftByTx(tx: string): Promise<Nft> {
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
    try {
      const data: NftQueryResponse = await this.client.request(query, {tx})
      return data.nftByTx
    } catch (error: any) {
      this.logger.error(`Error sending query request ${error}`)
    }
  }

  // Note: This is not currently used since queries are passed into the sendQueryRequest function via dbJobMap
  // THis can be updated when we move the jobs to a queue service
  async queryNftByIpfsCid(cid: string): Promise<Nft> {
    const query = gql`
      query($cid: String!) {
        nftByIpfsCid(ifpsCid: $cid) {
          id
          tx
          status
          chainId
        }
      }
    `
    try {
      const data: NftQueryResponse = await this.client.request(query, {cid})
      return data.nftByIpfsCid
    } catch (error: any) {
      this.logger.error(`Error sending query request ${error}`)
    }
  }

  async updateNft(updateNftInput: UpdateNftInput): Promise<Nft> {
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
    const data: NftMutationResponse = await this.client.request(mutation, {
      updateNftInput: updateNftInput,
    })

    return data.updateNft
  }

  async getCrossChainTransaction(jobHash: string): Promise<CrossChainTransaction> {
    const query = gql`
      query GetCrossChainTx ($jobHash: String!)  {
        crossChainTransaction(jobHash: $jobHash) {
            id
            nftId
            collectionId
            jobType
            jobHash
            sourceBlockNumber
            sourceTx
            sourceStatus
            messageBlockNumber
            messageTx
            messageStatus
            operatorBlockNumber
            operatorTx
            operatorStatus
            operatorAddress
            messageAddress
            sourceAddress
            data
        }
      }
  `
    const data: CrossChainTransactionResponse = await this.client.request(query, {jobHash})
    return data.crossChainTransaction
  }

  async updateCrossChainTransactionStatus<T = any>(
    updateCrossChainTransactionStatusInput:
      | UpdateCrossChainTransactionStatusInput
      | UpdateCrossChainTransactionStatusInputWithoutData,
  ): Promise<GraphQLClientResponse<T> | undefined> {
    const mutation = gql`
        mutation CreateOrUpdateCrossChainTransaction($createOrUpdateCrossChainTransactionInput: CreateOrUpdateCrossChainTransactionInput!) {
          createOrUpdateCrossChainTransaction(createOrUpdateCrossChainTransactionInput: $createOrUpdateCrossChainTransactionInput) {
            id
            nftId
            collectionId
            jobType
            jobHash
            sourceBlockNumber
            sourceTx
            sourceStatus
            messageBlockNumber
            messageTx
            messageStatus
            operatorBlockNumber
            operatorTx
            operatorStatus
            operatorAddress
            messageAddress
            sourceAddress
            data
          }
        }
    `
    return this.client.rawRequest(mutation, {
      createOrUpdateCrossChainTransactionInput: updateCrossChainTransactionStatusInput,
    })
  }

  async getBlockHeights(process: BlockHeightProcessType, chainId?: number): Promise<BlockHeight[]> {
    const query = gql`
      query GetAllBlockHeights($getBlockHeight: GetAllBlockHeightInput) {
        getAllBlockHeights(getBlockHeight: $getBlockHeight) {
          chainId
          process
          blockHeight
          isActive
        }
      }
    `
    const input = {getBlockHeight: {chainId, process, holographVersion: ApiService.holographVersion}}
    const data: BlockHeightResponse = await this.client.request(query, input)
    return data.getAllBlockHeights
  }

  async updateBlockHeight<T>(
    process: BlockHeightProcessType,
    chainId: number,
    blockHeight: number,
  ): Promise<GraphQLClientResponse<T> | undefined> {
    const mutation = gql`
      mutation SetBlockHeight($createBlockHeightInput: CreateBlockHeightInput!) {
        setBlockHeight(createBlockHeightInput: $createBlockHeightInput) {
          chainId
          process
          blockHeight
          isActive
        }
      }
    `

    const updateBlockHeightInput = {
      createBlockHeightInput: {
        process,
        chainId,
        blockHeight,
        holographVersion: ApiService.holographVersion,
      },
    }

    return this.client.rawRequest(mutation, updateBlockHeightInput)
  }
}

export default ApiService
