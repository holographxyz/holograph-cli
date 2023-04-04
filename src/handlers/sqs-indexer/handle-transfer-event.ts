import {TransactionResponse} from '@ethersproject/abstract-provider'

import {NetworkMonitor} from '../../utils/network-monitor'
import {EventName, PayloadType, SqsMessageBody} from '../../types/sqs'
import {networkToChainId} from '../../utils/utils'
import SqsService from '../../services/sqs-service'

async function handleTransferEvent(
  networkMonitor: NetworkMonitor,
  transaction: TransactionResponse,
  network: string,
  event: string[],
  tags: (string | number)[],
): Promise<void> {
  const [from, to, tokenId, contractAddress] = event
  networkMonitor.structuredLog(
    network,
    `Successfully decoded ERC721 Transfer Event: from ${from}, to ${to}, tokenId ${tokenId} at contract ${contractAddress}`,
    tags,
  )
  const isHolographable: boolean = await networkMonitor.registryContract.isHolographedContract(contractAddress)

  if (isHolographable === false) {
    networkMonitor.structuredLog(network, `Contract ${contractAddress} is not holographable`, tags)
    networkMonitor.structuredLog(
      network,
      `Contract ${contractAddress} is not on registry at the address ${networkMonitor.registryAddress} in env ${networkMonitor.environment}. Skipping...`,
      tags,
    )
    return
  }

  networkMonitor.structuredLog(
    network,
    `Contract ${contractAddress} is in registry at ${networkMonitor.environment}`,
    tags,
  )

  const messageBody: SqsMessageBody = {
    type: PayloadType.HolographProtocol,
    eventName: EventName.TransferERC721,
    tagId: tags,
    chainId: networkToChainId[network],
    holographAddress: networkMonitor.HOLOGRAPH_ADDRESSES[networkMonitor.environment],
    environment: networkMonitor.environment,
    payload: {
      tx: transaction.hash,
      blockNum: Number(transaction.blockNumber),
      from,
      to,
      contractAddress,
      tokenId,
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

export default handleTransferEvent
