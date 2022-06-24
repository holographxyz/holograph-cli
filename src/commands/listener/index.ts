import { readFile, writeFile } from 'fs/promises';

import { Command, Flags } from '@oclif/core';

import {
  networks,
  utf,
  provider,
  web3,
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

    process.exit(0);
  }
}
