import {Flags} from '@oclif/core'
import {supportedShortNetworks} from '@holographxyz/networks'

import {BigNumber, BigNumberish, BytesLike} from 'ethers'
import Web3 from 'web3'

import {bytecodes, BytecodeType} from './bytecodes'
import {remove0x, sha3} from './utils'
import {validateNetwork, validateNonEmptyString, validateTransactionHash} from './validation'

export const web3 = new Web3()

export enum DeploymentType {
  deployedTx = 'deployedTx',
  deploymentConfig = 'deploymentConfig',
  createConfig = 'createConfig',
}

export const deploymentProcesses = [
  {
    name: 'Extract deployment configuration from existing transaction',
    value: DeploymentType[DeploymentType.deployedTx],
    short: 'existing deployment',
  },
  {
    name: 'Use existing deployment configuration',
    value: DeploymentType[DeploymentType.deploymentConfig],
    short: 'existing deployment config',
  },
  {
    name: 'Create deployment configuration',
    value: DeploymentType[DeploymentType.createConfig],
    short: 'create deployment config',
  },
]

export const deploymentFlags = {
  tx: Flags.string({
    description: 'The hash of transaction that deployed the original contract',
    parse: validateTransactionHash,
    multiple: false,
    required: false,
  }),
  txNetwork: Flags.string({
    description: 'The network on which the transaction was executed',
    parse: validateNetwork,
    options: supportedShortNetworks,
    multiple: false,
    required: false,
  }),
  targetNetwork: Flags.string({
    description: 'The network on which the contract will be executed',
    parse: validateNetwork,
    options: supportedShortNetworks,
    multiple: false,
    required: false,
  }),
  deploymentType: Flags.string({
    description: 'The type of deployment to use',
    multiple: false,
    options: Object.values(DeploymentType),
    required: false,
  }),
  deploymentConfig: Flags.string({
    description: 'The config file to use',
    parse: validateNonEmptyString,
    multiple: false,
    required: false,
  }),
}

export interface DeploymentConfig {
  config: {
    contractType: string
    chainType: string
    salt: string
    byteCode: string
    initCode: string
  }
  signature: {
    r: string
    s: string
    v: number
  }
  signer: string
}

export type DeploymentConfigStruct = {
  contractType: BytesLike
  chainType: BigNumberish
  salt: BytesLike
  byteCode: BytesLike
  initCode: BytesLike
}

export const decodeDeploymentConfig = function (input: string): DeploymentConfig {
  const decodedConfig = web3.eth.abi.decodeParameters(
    [
      {
        components: [
          {
            internalType: 'bytes32',
            name: 'contractType',
            type: 'bytes32',
          },
          {
            internalType: 'uint32',
            name: 'chainType',
            type: 'uint32',
          },
          {
            internalType: 'bytes32',
            name: 'salt',
            type: 'bytes32',
          },
          {
            internalType: 'bytes',
            name: 'byteCode',
            type: 'bytes',
          },
          {
            internalType: 'bytes',
            name: 'initCode',
            type: 'bytes',
          },
        ],
        internalType: 'struct DeploymentConfig',
        name: 'config',
        type: 'tuple',
      },
      {
        components: [
          {
            internalType: 'bytes32',
            name: 'r',
            type: 'bytes32',
          },
          {
            internalType: 'bytes32',
            name: 's',
            type: 'bytes32',
          },
          {
            internalType: 'uint8',
            name: 'v',
            type: 'uint8',
          },
        ],
        internalType: 'struct Verification',
        name: 'signature',
        type: 'tuple',
      },
      {
        internalType: 'address',
        name: 'signer',
        type: 'address',
      },
    ],
    input,
  )
  return {
    config: {
      contractType: decodedConfig.config.contractType,
      chainType: decodedConfig.config.chainType,
      salt: decodedConfig.config.salt,
      byteCode: decodedConfig.config.byteCode,
      initCode: decodedConfig.config.initCode,
    },
    signature: {
      r: decodedConfig.signature.r,
      s: decodedConfig.signature.s,
      v: decodedConfig.signature.v,
    },
    signer: decodedConfig.signer,
  }
}

export const decodeDeploymentConfigInput = function (input: string): DeploymentConfig {
  return decodeDeploymentConfig('0x' + input.slice(10))
}

export const deploymentConfigHash = function (deploymentConfig: DeploymentConfig): string {
  const configHash: string = sha3(
    (
      '0x' +
      remove0x(BigNumber.from(deploymentConfig.config.contractType).toHexString()).padStart(64, '0') +
      remove0x(BigNumber.from(deploymentConfig.config.chainType).toHexString()).padStart(8, '0') +
      remove0x(BigNumber.from(deploymentConfig.config.salt).toHexString()).padStart(64, '0') +
      remove0x(sha3(deploymentConfig.config.byteCode)) +
      remove0x(sha3(deploymentConfig.config.initCode)) +
      remove0x(BigNumber.from(deploymentConfig.signer).toHexString()).padStart(40, '0')
    ).toLowerCase(),
  )
  return configHash
}

export const create2address = function (deploymentConfig: DeploymentConfig, factoryAddress: string): string {
  const configHash: string = deploymentConfigHash(deploymentConfig)
  const futureAddress: string =
    '0x' +
    sha3(
      '0xff' + remove0x(factoryAddress) + remove0x(configHash) + remove0x(sha3(bytecodes[BytecodeType.Holographer])),
    ).slice(26)
  return futureAddress
}
