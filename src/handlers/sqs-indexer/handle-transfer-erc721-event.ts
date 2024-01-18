import {TransactionResponse} from '@ethersproject/abstract-provider'
import {NetworkMonitor} from '../../utils/network-monitor'
import SqsService from '../../services/sqs-service'
import {networkToChainId, remove0x} from '../../utils/web3'
import {SqsEventName, PayloadType, SqsMessageBody} from '../../types/sqs'
import {TransferERC721Event} from '../../utils/event'

async function handleTransferERC721Event(
  networkMonitor: NetworkMonitor,
  transaction: TransactionResponse,
  network: string,
  event: TransferERC721Event,
  isNewMint: boolean,
  tags: (string | number)[],
): Promise<void> {
  const {from, to, tokenId, contract: contractAddress, logIndex} = event

  const messageBody: SqsMessageBody = {
    type: PayloadType.ERC721,
    eventName: isNewMint ? SqsEventName.MintNft : SqsEventName.TransferERC721,
    eventSignature: 'Transfer(address indexed _from, address indexed _to, uint256 indexed _tokenId)',
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
      tokenId: '0x' + remove0x(tokenId.toHexString()).padStart(64, '0'),
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

export default handleTransferERC721Event
