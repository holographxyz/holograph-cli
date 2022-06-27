import * as fs from 'node:fs'

import Web3 from 'web3'
const WebsocketProvider = require('./WebSocketProvider')

import dotenv = require('dotenv')
import networks from './networks'
dotenv.config()

const unorm = require('unorm')

Object.defineProperty(String.prototype, 'normalize', {
  value: function (type: any) {
    type = type.toLowerCase()
    return unorm[type](this)
  },
})
Object.defineProperty(String.prototype, 'removeX', {
  value: function () {
    let v = this
    v = v.toLowerCase().trim()
    if (v.startsWith('0x')) {
      v = v.slice(2)
    }

    return v
  },
})
Object.defineProperty(String.prototype, 'hexify', {
  value: function (bytes: any) {
    let v = this
    v = v.removeX()
    v = v.padStart(bytes * 2, '0')
    v = '0x' + v
    return v
  },
})
Object.defineProperty(Number.prototype, 'hexify', {
  value: function (bytes: any) {
    return this.toString(16).hexify(bytes)
  },
})
Object.defineProperty(String.prototype, 'capitalize', {
  value: function () {
    return this.charAt(0).toUpperCase() + this.slice(1)
  },
  enumerable: false,
})

const utf = 'utf8'

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

const provider = {
  rinkeby: new WebsocketProvider(networks.eth_rinkeby.webSocket, webSocketConfig),
  mumbai: new WebsocketProvider(networks.mumbai.webSocket, webSocketConfig),
}

const web3Local: any = {
  rinkeby: new Web3(provider.rinkeby),
  mumbai: new Web3(provider.mumbai),
}

const holographAddress = '0xD11a467dF6C80835A1223473aB9A48bF72eFCF4D'.toLowerCase()
const rinkebyHolograph = new web3Local.rinkeby.eth.Contract(
  JSON.parse(fs.readFileSync('src/abi/Holograph.json', utf)),
  holographAddress,
)

const receivers: any = {
  rinkeby: '0x41836E93A3D92C116087af0C9424F4EF3DdB00a2'.toLowerCase(),
  mumbai: '0xb27c5c80eefe92591bf784dac95b7ac3db968e07'.toLowerCase(),
}

const targetEvents = {
  '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b': 'BridgeableContractDeployed',
  BridgeableContractDeployed: '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b',
  '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11': 'AvailableJob',
  AvailableJob: '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11',
}

const decodeDeploymentConfig = function (input: any) {
  const decodedConfig = web3Local.rinkeby.eth.abi.decodeParameters(
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

const decodeDeploymentConfigInput = function (input: any) {
  return decodeDeploymentConfig('0x' + input.slice(10))
}

export {
  networks,
  utf,
  provider,
  web3Local,
  holographAddress,
  rinkebyHolograph,
  receivers,
  targetEvents,
  decodeDeploymentConfig,
  decodeDeploymentConfigInput,
}
