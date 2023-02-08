import {SQSClient, SendMessageCommand} from '@aws-sdk/client-sqs'
import {SqsMessageBody} from '../types/sqs'

class SqsService {
  private static _instance?: SqsService
  private client: SQSClient
  private sqsQueueURL: string

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

  async sendMessage(sqsMessage: SqsMessageBody) {
    try {
      const data = await this.client.send(
        new SendMessageCommand({
          MessageBody: JSON.stringify(sqsMessage),
          QueueUrl: this.sqsQueueURL,
        }),
      )
      console.log('Success, message sent. MessageID:', data.MessageId)
      return data
    } catch (error: any) {
      console.log(error)
    }
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
