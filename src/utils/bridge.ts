import {BigNumberish, BytesLike, BigNumber} from 'ethers'
import Web3 from 'web3'
const web3 = new Web3()

export interface BridgeInArgs {
  nonce: BigNumber
  fromChain: BigNumber
  holographableContract: string
  hToken: string
  hTokenRecipient: string
  hTokenValue: BigNumber
  doNotRevert: boolean
  bridgeInPayload: string
}

export interface BridgeInPayload {
  fromChain: BigNumber
  payload: string
}

export interface BridgeInErc20Args {
  from: string
  to: string
  amount: BigNumber
  data: string
}

export interface BridgeInErc721Args {
  from: number
  to: string
  tokenId: BigNumber
  data: string
}

export const decodeBridgeIn = function (input: string): BridgeInPayload {
  const decoded = web3.eth.abi.decodeParameters(
    [
      {
        internalType: 'uint32',
        name: 'fromChain',
        type: 'uint32',
      },
      {
        internalType: 'bytes',
        name: 'payload',
        type: 'bytes',
      },
    ],
    input,
  )
  return {
    fromChain: decoded.fromChain,
    payload: decoded.fromChain,
  } as BridgeInPayload
}

export const decodeBridgeInErc20Args = function (input: string): BridgeInErc20Args {
  const decoded = web3.eth.abi.decodeParameters(
    [
      {
        internalType: 'address',
        name: 'from',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'to',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
      {
        internalType: 'bytes',
        name: 'data',
        type: 'bytes',
      },
    ],
    input,
  )
  return {
    from: decoded.from,
    to: decoded.to,
    amount: decoded.amount,
    data: decoded.data,
  } as BridgeInErc20Args
}

export const decodeBridgeInErc721Args = function (input: string): BridgeInErc721Args {
  const decoded = web3.eth.abi.decodeParameters(
    [
      {
        internalType: 'address',
        name: 'from',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'to',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'tokenId',
        type: 'uint256',
      },
      {
        internalType: 'bytes',
        name: 'data',
        type: 'bytes',
      },
    ],
    input,
  )
  return {
    from: decoded.from,
    to: decoded.to,
    tokenId: decoded.tokenId,
    data: decoded.data,
  } as BridgeInErc721Args
}

export interface BridgeOutArgs {
  toChain: BigNumber
  holographableContract: string
  gasLimit: BigNumber
  gasPrice: BigNumber
  bridgeOutPayload: string
}

export interface BridgeOutPayload {
  toChain: BigNumber
  sender: string
  payload: string
}

export interface BridgeOutErc20Args {
  from: string
  to: string
  amount: BigNumber
}

export interface BridgeOutErc721Args {
  from: string
  to: string
  tokenId: BigNumber
}

export const decodeBridgeOut = function (input: string): BridgeOutPayload {
  const decoded = web3.eth.abi.decodeParameters(
    [
      {
        internalType: 'uint32',
        name: 'toChain',
        type: 'uint32',
      },
      {
        internalType: 'address',
        name: 'sender',
        type: 'address',
      },
      {
        internalType: 'bytes',
        name: 'payload',
        type: 'bytes',
      },
    ],
    input,
  )
  return {
    toChain: decoded.toChain,
    sender: decoded.sender,
    payload: decoded.payload,
  } as BridgeOutPayload
}

export const decodeBridgeOutErc20Args = function (input: string): BridgeOutErc20Args {
  const decoded = web3.eth.abi.decodeParameters(
    [
      {
        internalType: 'address',
        name: 'from',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'to',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    input,
  )
  return {
    from: decoded.from,
    to: decoded.to,
    amount: decoded.amount,
  } as BridgeOutErc20Args
}

export const decodeBridgeOutErc721Args = function (input: string): BridgeOutErc721Args {
  const decoded = web3.eth.abi.decodeParameters(
    [
      {
        internalType: 'address',
        name: 'from',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'to',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'tokenId',
        type: 'uint256',
      },
    ],
    input,
  )
  return {
    from: decoded.from,
    to: decoded.to,
    tokenId: decoded.tokenId,
  } as BridgeOutErc721Args
}
