import {request, gql, GraphQLClient} from 'graphql-request'
import {
  Logger,
  AuthOperatorResponse,
  CrossChainTransactionResponse,
  CrossChainTransaction,
  UpdateCrossChainTransactionStatusInput,
  CreateOrUpdateCrossChainTransactionResponse,
} from '../types/api'

class ApiService {
  logger: Logger
  client: GraphQLClient

  constructor(baseURL: string, logger: Logger) {
    this.logger = logger
    this.client = new GraphQLClient(`${baseURL}/graphql`)
  }

  async operatorLogin() {
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
    const data = await this.client.request<AuthOperatorResponse>(mutation, {
      authOperatorInput: {
        hash: process.env.OPERATOR_API_KEY,
      },
    })

    const JWT = data.authOperator.accessToken

    if (typeof JWT === 'undefined') {
      throw new TypeError('Failed to authorize as an operator')
    }

    this.client.setHeader('authorization', `Bearer ${JWT}`)

    this.logger.log(`JWT = ${JWT}`)
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
        }
      }
  `
    const data = await this.client.request<CrossChainTransactionResponse>(query, {jobHash})

    this.logger.debug('found: ', data.crossChainTransaction)

    return data.crossChainTransaction
  }

  async updateCrossChainTransactionStatus(
    updateCrossChainTransactionStatusInput: UpdateCrossChainTransactionStatusInput,
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
          }
        }
    `
    const data = await this.client.request<CreateOrUpdateCrossChainTransactionResponse>(mutation, {
      createOrUpdateCrossChainTransactionInput: updateCrossChainTransactionStatusInput,
    })

    this.logger.debug('updated to:', data.createOrUpdateCrossChainTransaction)

    return data.createOrUpdateCrossChainTransaction
  }
}

export default ApiService
