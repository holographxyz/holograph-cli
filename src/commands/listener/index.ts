import { readFile, writeFile } from 'fs/promises';

import { Command, Flags } from '@oclif/core';

import '../../utils/utils';
import utils from '../../utils/utils';

export default class Listener extends Command {
  static description = 'Listen for evm events';

  // TODO: Decide on flags
  // static flags = {
  //   from: Flags.string({ char: 'd', description: '', required: false }),
  // };

  // static args = [{ name: 'person', description: 'Person to say hello to', required: true }];

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Listener);
    const u = await utils;

    console.log(u.bridgeAddress);
  }
}
