import {TransactionResponse} from '@ethersproject/abstract-provider'

import SqsService from '../../services/sqs-service'
import {networkToChainId} from '../../utils/utils'
import {NetworkMonitor} from '../../utils/network-monitor'
import {EventName, PayloadType, SqsMessageBody} from '../../types/sqs'

async function handleBridgeEvents(
  networkMonitor: NetworkMonitor,
  transaction: TransactionResponse,
  network: string,
  tags: (string | number)[],
): Promise<void> {
  const messageBody: SqsMessageBody = {
    type: PayloadType.HolographProtocol,
    eventName: EventName.BridgePreProcess,
    tagId: tags,
    chainId: networkToChainId[network],
    holographAddress: networkMonitor.HOLOGRAPH_ADDRESSES[networkMonitor.environment],
    environment: networkMonitor.environment,
    payload: {
      tx: transaction.hash,
      blockNum: Number(transaction.blockNumber),
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

export default handleBridgeEvents
