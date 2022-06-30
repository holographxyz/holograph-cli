import {Command, Flags} from '@oclif/core'
import * as inquirer from 'inquirer'
import * as fs from 'fs-extra'
import * as path from 'node:path'
import {ethers} from 'ethers'
import {CONFIG_FILE_NAME, ensureConfigFileIsValid} from '../../utils/config'
import {decodeDeploymentConfigInput} from '../../utils/utils'

export default class Collection extends Command {
  static description =
    'Bridge a Holographable collection from source chain to destination chain'

  static examples = [
    '$ holo bridge:collection 0x42703541786f900187dbf909de281b4fda7ef9256f0006d3c11d886e6e678845',
    '$ holo bridge:collection --tx="0x42703541786f900187dbf909de281b4fda7ef9256f0006d3c11d886e6e678845"',
  ]

  static flags = {
    tx: Flags.string({description: 'The hash of transaction that deployed the original collection'})
  }

  public async run(): Promise<void> {
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    let { userWallet, configFile } = await ensureConfigFileIsValid(configPath, true)

    const {flags} = await this.parse(Collection)

    let tx = flags.tx
    if (tx === undefined || tx == '') {
      const prompt: any = await inquirer.prompt([
        {
          name: 'tx',
          message: 'Enter the hash of transaction that deployed the original collection',
          type: 'input',
          validate: async (input: string) => {
            console.clear()
            return (new RegExp('^0x[0-9a-f]{64}$', 'i')).test(input) ? true : 'Input is not a valid transaction hash';
          },
        },
      ])
      tx = prompt.tx
    }

    this.debug('tx', tx)

    // connect a legit provider in
    let protocol = (new URL(configFile.network[configFile.network.from].providerUrl)).protocol
    let provider
    switch (protocol) {
      case 'https:':
        provider = new ethers.providers.JsonRpcProvider(configFile.network[configFile.network.from].providerUrl)
        break
      case 'ws:':
        new ethers.providers.WebSocketProvider(configFile.network[configFile.network.from].providerUrl)
        break
      default:
        throw new Error('Unsupported RPC URL protocol -> ' + protocol)
    }
    userWallet = userWallet.connect(provider)

    this.debug('provider network', await userWallet.provider.getNetwork())

    let transaction = await userWallet.provider.getTransaction(tx)

    this.debug(decodeDeploymentConfigInput(transaction.data))

  }
}
