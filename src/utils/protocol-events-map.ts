import {ExtraDataType, InterestingTransaction, SqsEvent} from '../types/network-monitor'
import {SqsEventName} from '../types/sqs'
import {
  Event,
  EventType,
  HolographableContractEvent,
  TransferERC721Event,
  decodeHolographableContractEvent,
  eventMap,
} from './event'
import {CrossChainMessageType} from './event/event'
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
  BridgeOut = 'BridgeOut',
  AvailableOperatorJob = 'AvailableOperatorJob',
  BridgeIn = 'BridgeIn',
  FailedOperatorJob = 'FailedOperatorJob',
  TransferErc20OrErc721 = 'TransferErc20OrErc721',
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
  [ProtocolEvent.MoeMintNft]: {
    name: ProtocolEvent.MoeMintNft,
    contractMethodName: ContractMethodId.purchase,
    events: [
      // eventMap[EventType.TransferERC721], // NOTE: transfer checks are skipped for efficiency. Filtering transfer logs is costly, and all relevant data is already available in the HolographableContractEvent.
      eventMap[EventType.HolographableContractEvent],
      eventMap[EventType.MintFeePayout],
      eventMap[EventType.Sale],
    ],
    sqsEventNames: [SqsEventName.MintNft],
    validateAndGetSqsEvents: (interestingTransaction: InterestingTransaction) =>
      getSqsEventsFromTx(ProtocolEvent.MoeMintNft, interestingTransaction),
  },
  [ProtocolEvent.LegacyMintNft]: {
    name: ProtocolEvent.LegacyMintNft,
    contractMethodName: ContractMethodId.cxipMint,
    events: [
      // eventMap[EventType.TransferERC721], // NOTE: transfer checks are skipped for efficiency. Filtering transfer logs is costly, and all relevant data is already available in the HolographableContractEvent.
      eventMap[EventType.HolographableContractEvent],
    ],
    sqsEventNames: [SqsEventName.MintNft],
    validateAndGetSqsEvents: (interestingTransaction: InterestingTransaction) =>
      getSqsEventsFromTx(ProtocolEvent.LegacyMintNft, interestingTransaction),
  },

  [ProtocolEvent.BridgeOut]: {
    name: ProtocolEvent.BridgeOut,
    contractMethodName: ContractMethodId.bridgeOutRequest,
    events: [
      // eventMap[EventType.TransferERC721], // NOTE: transfer checks are skipped for efficiency. Filtering transfer logs is costly, and all relevant data is already available in the HolographableContractEvent.
      eventMap[EventType.HolographableContractEvent],
      eventMap[EventType.AssignJob],
      eventMap[EventType.RelayerParams],
      // UNKNOWN EVENT: 0x4e41ee13e03cd5e0446487b524fdc48af6acf26c074dacdbdfb6b574b42c8146
      eventMap[EventType.PacketLZ],
      eventMap[EventType.CrossChainMessageSent],
    ],
    sqsEventNames: [SqsEventName.BridgePreProcess],
    validateAndGetSqsEvents: (interestingTransaction: InterestingTransaction) =>
      getSqsEventsFromTx(ProtocolEvent.BridgeOut, interestingTransaction),
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
  [ProtocolEvent.BridgeIn]: {
    name: ProtocolEvent.BridgeIn,
    contractMethodName: ContractMethodId.executeJob,
    events: [
      eventMap[EventType.FinishedOperatorJob],
      // eventMap[EventType.TransferERC721], // NOTE: transfer checks are skipped for efficiency. Filtering transfer logs is costly, and all relevant data is already available in the HolographableContractEvent.
      eventMap[EventType.HolographableContractEvent],
    ],
    sqsEventNames: [SqsEventName.BridgePreProcess],
    validateAndGetSqsEvents: (interestingTransaction: InterestingTransaction) =>
      getSqsEventsFromTx(ProtocolEvent.BridgeIn, interestingTransaction),
  },
  // used for TransferOwnership and TransferHLG
  [ProtocolEvent.TransferErc20OrErc721]: {
    name: ProtocolEvent.TransferErc20OrErc721,
    contractMethodName: undefined,
    events: [
      // eventMap[EventType.TransferERC721], // NOTE: transfer checks are skipped for efficiency. Filtering transfer logs is costly, and all relevant data is already available in the HolographableContractEvent.
      eventMap[EventType.HolographableContractEvent],
    ],
    sqsEventNames: [SqsEventName.TransferERC721],
    validateAndGetSqsEvents: (interestingTransaction: InterestingTransaction) =>
      getSqsEventsFromTx(ProtocolEvent.TransferErc20OrErc721, interestingTransaction),
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
  let extraData: ExtraDataType | undefined

  for (const log of interestingTransaction.allLogs) {
    const event = protocolEvent.events.find(event => event.sigHash === log.topics[0])

    if (event === undefined) {
      continue
    }

    let sqsEventName: SqsEventName
    let decodedEvent = event.decode(event.type, log)

    switch (event.type) {
      case EventType.BridgeableContractDeployed: {
        sqsEventName = SqsEventName.ContractDeployed
        break
      }

      case EventType.HolographableContractEvent: {
        decodedEvent = decodeHolographableContractEvent(decodedEvent as HolographableContractEvent)

        if (decodedEvent === null) {
          continue
        }

        if (
          (protocolEventName as ProtocolEvent) === ProtocolEvent.BridgeOut ||
          (protocolEventName as ProtocolEvent) === ProtocolEvent.BridgeIn
        ) {
          const extraDataValue = {
            crossChainMessageType:
              decodedEvent.type === EventType.TransferERC721
                ? CrossChainMessageType.ERC721
                : CrossChainMessageType.ERC20_HLG,
          }

          /**
           * Prioritize ERC721 data for NFT bridge transactions:
           *
           * - In bridge transactions involving NFTs, both ERC20 and ERC721 holographable events are generated.
           * - To ensure consistency and accuracy, this check prioritizes the ERC721 data for further processing.
           */
          if (extraData === undefined) {
            extraData = extraDataValue
          } else if (extraData.crossChainMessageType !== CrossChainMessageType.ERC721) {
            extraData = extraDataValue
          }

          continue
        }

        switch (decodedEvent.type) {
          case EventType.TransferERC721: {
            const transferERC721Event = decodedEvent as TransferERC721Event
            sqsEventName = transferERC721Event.from === zeroAddress ? SqsEventName.MintNft : SqsEventName.TransferERC721
            break
          }

          case EventType.TransferERC20: {
            sqsEventName = SqsEventName.TransferERC20
            break
          }

          default: {
            continue
          }
        }

        break
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

  if (extraData !== undefined) {
    return sqsEvents.map(sqsEvent => ({...sqsEvent, extraData}))
  }

  return sqsEvents
}
