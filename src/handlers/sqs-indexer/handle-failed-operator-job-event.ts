import {TransactionResponse} from '@ethersproject/abstract-provider'
import {FailedOperatorJobEvent} from '../../utils/event'
import {NetworkMonitor} from '../../utils/network-monitor'
import {SqsEventName, PayloadType, SqsMessageBody} from '../../types/sqs'
import {networkToChainId} from '../../utils/web3'
import SqsService from '../../services/sqs-service'

/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars */
async function handleFailedOperatorJobEvent(
  networkMonitor: NetworkMonitor,
  transaction: TransactionResponse,
  network: string,
  event: FailedOperatorJobEvent,
  tags: (string | number)[],
): Promise<void> {
  networkMonitor.structuredLog(network, `handleFailedOperatorJobEvent`, tags)

  const messageBody: SqsMessageBody = {
    type: PayloadType.HolographProtocol,
    eventName: SqsEventName.FailedOperatorJob,
    tagId: tags,
    chainId: networkToChainId[network],
    holographAddress: networkMonitor.HOLOGRAPH_ADDRESSES[networkMonitor.environment],
    environment: networkMonitor.environment,
    payload: {
      tx: transaction.hash,
      blockNum: Number(transaction.blockNumber),
      jobHash: event.jobHash,
    },
  }

  networkMonitor.structuredLog(
    network,
    `Sending message with MessageBody: ${JSON.stringify(messageBody)} to queue...`,
    tags,
  )

  const response = await SqsService.Instance.sendMessage(messageBody)

  networkMonitor.structuredLog(network, `Response: ${JSON.stringify(response)}`, tags)
}

export default handleFailedOperatorJobEvent
