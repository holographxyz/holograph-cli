import {TransactionResponse} from '@ethersproject/abstract-provider'
import {TransferBatchERC1155Event} from '../../utils/event'
import {NetworkMonitor} from '../../utils/network-monitor'

/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars */
async function handleTransferBatchERC1155Event(
  networkMonitor: NetworkMonitor,
  transaction: TransactionResponse,
  network: string,
  event: TransferBatchERC1155Event,
  tags: (string | number)[],
): Promise<void> {}

export default handleTransferBatchERC1155Event
