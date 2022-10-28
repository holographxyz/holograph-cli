import {request, gql, GraphQLClient} from 'graphql-request'
import {
  AuthOperatorResponse,
  CrossChainTransactionResponse,
  CrossChainTransaction,
  updateCrossChainTransactionStatusInput,
} from '../types/api'

class ApiService {
  client: GraphQLClient

  constructor(baseURL: string) {
    this.client = new GraphQLClient(`${baseURL}/graphql`)
  }

  async operatorLogin() {
    if (!process.env.OPERATOR_API_KEY) throw new Error('OPERATOR_API_KEY env is required')

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

    // console.log(`process.env.OPERATOR_API_KEY = ${process.env.OPERATOR_API_KEY}`)
    console.log(`this.JWT = ${JWT}`)
  }

  async getCrossChainTransaction(jobHash: string): Promise<CrossChainTransaction> {
    const query = gql`
      query GetCrossChainTx ($jobHash: String!)  {
        crossChainTransaction(jobHash: $jobHash) {
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
    const data = await this.client.request<CrossChainTransactionResponse>(query, {jobHash})
    console.log(data.crossChainTransaction)
    return data.crossChainTransaction
  }

  async updateCrossChainTransactionStatus(
    updateCrossChainTransactionStatusInput: updateCrossChainTransactionStatusInput,
  ): Promise<CrossChainTransaction> {
    const mutation = gql`
        mutation CreateOrUpdateCrossChainTransaction($createOrUpdateCrossChainTransactionInput: CreateOrUpdateCrossChainTransactionInput!) {
          createOrUpdateCrossChainTransaction(createOrUpdateCrossChainTransactionInput: $createOrUpdateCrossChainTransactionInput) {
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
    const data = await this.client.request(mutation, {
      createOrUpdateCrossChainTransactionInput: updateCrossChainTransactionStatusInput,
    })

    console.log(data.createOrUpdateCrossChainTransaction)

    return data.createOrUpdateCrossChainTransaction
  }
}

export default ApiService
