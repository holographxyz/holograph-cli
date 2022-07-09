import Web3 from 'web3'

// Used for web3 utility functions
const web3 = new Web3('ws://localhost:8545')

function randomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min
}

function capitalize(input: string): string {
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

export interface DeploymentConfig {
  config: {
    contractType: string;
    chainType: number;
    salt: string;
    byteCode: string;
    initCode: string;
  };
  signature: {
    r: string;
    s: string;
    v: number;
  };
  signer: string;
}

const decodeDeploymentConfig = function (input: string): DeploymentConfig {
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

const decodeDeploymentConfigInput = function (input: string): any {
  return decodeDeploymentConfig('0x' + input.slice(10))
}

export {capitalize, randomNumber, decodeDeploymentConfig, decodeDeploymentConfigInput, webSocketConfig}
