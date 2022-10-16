import {ethers} from 'ethers'
import * as inquirer from 'inquirer'
import {CliUx, Flags} from '@oclif/core'
import {ConfigFile, ConfigNetwork, ConfigNetworks} from './config'
import {validateTransactionHash, checkDeploymentTypeFlag} from './validation'
import {BigNumberish, BytesLike, BigNumber} from 'ethers'
import Web3 from 'web3'
const web3 = new Web3()

export enum DeploymentType {
  deployedTx = 'deployedTx',
  deploymentConfig = 'deploymentConfig',
  createConfig = 'createConfig',
}

export interface Signature {
  r: string
  s: string
  v: string
}

export const strictECDSA = function (signature: Signature): Signature {
  const validator: BigNumber = BigNumber.from('0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0')
  if (Number.parseInt(signature.v, 16) < 27) {
    signature.v = '0x' + (27).toString(16).padStart(2, '0')
  }

  if (BigNumber.from(signature.s).gt(validator)) {
    // we have an issue
    signature.s = BigNumber.from('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141')
      .sub(BigNumber.from(signature.s))
      .toHexString()
    let v = Number.parseInt(signature.v, 16)
    v = v === 27 ? 28 : 27
    signature.v = '0x' + v.toString(16).padStart(2, '0')
  }

  return signature
}

export const HolographERC20Event = [
  {name: 'bridgeIn', value: 1},
  {name: 'bridgeOut', value: 2},
  {name: 'afterApprove', value: 3},
  {name: 'beforeApprove', value: 4},
  {name: 'afterOnERC20Received', value: 5},
  {name: 'beforeOnERC20Received', value: 6},
  {name: 'afterBurn', value: 7},
  {name: 'beforeBurn', value: 8},
  {name: 'afterMint', value: 9},
  {name: 'beforeMint', value: 10},
  {name: 'afterSafeTransfer', value: 11},
  {name: 'beforeSafeTransfer', value: 12},
  {name: 'afterTransfer', value: 13},
  {name: 'beforeTransfer', value: 14},
]

export const HolographERC721Event = [
  {name: 'bridgeIn', value: 1},
  {name: 'bridgeOut', value: 2},
  {name: 'afterApprove', value: 3},
  {name: 'beforeApprove', value: 4},
  {name: 'afterApprovalAll', value: 5},
  {name: 'beforeApprovalAll', value: 6},
  {name: 'afterBurn', value: 7},
  {name: 'beforeBurn', value: 8},
  {name: 'afterMint', value: 9},
  {name: 'beforeMint', value: 10},
  {name: 'afterSafeTransfer', value: 11},
  {name: 'beforeSafeTransfer', value: 12},
  {name: 'afterTransfer', value: 13},
  {name: 'beforeTransfer', value: 14},
  {name: 'beforeOnERC721Received', value: 15},
  {name: 'afterOnERC721Received', value: 16},
]

export function allEventsEnabled(): string {
  return '0x' + 'ff'.repeat(32)
}

export function configureEvents(config: number[]): string {
  let binary: string = '0'.repeat(256)
  for (let i = 0, l = config.length; i < l; i++) {
    const num: number = config[i]
    binary = binary.replace(new RegExp('(.{' + num + '}).{1}(.*)', 'gi'), '$11$2')
  }

  binary = [...binary].reverse().join('')
  const byteArray: string[] = binary.match(/.{8}/g) || []
  let hex = '0x'
  for (let i = 0, l = byteArray.length; i < l; i++) {
    hex += Number.parseInt(byteArray[i], 2).toString(16).padStart(2, '0')
  }

  return hex
}

export const deploymentProcesses = [
  {
    name: 'Extract deployment configuration from existing transaction',
    value: DeploymentType.deployedTx,
    short: 'existing deployment',
  },
  {
    name: 'Use existing deployment configuration',
    value: DeploymentType.deploymentConfig,
    short: 'existing deployment config',
  },
  {
    name: 'Create deployment configuration',
    value: DeploymentType.createConfig,
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
    multiple: false,
    required: false,
  }),
  targetNetwork: Flags.string({
    description: 'The network on which the contract will be executed',
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

export const prepareDeploymentConfig = async function (
  configFile: ConfigFile,
  userWallet: ethers.Wallet,
  flags: Record<string, string | undefined>,
  supportedNetworks: string[],
): Promise<any> {
  const deploymentType: DeploymentType = await checkDeploymentTypeFlag(
    flags.deploymentType,
    'Select the type of deployment to use',
  )
  let tx: string = flags.tx || ''
  let txNetwork: string = flags.txNetwork || ''

  let deploymentConfig

  switch (deploymentType) {
    case DeploymentType.deployedTx: {
      if (txNetwork === '' || !supportedNetworks.includes(txNetwork)) {
        const txNetworkPrompt: any = await inquirer.prompt([
          {
            name: 'txNetwork',
            message: 'select the network to extract transaction details from',
            type: 'list',
            choices: supportedNetworks,
          },
        ])
        txNetwork = txNetworkPrompt.txNetwork
      }

      CliUx.ux.action.start('Loading transaction network RPC provider')
      const providerUrl: string = (configFile.networks[txNetwork as keyof ConfigNetworks] as ConfigNetwork).providerUrl
      const txNetworkProtocol = new URL(providerUrl).protocol
      let txNetworkProvider
      switch (txNetworkProtocol) {
        case 'https:':
          txNetworkProvider = new ethers.providers.JsonRpcProvider(providerUrl)
          break
        case 'wss:':
          txNetworkProvider = new ethers.providers.WebSocketProvider(providerUrl)
          break
        default:
          throw new Error('Unsupported RPC URL protocol -> ' + txNetworkProtocol)
      }

      const txNetworkWallet: ethers.Wallet = userWallet.connect(txNetworkProvider)
      CliUx.ux.action.stop()
      if (tx === '' || !/^0x[\da-f]{64}$/i.test(tx)) {
        const txPrompt: any = await inquirer.prompt([
          {
            name: 'tx',
            message: 'Enter the hash of transaction that deployed the contract',
            type: 'input',
            validate: async (input: string) => {
              return /^0x[\da-f]{64}$/i.test(input) ? true : 'Input is not a valid transaction hash'
            },
          },
        ])
        tx = txPrompt.tx
      }

      CliUx.ux.action.start('Retrieving transaction details from ' + txNetwork + ' network')
      const transaction = await txNetworkWallet.provider.getTransaction(tx)

      deploymentConfig = decodeDeploymentConfigInput(transaction.data)
      CliUx.ux.action.stop()

      break
    }

    default: {
      throw new Error('Unsupported deployment type: ' + DeploymentType[deploymentType])
    }
  }

  return deploymentConfig
}
