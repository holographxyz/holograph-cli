import Web3 from 'web3'

import networks from './networks'

// Used for web3 utility functions
const web3 = new Web3('ws://localhost:8545')

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

const decodeDeploymentConfig = function (input: any): any {
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

const decodeDeploymentConfigInput = function (input: string): string {
  return decodeDeploymentConfig('0x' + input.slice(10))
}

export {capitalize, networks, decodeDeploymentConfig, decodeDeploymentConfigInput, webSocketConfig}
