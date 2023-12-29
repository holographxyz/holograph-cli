/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import {Interface, EventFragment, FormatTypes, defaultAbiCoder, Result} from '@ethersproject/abi'
import {Log} from '@ethersproject/abstract-provider'
import {BigNumber} from '@ethersproject/bignumber'

const iface: Interface = new Interface([])

export enum EventType {
  UNKNOWN = 'UNKNOWN',
  TBD = 'TBD',
  TransferERC20 = 'TransferERC20',
  HolographableTransferERC20 = 'HolographableTransferERC20', // TODO: what event is this?
  TransferERC721 = 'TransferERC721',
  HolographableTransferERC721 = 'HolographableTransferERC721',
  TransferSingleERC1155 = 'TransferSingleERC1155',
  HolographableTransferSingleERC1155 = 'HolographableTransferSingleERC1155',
  TransferBatchERC1155 = 'TransferBatchERC1155',
  HolographableTransferBatchERC1155 = 'HolographableTransferBatchERC1155',
  BridgeableContractDeployed = 'BridgeableContractDeployed',
  CrossChainMessageSent = 'CrossChainMessageSent',
  AvailableOperatorJob = 'AvailableOperatorJob',
  FinishedOperatorJob = 'FinishedOperatorJob',
  FailedOperatorJob = 'FailedOperatorJob',
  PacketLZ = 'PacketLZ',
  V1PacketLZ = 'V1PacketLZ',
  TestLzEvent = 'TestLzEvent',
  HolographableContractEvent = 'HolographableContractEvent',
  MintFeePayout = 'MintFeePayout',
  Sale = 'Sale',
  SecondarySaleFees = 'SecondarySaleFees',
  EditionInitialized = 'EditionInitialized',
  RelayerParams = 'RelayerParams',
  AssignJob = 'AssignJob',
  PacketReceived = 'PacketReceived',
}

export enum CrossChainMessageType {
  UNKNOWN = 'UNKNOWN',
  ERC721 = 'ERC721',
  ERC1155 = 'ERC1155',
  ERC20 = 'ERC20',
  CONTRACT = 'CONTRACT',
}

export interface Event {
  type: EventType
  sigHash: string
  customSigHash?: string
  name: string
  eventName: string
  event: string
  fragment: EventFragment
  decode: EventDecoder
}

export interface BaseEvent {
  type: EventType
  contract: string
  logIndex: number
}

export interface HolographableContractEvent extends BaseEvent {
  contractAddress: string
  payload: string
}

export interface TransferERC20Event extends BaseEvent {
  from: string
  to: string
  value: BigNumber
}

export interface TransferERC721Event extends BaseEvent {
  from: string
  to: string
  tokenId: BigNumber
}

export interface TransferSingleERC1155Event extends BaseEvent {
  operator: string
  from: string
  to: string
  tokenId: BigNumber
  value: BigNumber
}

export interface TransferBatchERC1155Event extends BaseEvent {
  operator: string
  from: string
  to: string
  tokenIds: BigNumber[]
  values: BigNumber[]
}

export interface BridgeableContractDeployedEvent extends BaseEvent {
  contractAddress: string
  hash: string
}

export interface CrossChainMessageSentEvent extends BaseEvent {
  messageHash: string
}

export interface AvailableOperatorJobEvent extends BaseEvent {
  jobHash: string
  payload: string
}

export interface FinishedOperatorJobEvent extends BaseEvent {
  jobHash: string
  operator: string
}

export interface FailedOperatorJobEvent extends BaseEvent {
  jobHash: string
}

export interface MintFeePayout extends BaseEvent {
  mintFeeAmount: BigNumber
  mintFeeRecipient: string
  success: boolean
}

export interface Sale extends BaseEvent {
  to: string
  quantity: BigNumber
  pricePerToken: BigNumber
  firstPurchasedTokenId: BigNumber
}

export interface SecondarySaleFees extends BaseEvent {
  tokenId: BigNumber
  recipients: string[]
  bps: BigNumber[]
}

export interface EditionInitialized extends BaseEvent {
  target: string
  description: string
  imageURI: string
  string: string
}

export interface RelayerParams extends BaseEvent {
  adapterParams: string // bytes
  outboundProofType: BigNumber
}

export interface AssignJob extends BaseEvent {
  totalFee: BigNumber
}

export interface PacketReceived extends BaseEvent {
  srcChainId: BigNumber
  srcAddress: string // bytes
  dstAddress: string
  nonce: BigNumber
  payloadHash: string // bytes32
}

export type DecodedEvent =
  | HolographableContractEvent
  | TransferERC20Event
  | TransferERC721Event
  | TransferSingleERC1155Event
  | TransferBatchERC1155Event
  | BridgeableContractDeployedEvent
  | CrossChainMessageSentEvent
  | AvailableOperatorJobEvent
  | FinishedOperatorJobEvent
  | FailedOperatorJobEvent

export type EventDecoder = <T extends DecodedEvent>(type: EventType, log: Log) => T | null

type EventMap = {[key in keyof typeof EventType]: Event}

/**
 * This event is emitted alongside TransferERC20, TransferERC721, and Transfer ERC1155 events. Its payload provides information about the accompanying event. Use this function to decode HolographableContractEvent and identify the actual event it corresponds to.
 * @param holographableContractEvent
 * @returns DecodedEvent | null
 */
export const decodeHolographableContractEvent = (
  holographableContractEvent: HolographableContractEvent,
): DecodedEvent | null => {
  let type: EventType = EventType.UNKNOWN
  let realEvent: Event = eventMap[EventType.UNKNOWN]

  const eventSignature: string = (
    defaultAbiCoder.decode(['bytes32'], holographableContractEvent.payload) as string[]
  )[0]

  switch (eventSignature) {
    case eventMap[EventType.HolographableTransferERC20].customSigHash!:
      type = EventType.TransferERC20
      realEvent = eventMap[EventType.HolographableTransferERC20]
      break
    case eventMap[EventType.HolographableTransferERC721].customSigHash!:
      type = EventType.TransferERC721
      realEvent = eventMap[EventType.HolographableTransferERC721]
      break
    case eventMap[EventType.HolographableTransferSingleERC1155].customSigHash!:
      type = EventType.TransferSingleERC1155
      realEvent = eventMap[EventType.HolographableTransferSingleERC1155]
      break
    case eventMap[EventType.HolographableTransferBatchERC1155].customSigHash!:
      type = EventType.TransferBatchERC1155
      realEvent = eventMap[EventType.HolographableTransferBatchERC1155]
      break
  }

  let log: Log = {
    address: holographableContractEvent.contractAddress,
    logIndex: holographableContractEvent.logIndex,
    topics: [realEvent.sigHash],
    data: holographableContractEvent.payload,
  } as unknown as Log

  let output: DecodedEvent | null = null
  const decodedLog: Result | null = iface.decodeEventLog(realEvent.fragment, log.data, log.topics)
  if (decodedLog === null) {
    return null
  }

  switch (type) {
    case EventType.TransferERC20:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        logIndex: log.logIndex,
        from: (decodedLog._from as string).toLowerCase(),
        to: (decodedLog._to as string).toLowerCase(),
        value: BigNumber.from(decodedLog._value),
      } as unknown as TransferERC20Event
      break
    case EventType.TransferERC721:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        logIndex: log.logIndex,
        from: (decodedLog._from as string).toLowerCase(),
        to: (decodedLog._to as string).toLowerCase(),
        tokenId: BigNumber.from(decodedLog._tokenId),
      } as unknown as TransferERC721Event
      break
    case EventType.TransferSingleERC1155:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        logIndex: log.logIndex,
        from: (decodedLog._from as string).toLowerCase(),
        to: (decodedLog._to as string).toLowerCase(),
        tokenId: BigNumber.from(decodedLog._tokenId),
        value: BigNumber.from(decodedLog._value),
      } as unknown as TransferSingleERC1155Event
      break
    case EventType.TransferBatchERC1155:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        logIndex: log.logIndex,
        from: (decodedLog._from as string).toLowerCase(),
        to: (decodedLog._to as string).toLowerCase(),
        tokenIds: decodedLog._tokenIds as BigNumber[],
        values: decodedLog._values as BigNumber[],
      } as unknown as TransferBatchERC1155Event
      break
  }

  return output
}

export const decodeKnownEvent = <T extends DecodedEvent>(
  type: EventType,
  fragment: EventFragment,
  log: Log,
): T | null => {
  let output: T | null = null
  const decodedLog: Result | null = iface.decodeEventLog(fragment, log.data, log.topics)
  if (decodedLog === null) {
    return null
  }

  switch (type) {
    case EventType.UNKNOWN:
      return null
    case EventType.HolographableContractEvent:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        logIndex: log.logIndex,
        contractAddress: (decodedLog._holographableContract as string).toLowerCase(),
        payload: (decodedLog._payload as string).toLowerCase(),
      } as unknown as T
      break
    case EventType.TransferERC20:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        logIndex: log.logIndex,
        from: (decodedLog._from as string).toLowerCase(),
        to: (decodedLog._to as string).toLowerCase(),
        value: BigNumber.from(decodedLog._value),
      } as unknown as T
      break
    case EventType.HolographableTransferERC20:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        logIndex: log.logIndex,
        from: (decodedLog._from as string).toLowerCase(),
        to: (decodedLog._to as string).toLowerCase(),
        value: BigNumber.from(decodedLog._value),
      } as unknown as T
      break
    case EventType.TransferERC721:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        logIndex: log.logIndex,
        from: (decodedLog._from as string).toLowerCase(),
        to: (decodedLog._to as string).toLowerCase(),
        tokenId: BigNumber.from(decodedLog._tokenId),
      } as unknown as T
      break
    case EventType.TransferSingleERC1155:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        logIndex: log.logIndex,
        from: (decodedLog._from as string).toLowerCase(),
        to: (decodedLog._to as string).toLowerCase(),
        tokenId: BigNumber.from(decodedLog._tokenId),
        value: BigNumber.from(decodedLog._value),
      } as unknown as T
      break
    case EventType.TransferBatchERC1155:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        logIndex: log.logIndex,
        from: (decodedLog._from as string).toLowerCase(),
        to: (decodedLog._to as string).toLowerCase(),
        tokenIds: decodedLog._tokenIds as BigNumber[],
        values: decodedLog._values as BigNumber[],
      } as unknown as T
      break
    case EventType.BridgeableContractDeployed:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        logIndex: log.logIndex,
        contractAddress: (decodedLog._contractAddress as string).toLowerCase(),
        hash: (decodedLog._hash as string).toLowerCase(),
      } as unknown as T
      break
    case EventType.CrossChainMessageSent:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        logIndex: log.logIndex,
        messageHash: (decodedLog._messageHash as string).toLowerCase(),
      } as unknown as T
      break
    case EventType.AvailableOperatorJob:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        logIndex: log.logIndex,
        jobHash: (decodedLog._jobHash as string).toLowerCase(),
        payload: (decodedLog._payload as string).toLowerCase(),
      } as unknown as T
      break
    case EventType.FinishedOperatorJob:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        logIndex: log.logIndex,
        jobHash: (decodedLog._jobHash as string).toLowerCase(),
        operator: (decodedLog._operator as string).toLowerCase(),
      } as unknown as T
      break
    case EventType.FailedOperatorJob:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        logIndex: log.logIndex,
        jobHash: (decodedLog._jobHash as string).toLowerCase(),
      } as unknown as T
      break
  }

  return output
}

export const eventBuilder = (eventType: EventType, event: string, customSig?: string): Event => {
  const fragment: EventFragment = EventFragment.from(event)
  return {
    type: eventType,
    sigHash: iface.getEventTopic(fragment),
    customSigHash: customSig ? iface.getEventTopic(EventFragment.from(customSig)) : undefined,
    name: EventType[eventType],
    eventName: fragment.name,
    event,
    fragment,
    decode: <T extends DecodedEvent>(type: EventType, log: Log): T | null => {
      return decodeKnownEvent<T>(type, fragment, log)
    },
  } as Event
}

export const eventMap: EventMap = {
  [EventType.UNKNOWN]: {} as unknown as Event,
  [EventType.TBD]: {} as unknown as Event,
  [EventType.HolographableContractEvent]: eventBuilder(
    EventType.HolographableContractEvent,
    'HolographableContractEvent(address indexed _holographableContract, bytes _payload)',
  ),
  [EventType.TransferERC20]: eventBuilder(
    EventType.TransferERC20,
    'Transfer(address indexed _from, address indexed _to, uint256 _value)',
  ),
  [EventType.HolographableTransferERC20]: eventBuilder(
    EventType.HolographableTransferERC20,
    'TransferERC20(bytes32 _event, address _from, address _to, uint256 _value)',
    'TransferERC20(address _from, address _to, uint256 _value)',
  ),
  [EventType.TransferERC721]: eventBuilder(
    EventType.TransferERC721,
    'Transfer(address indexed _from, address indexed _to, uint256 indexed _tokenId)',
  ),
  [EventType.HolographableTransferERC721]: eventBuilder(
    EventType.HolographableTransferERC721,
    'TransferERC721(bytes32 _event, address _from, address _to, uint256 _tokenId)',
    'TransferERC721(address _from, address _to, uint256 _tokenId)',
  ),
  [EventType.TransferSingleERC1155]: eventBuilder(
    EventType.TransferSingleERC1155,
    'TransferSingle(address indexed _operator, address indexed _from, address indexed _to, uint256 _tokenId, uint256 _value)',
  ),
  [EventType.HolographableTransferSingleERC1155]: eventBuilder(
    EventType.HolographableTransferSingleERC1155,
    'TransferSingleERC1155(bytes32 _event, address _operator, address _from, address _to, uint256 _tokenId, uint256 _value)',
    'TransferSingleERC1155(address _operator, address _from, address _to, uint256 _tokenId, uint256 _value)',
  ),
  [EventType.TransferBatchERC1155]: eventBuilder(
    EventType.TransferBatchERC1155,
    'TransferBatch(address indexed _operator, address indexed _from, address indexed _to, uint256[] _tokenIds, uint256[] _values)',
  ),
  [EventType.HolographableTransferBatchERC1155]: eventBuilder(
    EventType.HolographableTransferBatchERC1155,
    'TransferBatchERC1155(bytes32 _event, address _operator, address _from, address _to, uint256[] _tokenIds, uint256[] _values)',
    'TransferBatchERC1155(address _operator, address _from, address _to, uint256[] _tokenIds, uint256[] _values)',
  ),
  [EventType.BridgeableContractDeployed]: eventBuilder(
    EventType.BridgeableContractDeployed,
    'BridgeableContractDeployed(address indexed _contractAddress, bytes32 indexed _hash)',
  ),
  [EventType.CrossChainMessageSent]: eventBuilder(
    EventType.CrossChainMessageSent,
    'CrossChainMessageSent(bytes32 _messageHash)',
  ),
  [EventType.AvailableOperatorJob]: eventBuilder(
    EventType.AvailableOperatorJob,
    'AvailableOperatorJob(bytes32 _jobHash, bytes _payload)',
  ),
  [EventType.FinishedOperatorJob]: eventBuilder(
    EventType.FinishedOperatorJob,
    'FinishedOperatorJob(bytes32 _jobHash, address _operator)',
  ),
  [EventType.FailedOperatorJob]: eventBuilder(EventType.FailedOperatorJob, 'FailedOperatorJob(bytes32 _jobHash)'),
  [EventType.PacketLZ]: eventBuilder(EventType.PacketLZ, 'Packet(bytes _payload)'),
  [EventType.V1PacketLZ]: eventBuilder(EventType.V1PacketLZ, 'Packet(uint16 _chainId, bytes _payload)'),
  [EventType.TestLzEvent]: eventBuilder(
    EventType.TestLzEvent,
    'LzEvent(uint16 _dstChainId, bytes _destination, bytes _payload)',
  ),
  [EventType.MintFeePayout]: eventBuilder(
    EventType.MintFeePayout,
    'MintFeePayout(uint256 mintFeeAmount, address mintFeeRecipient, bool success)',
  ),
  [EventType.Sale]: eventBuilder(
    EventType.Sale,
    'Sale(address indexed to, uint256 indexed quantity, uint256 indexed pricePerToken, uint256 firstPurchasedTokenId)',
  ),
  [EventType.SecondarySaleFees]: eventBuilder(
    EventType.SecondarySaleFees,
    'SecondarySaleFees(uint256 tokenId, address[] recipients, uint256[] bps)',
  ),
  [EventType.EditionInitialized]: eventBuilder(
    EventType.EditionInitialized,
    ' EditionInitialized(address indexed target, string description, string imageURI, string animationURI)',
  ),
  [EventType.AssignJob]: eventBuilder(EventType.AssignJob, 'AssignJob (uint256 totalFee)'),
  [EventType.RelayerParams]: eventBuilder(
    EventType.RelayerParams,
    'RelayerParams (bytes adapterParams, uint16 outboundProofType)',
  ),
  [EventType.PacketReceived]: eventBuilder(
    EventType.PacketReceived,
    'PacketReceived (uint16 indexed srcChainId, bytes indexed srcAddress, address dstAddress, uint64 nonce, bytes32 payloadHash)',
  ),
}
