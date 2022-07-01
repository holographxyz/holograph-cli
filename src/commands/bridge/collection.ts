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
    if (tx === undefined || tx === '') {
      const prompt: any = await inquirer.prompt([
        {
          name: 'tx',
          message: 'Enter the hash of transaction that deployed the original collection',
          type: 'input',
          validate: async (input: string) => {
            console.clear()
            return /^0x[\da-f]{64}$/i.test(input) ? true : 'Input is not a valid transaction hash';
          },
        },
      ])
      tx = prompt.tx
    }

    this.debug('tx', tx)

    // connect a legit provider in
    const sourceProtocol = (new URL(configFile.network[configFile.network.from].providerUrl)).protocol
    let sourceProvider
    switch (sourceProtocol) {
      case 'https:':
        sourceProvider = new ethers.providers.JsonRpcProvider(configFile.network[configFile.network.from].providerUrl)
        break
      case 'ws:':
        sourceProvider = new ethers.providers.WebSocketProvider(configFile.network[configFile.network.from].providerUrl)
        break
      default:
        throw new Error('Unsupported RPC URL protocol -> ' + sourceProtocol)
    }

    const destinationProtocol = (new URL(configFile.network[configFile.network.to].providerUrl)).protocol
    let destinationProvider
    switch (destinationProtocol) {
      case 'https:':
        destinationProvider = new ethers.providers.JsonRpcProvider(configFile.network[configFile.network.to].providerUrl)
        break
      case 'ws:':
        destinationProvider = new ethers.providers.WebSocketProvider(configFile.network[configFile.network.to].providerUrl)
        break
      default:
        throw new Error('Unsupported RPC URL protocol -> ' + destinationProtocol)
    }

    userWallet = userWallet.connect(sourceProvider)

    this.debug('provider network', await userWallet.provider.getNetwork())

    const transaction = await userWallet.provider.getTransaction(tx)

    const deploymentConfig = decodeDeploymentConfigInput(transaction.data)
    this.debug(deploymentConfig)

    userWallet = userWallet.connect(destinationProvider)

    const holographABI = await fs.readJson('./src/abi/Holograph.json')
    const holograph = (new ethers.ContractFactory(holographABI, '0x', userWallet)).attach('0xD11a467dF6C80835A1223473aB9A48bF72eFCF4D'.toLowerCase())

    const holographFactoryABI = await fs.readJson('./src/abi/HolographFactory.json')
    const holographFactory = (new ethers.ContractFactory(holographFactoryABI, '0x', userWallet)).attach(await holograph.getFactory())

    const blockchainPrompt: any = await inquirer.prompt([
      {
        name: 'shouldContinue',
        message: 'Are you sure you want to execute a transaction on blockchain?',
        type: 'confirm',
        default: true,
      },
    ])
    if (!blockchainPrompt.shouldContinue) {
      this.error('Dropping command, no blockchain transactions executed')
    }

    const deployTx = await holographFactory.deployHolographableContract(deploymentConfig.config, deploymentConfig.signature, deploymentConfig.signer)
    this.debug(deployTx)
    const deployReceipt = await deployTx.wait()
    this.debug(deployReceipt)

    userWallet = null
    configFile = null

  }
}
