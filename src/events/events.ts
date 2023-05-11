import {EventFragment, Interface} from '@ethersproject/abi'
import {TransactionReceipt} from '@ethersproject/abstract-provider'
import {lowerCaseAllStrings} from './utils'

const iface: Interface = new Interface([])

const targetEvents: Record<string, string> = {
  AvailableJob: '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11',
  '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11': 'AvailableJob',

  AvailableOperatorJob: '0x4422a85db963f113e500bc4ada8f9e9f1a7bcd57cbec6907fbb2bf6aaf5878ff',
  '0x4422a85db963f113e500bc4ada8f9e9f1a7bcd57cbec6907fbb2bf6aaf5878ff': 'AvailableOperatorJob',

  FinishedOperatorJob: '0xfc3963369d694e97f35e33cc03fcd382bfa4dbb688ae43d318fcf344f479425e',
  '0xfc3963369d694e97f35e33cc03fcd382bfa4dbb688ae43d318fcf344f479425e': 'FinishedOperatorJob',

  FailedOperatorJob: '0x26dc03e6c4feb5e9d33804dc1646860c976c3aeabb458f4719c53dcbadbf44b5',
  '0x26dc03e6c4feb5e9d33804dc1646860c976c3aeabb458f4719c53dcbadbf44b5': 'FailedOperatorJob',

  BridgeableContractDeployed: '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b',
  '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b': 'BridgeableContractDeployed',

  CrossChainMessageSent: '0x0f5759b4182507dcfc771071166f98d7ca331262e5134eaa74b676adce2138b7',
  '0x0f5759b4182507dcfc771071166f98d7ca331262e5134eaa74b676adce2138b7': 'CrossChainMessageSent',

  LzEvent: '0x138bae39f5887c9423d9c61fbf2cba537d68671ee69f2008423dbc28c8c41663',
  '0x138bae39f5887c9423d9c61fbf2cba537d68671ee69f2008423dbc28c8c41663': 'LzEvent',

  LzPacket: '0xe9bded5f24a4168e4f3bf44e00298c993b22376aad8c58c7dda9718a54cbea82',
  '0xe9bded5f24a4168e4f3bf44e00298c993b22376aad8c58c7dda9718a54cbea82': 'LzPacket',

  Packet: '0xe8d23d927749ec8e512eb885679c2977d57068839d8cca1a85685dbbea0648f6',
  '0xe8d23d927749ec8e512eb885679c2977d57068839d8cca1a85685dbbea0648f6': 'Packet',

  Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': 'Transfer',
}

const packetEventFragment: EventFragment = EventFragment.from('Packet(uint16 chainId, bytes payload)')
const lzPacketEventFragment: EventFragment = EventFragment.from('Packet(bytes payload)')
const lzEventFragment: EventFragment = EventFragment.from(
  'LzEvent(uint16 _dstChainId, bytes _destination, bytes _payload)',
)
const erc20TransferEventFragment: EventFragment = EventFragment.from(
  'Transfer(address indexed _from, address indexed _to, uint256 _value)',
)
const erc721TransferEventFragment: EventFragment = EventFragment.from(
  'Transfer(address indexed _from, address indexed _to, uint256 indexed _tokenId)',
)
const availableJobEventFragment: EventFragment = EventFragment.from('AvailableJob(bytes payload)')
const bridgeableContractDeployedEventFragment: EventFragment = EventFragment.from(
  'BridgeableContractDeployed(address indexed contractAddress, bytes32 indexed hash)',
)
const availableOperatorJobEventFragment: EventFragment = EventFragment.from(
  'AvailableOperatorJob(bytes32 jobHash, bytes payload)',
)
const crossChainMessageSentEventFragment: EventFragment = EventFragment.from(
  'CrossChainMessageSent(bytes32 messageHash)',
)
const finishedOperatorJobEventFragment: EventFragment = EventFragment.from(
  'FinishedOperatorJob(bytes32 jobHash, address operator)',
)
const failedOperatorJobEventFragment: EventFragment = EventFragment.from('FailedOperatorJob(bytes32 jobHash)')

export function decodeLzPacketEvent(
  receipt: TransactionReceipt,
  messagingModuleAddress: string,
  target?: string,
): string | undefined {
  if (target !== undefined) {
    target = target.toLowerCase().trim()
  }

  const toFind = messagingModuleAddress.slice(2, 42)
  if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
    for (let i = 0, l = receipt.logs.length; i < l; i++) {
      const log = receipt.logs[i]
      if (
        log.topics[0] === targetEvents.LzPacket &&
        (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
      ) {
        const packetPayload = iface.decodeEventLog(lzPacketEventFragment, log.data, log.topics)[0] as string
        if (packetPayload.indexOf(toFind) > 0) {
          let index: number = packetPayload.indexOf(toFind)
          // address + bytes2 + address
          index += 40 + 4 + 40
          return ('0x' + packetPayload.slice(Math.max(0, index))).toLowerCase()
        }
      }
    }
  }

  return undefined
}

export function decodeLzEvent(receipt: TransactionReceipt, target?: string): any[] | undefined {
  if (target !== undefined) {
    target = target.toLowerCase().trim()
  }

  if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
    for (let i = 0, l = receipt.logs.length; i < l; i++) {
      const log = receipt.logs[i]
      if (
        log.topics[0] === targetEvents.LzEvent &&
        (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
      ) {
        const event = iface.decodeEventLog(lzEventFragment, log.data, log.topics) as any[]
        return lowerCaseAllStrings(event)
      }
    }
  }

  return undefined
}

export function decodeErc20TransferEvent(receipt: TransactionReceipt, target?: string): string[] | undefined {
  if (target !== undefined) {
    target = target.toLowerCase().trim()
  }

  if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
    for (let i = 0, l = receipt.logs.length; i < l; i++) {
      const log = receipt.logs[i]
      if (
        log.topics[0] === targetEvents.Transfer &&
        (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
      ) {
        const event = iface.decodeEventLog(erc20TransferEventFragment, log.data, log.topics) as string[]
        return lowerCaseAllStrings(event, log.address)
      }
    }
  }

  return undefined
}

export function getLogIndexFromErc721TransferEvent(receipt: TransactionReceipt, target?: string): number | undefined {
  if (target !== undefined) {
    target = target.toLowerCase().trim()
  }

  if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
    for (let i = 0, l = receipt.logs.length; i < l; i++) {
      const log = receipt.logs[i]
      if (
        log.topics[0] === targetEvents.Transfer &&
        (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
      ) {
        return log.logIndex
      }
    }
  }

  return undefined
}

export function decodeErc721TransferEvent(receipt: TransactionReceipt, target?: string): string[] | undefined {
  if (target !== undefined) {
    target = target.toLowerCase().trim()
  }

  if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
    for (let i = 0, l = receipt.logs.length; i < l; i++) {
      const log = receipt.logs[i]
      if (
        log.topics[0] === targetEvents.Transfer &&
        (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
      ) {
        const event = iface.decodeEventLog(erc721TransferEventFragment, log.data, log.topics) as string[]
        return lowerCaseAllStrings(event, log.address)
      }
    }
  }

  return undefined
}

export function decodeAvailableJobEvent(receipt: TransactionReceipt, target?: string): string | undefined {
  if (target !== undefined) {
    target = target.toLowerCase().trim()
  }

  if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
    for (let i = 0, l = receipt.logs.length; i < l; i++) {
      const log = receipt.logs[i]
      if (
        log.topics[0] === targetEvents.AvailableJob &&
        (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
      ) {
        return (iface.decodeEventLog(availableJobEventFragment, log.data, log.topics)[0] as string).toLowerCase()
      }
    }
  }

  return undefined
}

export function decodeAvailableOperatorJobEvent(receipt: TransactionReceipt, target?: string): string[] | undefined {
  if (target !== undefined) {
    target = target.toLowerCase().trim()
  }

  if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
    for (let i = 0, l = receipt.logs.length; i < l; i++) {
      const log = receipt.logs[i]
      if (
        log.topics[0] === targetEvents.AvailableOperatorJob &&
        (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
      ) {
        const output: string[] = iface.decodeEventLog(
          availableOperatorJobEventFragment,
          log.data,
          log.topics,
        ) as string[]
        return lowerCaseAllStrings(output) as string[]
      }
    }
  }

  return undefined
}

export function decodeBridgeableContractDeployedEvent(
  receipt: TransactionReceipt,
  target?: string,
): string[] | undefined {
  if (target !== undefined) {
    target = target.toLowerCase().trim()
  }

  if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
    for (let i = 0, l = receipt.logs.length; i < l; i++) {
      const log = receipt.logs[i]
      if (
        log.topics[0] === targetEvents.BridgeableContractDeployed &&
        (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
      ) {
        return lowerCaseAllStrings(
          iface.decodeEventLog(bridgeableContractDeployedEventFragment, log.data, log.topics) as string[],
        )
      }
    }
  }

  return undefined
}

export function decodeCrossChainMessageSentEvent(receipt: TransactionReceipt, target?: string): string | undefined {
  if (target !== undefined) {
    target = target.toLowerCase().trim()
  }

  if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
    for (let i = 0, l = receipt.logs.length; i < l; i++) {
      const log = receipt.logs[i]
      if (
        log.topics[0] === targetEvents.CrossChainMessageSent &&
        (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
      ) {
        return (
          iface.decodeEventLog(crossChainMessageSentEventFragment, log.data, log.topics)[0] as string
        ).toLowerCase()
      }
    }
  }

  return undefined
}

export function decodeFinishedOperatorJobEvent(receipt: TransactionReceipt, target?: string): string[] | undefined {
  if (target !== undefined) {
    target = target.toLowerCase().trim()
  }

  if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
    for (let i = 0, l = receipt.logs.length; i < l; i++) {
      const log = receipt.logs[i]
      if (
        log.topics[0] === targetEvents.FinishedOperatorJob &&
        (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
      ) {
        const output: string[] = iface.decodeEventLog(
          finishedOperatorJobEventFragment,
          log.data,
          log.topics,
        ) as string[]
        return lowerCaseAllStrings(output) as string[]
      }
    }
  }

  return undefined
}

export function decodeFailedOperatorJobEvent(receipt: TransactionReceipt, target?: string): string | undefined {
  if (target !== undefined) {
    target = target.toLowerCase().trim()
  }

  if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
    for (let i = 0, l = receipt.logs.length; i < l; i++) {
      const log = receipt.logs[i]
      if (
        log.topics[0] === targetEvents.FailedOperatorJob &&
        (target === undefined || (target !== undefined && log.address.toLowerCase() === target))
      ) {
        return (iface.decodeEventLog(failedOperatorJobEventFragment, log.data, log.topics)[0] as string).toLowerCase()
      }
    }
  }

  return undefined
}

export {
  iface,
  targetEvents,
  packetEventFragment,
  lzPacketEventFragment,
  lzEventFragment,
  erc20TransferEventFragment,
  erc721TransferEventFragment,
  availableJobEventFragment,
  bridgeableContractDeployedEventFragment,
  availableOperatorJobEventFragment,
  crossChainMessageSentEventFragment,
  finishedOperatorJobEventFragment,
  failedOperatorJobEventFragment,
}
