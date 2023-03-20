import {SQSClient, SendMessageCommand} from '@aws-sdk/client-sqs'
import {SqsMessageBody} from '../types/sqs'
import {retry} from '../utils/utils'

class SqsService {
  private static _instance?: SqsService
  private client: SQSClient
  private sqsQueueURL: string
  private maxRetries = 3

  private constructor() {
    this.validateConfig()

    this.client = new SQSClient({
      endpoint: process.env.SQS_ENDPOINT,
      region: process.env.AWS_REGION,
      credentials: {accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!},
    })

    this.sqsQueueURL = process.env.SQS_QUEUE_URL!
  }

  static get Instance(): SqsService {
    if (!SqsService._instance) {
      SqsService._instance = new SqsService()
    }

    return SqsService._instance
  }

  async healthCheck() {
    try {
      const data = await this.client.send(
        new SendMessageCommand({
          MessageBody: '{"eventName": "sample", "eventSignature": "sampleHandler", "msg":"hello sample body"}',
          QueueUrl: this.sqsQueueURL,
        }),
      )
      return data
    } catch (error: any) {
      console.error('[Error]: Indexer unable to reach queue system \n', error)
      // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
      process.exit()
    }
  }

  async sendMessage(sqsMessage: SqsMessageBody) {
    const sendMessage = () =>
      this.client.send(
        new SendMessageCommand({
          MessageBody: JSON.stringify(sqsMessage),
          QueueUrl: this.sqsQueueURL,
        }),
      )

    retry(sendMessage, this.maxRetries)
  }

  validateConfig() {
    if (!process.env.SQS_ENDPOINT) {
      throw new Error('SQS_ENDPOINT env is required')
    }

    if (!process.env.AWS_REGION) {
      throw new Error('AWS_REGION env is required')
    }

    if (!process.env.AWS_ACCESS_KEY_ID) {
      throw new Error('AWS_ACCESS_KEY_ID env is required')
    }

    if (!process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error('AWS_SECRET_ACCESS_KEY env is required')
    }

    if (!process.env.SQS_QUEUE_URL) {
      throw new Error('SQS_QUEUE_URL env is required')
    }
  }
}

export default SqsService
