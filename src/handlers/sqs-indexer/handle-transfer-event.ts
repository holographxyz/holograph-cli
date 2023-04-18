import {TransactionResponse} from '@ethersproject/abstract-provider'

import {NetworkMonitor} from '../../utils/network-monitor'
import {EventName, PayloadType, SqsMessageBody} from '../../types/sqs'
import {networkToChainId} from '../../utils/utils'
import SqsService from '../../services/sqs-service'
import {TransferERC721Event} from '../../utils/event'

async function handleTransferEvent(
  networkMonitor: NetworkMonitor,
  transaction: TransactionResponse,
  network: string,
  event: TransferERC721Event,
  tags: (string | number)[],
): Promise<void> {
  const {from, to, tokenId, contract: contractAddress, logIndex} = event
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

  const hexEncodedTokenId = hexZeroPad(BigNumber.from(tokenId).toHexString(), 32)

  const messageBody: SqsMessageBody = {
    type: PayloadType.HolographProtocol,
    eventName: EventName.TransferERC721,
    tagId: tags,
    chainId: networkToChainId[network],
    holographAddress: networkMonitor.HOLOGRAPH_ADDRESSES[networkMonitor.environment],
    environment: networkMonitor.environment,
    payload: {
      tx: transaction.hash,
      logIndex,
      blockNum: Number(transaction.blockNumber),
      from,
      to,
      contractAddress,
      tokenId: tokenId.toHexString(),
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
