/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
import {Log, TransactionResponse} from '@ethersproject/abstract-provider'
import {keccak256} from '@ethersproject/keccak256'

import {Event, EventType, eventMap} from './event'

export enum BloomType {
  unknown,
  topic,
  contract,
  address,
}

export interface BloomFilterValidator {
  bloomType: BloomType
  bloomValue: string
  bloomValueHashed: string
}

export type EventValidator = (transaction: TransactionResponse, log: Log) => boolean

export interface BloomFilter {
  bloomEvent: Event
  bloomId: string
  bloomType: BloomType
  bloomValue: string
  bloomValueHashed: string
  bloomFilterValidators?: BloomFilterValidator[]
  eventValidator?: EventValidator
}

export const buildFilter = (
  bloomType: BloomType,
  eventType: EventType,
  bloomId?: string,
  bloomFilterValidators?: BloomFilterValidator[],
  eventValidator?: EventValidator,
): BloomFilter => {
  const filter: BloomFilter = {
    bloomEvent: eventMap[eventType],
    bloomId: bloomId ?? EventType[eventType],
    bloomType,
    bloomValue: eventMap[eventType].event,
    bloomValueHashed: eventMap[eventType].sigHash,
  }
  if (bloomFilterValidators) {
    filter.bloomFilterValidators = bloomFilterValidators
  }

  if (eventValidator) {
    filter.eventValidator = eventValidator
  }

  return filter
}

export type BloomFilterMap = {
  [key in keyof typeof EventType]?: BloomFilter
}
