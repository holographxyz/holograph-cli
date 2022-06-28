import * as fs from 'node:fs'

import Web3 from 'web3'
<<<<<<< HEAD
const WebsocketProvider = require('./WebsocketProvider.js');
=======
import WebsocketProvider from 'web3-providers-ws'
>>>>>>> 4d021d71e66a2010779ffe2b98e84821bd880933

import dotenv = require('dotenv')
import networks from './networks'
dotenv.config()

// TODO: Not sure if we need these utility functions yet
// function remove0x(input: string) {
//   let output  = input.toLowerCase().trim()
//   if (output.startsWith('0x')) {
//     output = output.slice(2)
//   }
//   return output
// }

// function hexifyString(bytes: any) {
//   let output = remove0x(bytes)
//   bytes = bytes.padStart(bytes * 2, '0')
//   bytes = '0x' + bytes
//   return bytes
// }

// function  hexifyNumber(bytes: any) {
//   return bytes.toString(16).hexify(bytes)
// }

function capitalize(input: string) {
  return input.charAt(0).toUpperCase() + input.slice(1)
}

const webSocketConfig = {
  reconnect: {
    auto: false,
    // delay: 7000, // ms
    onTimeout: false,
    // maxAttempts:
  },
  timeout: 1000 * 15, // 15 seconds
  clientConfig: {
    maxReceivedFrameSize: 10_000_000_000,
    maxReceivedMessageSize: 10_000_000_000,
    keepalive: true,
    keepaliveInterval: 1000, // ms
    dropConnectionOnKeepaliveTimeout: true,
    keepaliveGracePeriod: 4000, // ms
  },
}

const providers: any = {
  rinkeby: new WebsocketProvider(networks.rinkeby.wss, webSocketConfig),
  mumbai: new WebsocketProvider(networks.mumbai.wss, webSocketConfig),
}

const web3: any = {
  rinkeby: new Web3(providers.rinkeby),
  mumbai: new Web3(providers.mumbai),
}

const HOLOGRAPH_ADDRESS = '0xD11a467dF6C80835A1223473aB9A48bF72eFCF4D'.toLowerCase()
const rinkebyHolograph = new web3.rinkeby.eth.Contract(
  JSON.parse(fs.readFileSync('src/abi/Holograph.json', 'utf8')),
  HOLOGRAPH_ADDRESS,
)

const LAYERZERO_RECEIVERS: any = {
  rinkeby: '0x41836E93A3D92C116087af0C9424F4EF3DdB00a2'.toLowerCase(),
  mumbai: '0xb27c5c80eefe92591bf784dac95b7ac3db968e07'.toLowerCase(),
}

const targetEvents = {
  '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b': 'BridgeableContractDeployed',
  BridgeableContractDeployed: '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b',
  '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11': 'AvailableJob',
  AvailableJob: '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11',
}

const decodeDeploymentConfig = function (input: any): any {
  const decodedConfig = web3.rinkeby.eth.abi.decodeParameters(
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

const decodeDeploymentConfigInput = function (input: string): string {
  return decodeDeploymentConfig('0x' + input.slice(10))
}

export {
  HOLOGRAPH_ADDRESS,
  LAYERZERO_RECEIVERS,
  capitalize,
  networks,
  providers,
  web3,
  rinkebyHolograph,
  targetEvents,
  decodeDeploymentConfig,
  decodeDeploymentConfigInput,
}
