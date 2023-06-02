import {TransactionResponse} from '@ethersproject/abstract-provider'
import {FailedOperatorJobEvent} from '../../utils/event'
import {NetworkMonitor} from '../../utils/network-monitor'

/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars */
async function handleFailedOperatorJobEvent(
  networkMonitor: NetworkMonitor,
  transaction: TransactionResponse,
  network: string,
  event: FailedOperatorJobEvent,
  tags: (string | number)[],
): Promise<void> {}

export default handleFailedOperatorJobEvent
