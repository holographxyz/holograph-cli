import { readFile, writeFile } from 'fs/promises';

import { Command, Flags } from '@oclif/core';

import {
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
} from '../../utils/utils';

export default class Listener extends Command {
  static description = 'Listen for evm events';

  // TODO: Decide on flags
  // static flags = {
  //   from: Flags.string({ char: 'd', description: '', required: false }),
  // };

  // static args = [{ name: 'person', description: 'Person to say hello to', required: true }];

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Listener);
    let bridgeAddress = (await rinkebyHolograph.methods.getBridge().call()).toLowerCase();
    let factoryAddress = (await rinkebyHolograph.methods.getFactory().call()).toLowerCase();
    let operatorAddress = (await rinkebyHolograph.methods.getOperator().call()).toLowerCase();

    console.log(`Starting listener...`);
    console.log(`Bridge address: ${bridgeAddress}`);
    console.log(`Factory address: ${factoryAddress}`);
    console.log(`Operator address: ${operatorAddress}`);

    const processTransactions = function (network: string, transactions: any, callback: any) {
      let getReceipt = function () {
        if (transactions.length > 0) {
          let transaction = transactions.shift();
          web3Local[network].eth.getTransactionReceipt(transaction.hash).then((receipt: any) => {
            if (receipt == null) {
              throw new Error('could not get receipt for ' + transaction.hash);
            }
            if (transaction.to.toLowerCase() == factoryAddress) {
              let config = decodeDeploymentConfigInput(transaction.input);
              let event = null;
              if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs != null) {
                for (let i = 0, l = receipt.logs.length; i < l; i++) {
                  let log = receipt.logs[i];
                  if (log.topics.length > 0 && log.topics[0] == targetEvents.BridgeableContractDeployed) {
                    event = log.topics;
                    break;
                  }
                }
              }
              if (event != null) {
                let deploymentAddress = '0x' + event[1].substring(26);
                console.log(
                  'HolographFactory deployed a new collection on',
                  // @ts-expect-error
                  network.capitalize(),
                  'at address',
                  deploymentAddress,
                  '\n' + 'Wallet that deployed the collection is',
                  transaction.from,
                  '\n' + 'The config used for deployHolographableContract function was',
                  config,
                  '\n'
                );
              } else {
                console.log('Failed with BridgeableContractDeployed event parsing', transaction, receipt);
                throw new Error('Failed with BridgeableContractDeployed event parsing');
              }
            } else if (transaction.to.toLowerCase() == operatorAddress) {
              let event = null;
              if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs != null) {
                for (let i = 0, l = receipt.logs.length; i < l; i++) {
                  let log = receipt.logs[i];
                  if (log.topics.length > 0 && log.topics[0] == targetEvents.BridgeableContractDeployed) {
                    event = log.topics;
                    break;
                  }
                }
              }
              if (event != null) {
                let deploymentInput = web3Local[network].eth.abi.decodeParameter(
                  'bytes',
                  '0x' + transaction.input.substring(10)
                );
                let config = decodeDeploymentConfig(
                  web3Local[network].eth.abi.decodeParameter('bytes', '0x' + deploymentInput.substring(10))
                );
                let deploymentAddress = '0x' + event[1].substring(26);
                console.log(
                  'HolographOperator executed a job which bridged a collection',
                  '\n' + 'HolographFactory deployed a new collection on',
                  // @ts-expect-error
                  network.capitalize(),
                  'at address',
                  deploymentAddress,
                  '\n' + 'Operator that deployed the collection is',
                  transaction.from,
                  '\n' + 'The config used for deployHolographableContract function was',
                  config,
                  '\n'
                );
              } else {
                console.log('Failed to find BridgeableContractDeployed event from operator job');
              }
            } else {
              let event = null;
              if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs != null) {
                for (let i = 0, l = receipt.logs.length; i < l; i++) {
                  let log = receipt.logs[i];
                  if (
                    log.address.toLowerCase() == operatorAddress &&
                    log.topics.length > 0 &&
                    log.topics[0] == targetEvents.AvailableJob
                  ) {
                    event = log.data;
                    break;
                  }
                }
              }
              if (event != null) {
                let payload = web3Local[network].eth.abi.decodeParameter('bytes', event);
                console.log(
                  'HolographOperator received a new bridge job on',
                  // @ts-expect-error
                  network.capitalize(),
                  '\n' + 'The job payload is',
                  { payload: payload },
                  '\n'
                );
              } else {
                console.log('LayerZero transaction is not relevant to AvailableJob event');
              }
            }
            getReceipt();
          });
        } else {
          callback();
        }
      };
      getReceipt();
    };

    process.exit(0);
  }
}
