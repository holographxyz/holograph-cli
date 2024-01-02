import {InterestingTransaction, SqsEvent} from '../types/network-monitor'
import {SqsEventName} from '../types/sqs'
import {Event, EventType, TransferERC721Event, eventMap} from './event'
import {zeroAddress} from './web3'

interface ProtocolEventInfo {
  // TODO: improve it
  name: ProtocolEvent
  contractMethodName: string | undefined
  events: Event[]
  sqsEventNames: SqsEventName[]
  validateAndGetSqsEvents: (interestingTransaction: InterestingTransaction) => SqsEvent[]
}

export enum ProtocolEvent {
  LegacyDeployment = 'LegacyDeployment',
  MoeDeployment = 'MoeDeployment',
  BatchDeployment = 'BatchDeployment',
  LegacyMintNft = 'LegacyMintNft',
  MoeMintNft = 'MoeMintNft',
  TransferOwnership = 'TransferOwnership',
  BridgeOutErc721 = 'BridgeOutErc721',
  // BridgeOutContract = 'BridgeOutContract',
  AvailableOperatorJob = 'AvailableOperatorJob',
  BridgeInErc721 = 'BridgeInErc721',
  // BridgeInContract = 'BridgeInContract',
  FailedOperatorJob = 'FailedOperatorJob',
}

enum ContractMethodId {
  deployHolographableContract = '0xdf6516bd',
  deployHolographableContractMultiChain = '0xa8935c67',
  purchase = '0xefef39a1',
  cxipMint = '0xe003ba45',
  executeJob = '0x778fd1d1',
  bridgeOutRequest = '0xe5585666',
  validateTransactionProofV1 = '0x252f7b01',
}

export const protocolEventsMap: {readonly [key in ProtocolEvent]: ProtocolEventInfo} = {
  [ProtocolEvent.MoeDeployment]: {
    name: ProtocolEvent.MoeDeployment,
    contractMethodName: ContractMethodId.deployHolographableContract,
    events: [
      eventMap[EventType.EditionInitialized],
      eventMap[EventType.SecondarySaleFees],
      eventMap[EventType.BridgeableContractDeployed],
    ],
    sqsEventNames: [SqsEventName.ContractDeployed],
    validateAndGetSqsEvents: (interestingTransaction: InterestingTransaction) =>
      getSqsEventsFromTx(ProtocolEvent.MoeDeployment, interestingTransaction),
  },
  [ProtocolEvent.LegacyDeployment]: {
    name: ProtocolEvent.LegacyDeployment,
    contractMethodName: ContractMethodId.deployHolographableContract,
    events: [eventMap[EventType.SecondarySaleFees], eventMap[EventType.BridgeableContractDeployed]],
    sqsEventNames: [SqsEventName.ContractDeployed],
    validateAndGetSqsEvents: (interestingTransaction: InterestingTransaction) =>
      getSqsEventsFromTx(ProtocolEvent.LegacyDeployment, interestingTransaction),
  },
  [ProtocolEvent.BatchDeployment]: {
    name: ProtocolEvent.BatchDeployment,
    contractMethodName: ContractMethodId.deployHolographableContractMultiChain,
    events: [
      eventMap[EventType.SecondarySaleFees],
      eventMap[EventType.BridgeableContractDeployed],
      eventMap[EventType.AssignJob],
      eventMap[EventType.RelayerParams],
      // UNKNOWN EVENT: 0x4e41ee13e03cd5e0446487b524fdc48af6acf26c074dacdbdfb6b574b42c8146
      eventMap[EventType.PacketLZ],
      eventMap[EventType.CrossChainMessageSent],
    ],
    sqsEventNames: [SqsEventName.ContractDeployed, SqsEventName.BridgePreProcess],
    validateAndGetSqsEvents: (interestingTransaction: InterestingTransaction) =>
      getSqsEventsFromTx(ProtocolEvent.BatchDeployment, interestingTransaction),
  },
  [ProtocolEvent.LegacyMintNft]: {
    name: ProtocolEvent.LegacyMintNft,
    contractMethodName: ContractMethodId.cxipMint,
    events: [eventMap[EventType.TransferERC721], eventMap[EventType.HolographableContractEvent]],
    sqsEventNames: [SqsEventName.MintNft],
    validateAndGetSqsEvents: (interestingTransaction: InterestingTransaction) =>
      getSqsEventsFromTx(ProtocolEvent.LegacyMintNft, interestingTransaction),
  },
  [ProtocolEvent.MoeMintNft]: {
    name: ProtocolEvent.MoeMintNft,
    contractMethodName: ContractMethodId.purchase,
    events: [
      eventMap[EventType.TransferERC721],
      eventMap[EventType.HolographableContractEvent],
      eventMap[EventType.MintFeePayout],
      eventMap[EventType.Sale],
    ],
    sqsEventNames: [SqsEventName.MintNft],
    validateAndGetSqsEvents: (interestingTransaction: InterestingTransaction) =>
      getSqsEventsFromTx(ProtocolEvent.MoeMintNft, interestingTransaction),
  },
  [ProtocolEvent.BridgeOutErc721]: {
    name: ProtocolEvent.BridgeOutErc721,
    contractMethodName: ContractMethodId.bridgeOutRequest,
    events: [
      eventMap[EventType.TransferERC721],
      eventMap[EventType.HolographableContractEvent],
      eventMap[EventType.AssignJob],
      eventMap[EventType.RelayerParams],
      // UNKNOWN EVENT: 0x4e41ee13e03cd5e0446487b524fdc48af6acf26c074dacdbdfb6b574b42c8146
      eventMap[EventType.PacketLZ],
      eventMap[EventType.CrossChainMessageSent],
    ],
    sqsEventNames: [SqsEventName.BridgePreProcess],
    validateAndGetSqsEvents: (interestingTransaction: InterestingTransaction) =>
      getSqsEventsFromTx(ProtocolEvent.BridgeOutErc721, interestingTransaction),
  },
  [ProtocolEvent.AvailableOperatorJob]: {
    name: ProtocolEvent.AvailableOperatorJob,
    contractMethodName: ContractMethodId.validateTransactionProofV1,
    events: [eventMap[EventType.AvailableOperatorJob], eventMap[EventType.PacketReceived]],
    sqsEventNames: [SqsEventName.AvailableOperatorJob],
    validateAndGetSqsEvents: (interestingTransaction: InterestingTransaction) =>
      getSqsEventsFromTx(ProtocolEvent.AvailableOperatorJob, interestingTransaction),
  },
  [ProtocolEvent.FailedOperatorJob]: {
    name: ProtocolEvent.FailedOperatorJob,
    contractMethodName: ContractMethodId.executeJob,
    events: [eventMap[EventType.FailedOperatorJob], eventMap[EventType.FinishedOperatorJob]],
    sqsEventNames: [SqsEventName.FailedOperatorJob],
    validateAndGetSqsEvents: (interestingTransaction: InterestingTransaction) =>
      getSqsEventsFromTx(ProtocolEvent.FailedOperatorJob, interestingTransaction),
  },
  [ProtocolEvent.BridgeInErc721]: {
    name: ProtocolEvent.BridgeInErc721,
    contractMethodName: ContractMethodId.executeJob,
    events: [
      eventMap[EventType.FinishedOperatorJob],
      eventMap[EventType.TransferERC721],
      eventMap[EventType.HolographableContractEvent],
    ],
    sqsEventNames: [SqsEventName.BridgePreProcess],
    validateAndGetSqsEvents: (interestingTransaction: InterestingTransaction) =>
      getSqsEventsFromTx(ProtocolEvent.BridgeInErc721, interestingTransaction),
  },
  [ProtocolEvent.TransferOwnership]: {
    name: ProtocolEvent.TransferOwnership,
    contractMethodName: undefined,
    events: [eventMap[EventType.TransferERC721], eventMap[EventType.HolographableContractEvent]],
    sqsEventNames: [SqsEventName.TransferERC721],
    validateAndGetSqsEvents: (interestingTransaction: InterestingTransaction) =>
      getSqsEventsFromTx(ProtocolEvent.TransferOwnership, interestingTransaction),
  },
}

function validateTransaction(
  protocolEvent: ProtocolEventInfo,
  interestingTransaction: InterestingTransaction,
): boolean {
  if (protocolEvent.contractMethodName) {
    if (
      interestingTransaction.transaction.data &&
      interestingTransaction.transaction.data.startsWith(protocolEvent.contractMethodName) === false
    ) {
      return false
    }

    if (protocolEvent.name === ProtocolEvent.LegacyDeployment) {
      // NOTE: a MoeDeployment has all events and function name of a LegacyDeployment, the only difference is the EditionInitialized event.
      const hasEditionInitialized = interestingTransaction.allLogs.find(
        log => log.topics[0] === eventMap[EventType.EditionInitialized].sigHash,
      )
      if (hasEditionInitialized !== undefined) {
        return false
      }
    }
  } else if (interestingTransaction.transaction.data) {
    const txMethodId = interestingTransaction.transaction.data.slice(0, 10) // 0x + first 4 bytes (8 digits)
    const methodIds = new Set(Object.values(ContractMethodId) as string[])
    if (methodIds.has(txMethodId)) {
      return false
    }
  }

  // TODO: check for the logs order
  const txLogs = new Set(interestingTransaction.allLogs.map(log => log.topics[0]))
  return protocolEvent.events.every(event => txLogs.has(event.sigHash))
}

function getSqsEventsFromTx(protocolEventName: string, interestingTransaction: InterestingTransaction) {
  const protocolEvent = protocolEventsMap[protocolEventName as ProtocolEvent]

  if (validateTransaction(protocolEvent, interestingTransaction) === false) {
    return []
  }

  const sqsEvents: SqsEvent[] = []

  // instead of look for allLogs -> get only the events that are interesting

  for (const log of interestingTransaction.allLogs) {
    let event = protocolEvent.events.find(event => event.sigHash === log.topics[0])

    if (event === undefined) {
      continue
    }

    if (event.type === EventType.TransferERC721 && log.data && log.data !== '0x') {
      event = eventMap[EventType.TransferERC20]
    }

    let sqsEventName: SqsEventName
    const decodedEvent = event.decode(event.type, log)

    switch (event.type) {
      case EventType.BridgeableContractDeployed: {
        sqsEventName = SqsEventName.ContractDeployed
        break
      }

      case EventType.TransferERC721: {
        if ((protocolEventName as ProtocolEvent) === ProtocolEvent.TransferOwnership) {
          if ((decodedEvent as TransferERC721Event).from !== zeroAddress) {
            sqsEventName = SqsEventName.TransferERC721
            break
          }
        } else if (
          (protocolEventName as ProtocolEvent) !== ProtocolEvent.BridgeInErc721 &&
          (decodedEvent as TransferERC721Event).from === zeroAddress
        ) {
          sqsEventName = SqsEventName.MintNft
          break
        }
        /**
         * else if (from !== zeroAddress) then bridgeOut transfer
         * else if (ProtocolEvent.BridgeInErc721 && from === zeroAddress) then bridgeIn transfer
         */

        continue
      }

      case EventType.CrossChainMessageSent: {
        sqsEventName = SqsEventName.BridgePreProcess
        break
      }

      case EventType.AvailableOperatorJob: {
        sqsEventName = SqsEventName.AvailableOperatorJob
        break
      }

      case EventType.FinishedOperatorJob: {
        sqsEventName = SqsEventName.BridgePreProcess
        break
      }

      case EventType.FailedOperatorJob: {
        sqsEventName = SqsEventName.FailedOperatorJob
        break
      }

      default: {
        continue
      }
    }

    sqsEvents.push({
      sqsEventName,
      decodedEvent,
    })
  }

  return sqsEvents
}
