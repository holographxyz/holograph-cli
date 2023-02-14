import {TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'

import {NetworkMonitor} from '../../utils/network-monitor'

import SqsService from '../../services/sqs-service'
import {networkToChainId} from '../../utils/utils'
import {JobIdentifier, PayloadType, SqsMessageBody} from '../../types/sqs'
import {hexZeroPad} from '@ethersproject/bytes'

async function handleMintEvent(
  networkMonitor: NetworkMonitor,
  transaction: TransactionResponse,
  network: string,
  tags: (string | number)[],
): Promise<void> {
  const receipt: TransactionReceipt | null = await networkMonitor.getTransactionReceipt({
    network,
    transactionHash: transaction.hash,
    attempts: 10,
    canFail: true,
  })

  if (receipt === null) {
    throw new Error(`Could not get receipt for ${transaction.hash}`)
  }

  if (receipt.status === 1) {
    networkMonitor.structuredLog(network, `Checking for mint details`, tags)

    const holographableContractAddress: string = transaction.to!
    const erc721TransferEvent: any[] | undefined = networkMonitor.decodeErc721TransferEvent(
      receipt,
      holographableContractAddress,
    )
    if (erc721TransferEvent === undefined) {
      networkMonitor.structuredLog(network, `No Transfer event found`, tags)
    } else {
      networkMonitor.structuredLog(network, `updateMintedERC721`, tags)

      const to = erc721TransferEvent[1]
      const tokenId = hexZeroPad(erc721TransferEvent[2].toHexString(), 32)

      const messageBody: SqsMessageBody = {
        type: PayloadType.ERC721,
        jobIdentifier: JobIdentifier.ERC721Mint,
        eventName: 'Transfer(address indexed _from, address indexed _to, uint256 indexed _tokenId)',
        tagId: tags,
        chainId: networkToChainId[network],
        holographAddress: networkMonitor.HOLOGRAPH_ADDRESSES[networkMonitor.environment],
        environment: networkMonitor.environment,
        payload: {
          tx: transaction.hash,
          blockNum: Number(transaction.blockNumber),
          collectionAddress: holographableContractAddress,
          nftTokenId: tokenId,
          to: to,
        },
      }

      networkMonitor.structuredLog(
        network,
        `sending message with MessageBody: ${JSON.stringify(messageBody)} to queue...`,
        tags,
      )

      const response = await SqsService.Instance.sendMessage(messageBody)

      networkMonitor.structuredLog(network, `Response: ${JSON.stringify(response)}`, tags)
    }
  } else {
    networkMonitor.structuredLog(network, `Transaction failed, ignoring it`, tags)
  }
}

export default handleMintEvent
