import {TransactionResponse} from '@ethersproject/abstract-provider'
import {NetworkMonitor} from '../../utils/network-monitor'
import SqsService from '../../services/sqs-service'
import {networkToChainId} from '../../utils/web3'
import {SqsEventName, PayloadType, SqsMessageBody} from '../../types/sqs'
import {TransferERC20Event} from '../../utils/event'

async function handleTransferERC20Event(
  networkMonitor: NetworkMonitor,
  transaction: TransactionResponse,
  network: string,
  event: TransferERC20Event,
  tags: (string | number)[],
): Promise<void> {
  const {from, to, value, contract: contractAddress, logIndex} = event

  const messageBody: SqsMessageBody = {
    type: PayloadType.ERC20,
    eventName: SqsEventName.TransferERC20,
    eventSignature: 'Transfer (address indexed from, address indexed to, uint256 value)',
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
      value: value.toString(),
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

export default handleTransferERC20Event
