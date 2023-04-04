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
  TransferERC721 = 'TransferERC721',
  TransferSingleERC1155 = 'TransferSingleERC1155',
  TransferBatchERC1155 = 'TransferBatchERC1155',
  BridgeableContractDeployed = 'BridgeableContractDeployed',
  CrossChainMessageSent = 'CrossChainMessageSent',
  AvailableOperatorJob = 'AvailableOperatorJob',
  FinishedOperatorJob = 'FinishedOperatorJob',
  FailedOperatorJob = 'FailedOperatorJob',
  PacketLZ = 'PacketLZ',
  V1PacketLZ = 'V1PacketLZ',
  TestLzEvent = 'TestLzEvent',
}

export interface BaseEvent {
  type: EventType
  contract: string
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

export type DecodedEvent =
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
    case EventType.TransferERC20:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        from: (decodedLog._from as string).toLowerCase(),
        to: (decodedLog._to as string).toLowerCase(),
        value: BigNumber.from(decodedLog._value),
      } as unknown as T
      break
    case EventType.TransferERC721:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        from: (decodedLog._from as string).toLowerCase(),
        to: (decodedLog._to as string).toLowerCase(),
        tokenId: BigNumber.from(decodedLog._tokenId),
      } as unknown as T
      break
    case EventType.TransferSingleERC1155:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
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
        contractAddress: (decodedLog._contractAddress as string).toLowerCase(),
        hash: (decodedLog._hash as string).toLowerCase(),
      } as unknown as T
      break
    case EventType.CrossChainMessageSent:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        messageHash: (decodedLog._messageHash as string).toLowerCase(),
      } as unknown as T
      break
    case EventType.AvailableOperatorJob:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        jobHash: (decodedLog._jobHash as string).toLowerCase(),
        payload: (decodedLog._payload as string).toLowerCase(),
      } as unknown as T
      break
    case EventType.FinishedOperatorJob:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        jobHash: (decodedLog._jobHash as string).toLowerCase(),
        operator: (decodedLog._operator as string).toLowerCase(),
      } as unknown as T
      break
    case EventType.FailedOperatorJob:
      output = {
        type,
        contract: (log.address as string).toLowerCase(),
        jobHash: (decodedLog._jobHash as string).toLowerCase(),
      } as unknown as T
      break
  }

  return output
}

export interface Event {
  type: EventType
  sigHash: string
  name: string
  eventName: string
  event: string
  fragment: EventFragment
  decode: EventDecoder
}

export const eventBuilder = (eventType: EventType, event: string): Event => {
  const fragment: EventFragment = EventFragment.from(event)
  return {
    type: eventType,
    sigHash: iface.getEventTopic(fragment),
    name: EventType[eventType],
    eventName: fragment.name,
    event,
    fragment,
    decode: <T extends DecodedEvent>(type: EventType, log: Log): T | null => {
      return decodeKnownEvent<T>(type, fragment, log)
    },
  } as Event
}

type EventMap = {[key in keyof typeof EventType]: Event}

export const eventMap: EventMap = {
  [EventType.UNKNOWN]: {} as unknown as Event,
  [EventType.TBD]: {} as unknown as Event,
  [EventType.TransferERC20]: eventBuilder(
    EventType.TransferERC20,
    'Transfer(address indexed _from, address indexed _to, uint256 _value)',
  ),
  [EventType.TransferERC721]: eventBuilder(
    EventType.TransferERC721,
    'Transfer(address indexed _from, address indexed _to, uint256 indexed _tokenId)',
  ),
  [EventType.TransferSingleERC1155]: eventBuilder(
    EventType.TransferSingleERC1155,
    'TransferSingle(address indexed _operator, address indexed _from, address indexed _to, uint256 _tokenId, uint256 _value)',
  ),
  [EventType.TransferBatchERC1155]: eventBuilder(
    EventType.TransferBatchERC1155,
    'TransferBatch(address indexed _operator, address indexed _from, address indexed _to, uint256[] _tokenIds, uint256[] _values)',
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
}
