import {TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'

import {NetworkMonitor} from '../../utils/network-monitor'
import {UpdateMintedERC721} from '../../types/indexer'
import {decodeErc721TransferEvent} from '../../events/events'

async function handleMintEvent(
  networkMonitor: NetworkMonitor,
  transaction: TransactionResponse,
  network: string,
  tags: (string | number)[],
  updateMintedERC721: UpdateMintedERC721,
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
    const erc721TransferEvent: string[] | undefined = decodeErc721TransferEvent(receipt, holographableContractAddress)
    if (erc721TransferEvent === undefined) {
      networkMonitor.structuredLog(network, `No Transfer event found`, tags)
    } else {
      networkMonitor.structuredLog(network, `updateMintedERC721`, tags)
      // @ts-expect-error 'this' is of type any
      await updateMintedERC721.call(this, transaction, network, holographableContractAddress, erc721TransferEvent, tags)
    }
  } else {
    networkMonitor.structuredLog(network, `Transaction failed, ignoring it`, tags)
  }
}

export default handleMintEvent
