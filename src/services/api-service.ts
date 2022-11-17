import {gql, GraphQLClient} from 'graphql-request'
import {
  Logger,
  AuthOperatorResponse,
  CrossChainTransactionResponse,
  CrossChainTransaction,
  UpdateCrossChainTransactionStatusInput,
  CreateOrUpdateCrossChainTransactionResponse,
  UpdateCrossChainTransactionStatusInputWithoutData,
  Nft,
  UpdateNftInput,
  NftQueryResponse,
  NftMutationResponse,
} from '../types/api'

class ApiService {
  logger: Logger
  client: GraphQLClient
  baseUrl: string

  constructor(baseURL: string, logger: Logger) {
    this.logger = logger
    this.baseUrl = baseURL
    this.client = new GraphQLClient(`${baseURL}/graphql`)
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
    this.logger.log(`Operator JWT: ${JWT}`)
  }

  async sendQueryRequest(query: string, props: any): Promise<any> {
    return this.client.request(query, props)
  }

  async sendMutationRequest(mutation: string, props: any): Promise<any> {
    return this.client.request(mutation, props)
  }

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
      this.logger.error(error)
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

    this.logger.debug('Updated NFT', data.updateNft)
    return data.updateNft
  }

  async getCrossChainTransaction(jobHash: string): Promise<CrossChainTransaction> {
    const query = gql`
      query GetCrossChainTx ($jobHash: String!)  {
        crossChainTransaction(jobHash: $jobHash) {
            id
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
    this.logger.debug('Found cross chain transaction:', data.crossChainTransaction)
    return data.crossChainTransaction
  }

  async updateCrossChainTransactionStatus(
    updateCrossChainTransactionStatusInput:
      | UpdateCrossChainTransactionStatusInput
      | UpdateCrossChainTransactionStatusInputWithoutData,
  ): Promise<CrossChainTransaction> {
    const mutation = gql`
        mutation CreateOrUpdateCrossChainTransaction($createOrUpdateCrossChainTransactionInput: CreateOrUpdateCrossChainTransactionInput!) {
          createOrUpdateCrossChainTransaction(createOrUpdateCrossChainTransactionInput: $createOrUpdateCrossChainTransactionInput) {
            id
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
    const data: CreateOrUpdateCrossChainTransactionResponse = await this.client.request(mutation, {
      createOrUpdateCrossChainTransactionInput: updateCrossChainTransactionStatusInput,
    })

    this.logger.debug('Updated cross chain transaction:', data.createOrUpdateCrossChainTransaction)
    return data.createOrUpdateCrossChainTransaction
  }
}

export default ApiService
