import * as fs from 'fs';

import Web3 from 'web3';
const WebsocketProvider = require('./WebSocketProvider');

import dotenv = require('dotenv');
import networks from './networks';
dotenv.config();

export default (async () => {
  const unorm = require('unorm');
  Object.defineProperty(String.prototype, 'normalize', {
    value: function (type: any) {
      type = type.toLowerCase();
      return unorm[type](this);
    },
  });
  Object.defineProperty(String.prototype, 'removeX', {
    value: function () {
      let v = this;
      v = v.toLowerCase().trim();
      if (v.startsWith('0x')) {
        v = v.substring(2);
      }
      return v;
    },
  });
  Object.defineProperty(String.prototype, 'hexify', {
    value: function (bytes: any) {
      let v = this;
      v = v.removeX();
      v = v.padStart(bytes * 2, '0');
      v = '0x' + v;
      return v;
    },
  });
  Object.defineProperty(Number.prototype, 'hexify', {
    value: function (bytes: any) {
      return this.toString(16).hexify(bytes);
    },
  });
  Object.defineProperty(String.prototype, 'capitalize', {
    value: function () {
      return this.charAt(0).toUpperCase() + this.slice(1);
    },
    enumerable: false,
  });

  const utf = 'utf8';

  let webSocketConfig = {
    reconnect: {
      auto: false,
      // delay: 7000, // ms
      onTimeout: false,
      // maxAttempts:
    },
    timeout: 1000 * 15, // 15 seconds
    clientConfig: {
      maxReceivedFrameSize: 10000000000,
      maxReceivedMessageSize: 10000000000,
      keepalive: true,
      keepaliveInterval: 1000, // ms
      dropConnectionOnKeepaliveTimeout: true,
      keepaliveGracePeriod: 4000, // ms
    },
  };

  let provider = {
    rinkeby: new WebsocketProvider(networks.eth_rinkeby.webSocket, webSocketConfig),
    mumbai: new WebsocketProvider(networks.mumbai.webSocket, webSocketConfig),
  };

  let web3 = {
    rinkeby: new Web3(provider.rinkeby),
    mumbai: new Web3(provider.mumbai),
  };

  let holographAddress = '0xD11a467dF6C80835A1223473aB9A48bF72eFCF4D'.toLowerCase();
  let rinkebyHolograph = new web3.rinkeby.eth.Contract(
    JSON.parse(fs.readFileSync('src/abi/Holograph.json', utf)),
    holographAddress
  );

  let bridgeAddress = (await rinkebyHolograph.methods.getBridge().call()).toLowerCase();
  let factoryAddress = (await rinkebyHolograph.methods.getFactory().call()).toLowerCase();
  let operatorAddress = (await rinkebyHolograph.methods.getOperator().call()).toLowerCase();

  const receivers = {
    rinkeby: '0x41836E93A3D92C116087af0C9424F4EF3DdB00a2'.toLowerCase(),
    mumbai: '0xb27c5c80eefe92591bf784dac95b7ac3db968e07'.toLowerCase(),
  };

  const targetEvents = {
    '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b': 'BridgeableContractDeployed',
    BridgeableContractDeployed: '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b',
    '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11': 'AvailableJob',
    AvailableJob: '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11',
  };

  return {
    networks,
    utf,
    provider,
    web3,
    bridgeAddress,
    factoryAddress,
    holographAddress,
    operatorAddress,
    receivers,
    targetEvents,
  };
})();
