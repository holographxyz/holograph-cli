import {CliUx, Command, Flags} from '@oclif/core'
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
    this.log('Loading user configurations...')
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    let { userWallet, configFile } = await ensureConfigFileIsValid(configPath, true)

    const {flags} = await this.parse(Collection)
    this.log('User configurations loaded.')

    let tx = flags.tx
    if (tx === undefined || tx === '') {
      this.debug('User did not provide tx via cli flag, need to create prompt to ask for it.')
      const prompt: any = await inquirer.prompt([
        {
          name: 'tx',
          message: 'Enter the hash of transaction that deployed the original collection',
          type: 'input',
          validate: async (input: string) => {
            return /^0x[\da-f]{64}$/i.test(input) ? true : 'Input is not a valid transaction hash';
          },
        },
      ])
      tx = prompt.tx
    }

    if (!/^0x[\da-f]{64}$/i.test(tx || '')) {
      throw new Error('Transaction hash is not a valid 32 byte hex string')
    }

    this.debug('we have a valid transaction hash at this point', 'tx', tx)

    CliUx.ux.action.start('Loading RPC providers')
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

    const sourceWallet = userWallet.connect(sourceProvider)
    this.debug('source network', await sourceWallet.provider.getNetwork())

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

    const destinationWallet = userWallet.connect(destinationProvider)
    this.debug('destination network', await destinationWallet.provider.getNetwork())
    userWallet = null
    CliUx.ux.action.stop()

    CliUx.ux.action.start('Retrieving transaction details from source chain')
    const transaction = await sourceWallet.provider.getTransaction(tx)

    const deploymentConfig = decodeDeploymentConfigInput(transaction.data)
    this.debug(deploymentConfig)
    CliUx.ux.action.stop()

    CliUx.ux.action.start('Retrieving HolographFactory contract')
    const holographABI = await fs.readJson('./src/abi/Holograph.json')
    const holograph = (new ethers.ContractFactory(holographABI, '0x', destinationWallet)).attach('0xD11a467dF6C80835A1223473aB9A48bF72eFCF4D'.toLowerCase())

    const holographFactoryABI = await fs.readJson('./src/abi/HolographFactory.json')
    const holographFactory = (new ethers.ContractFactory(holographFactoryABI, '0x', destinationWallet)).attach(await holograph.getFactory())
    CliUx.ux.action.stop()

//    const holographBridgeABI = await fs.readJson('./src/abi/HolographBridge.json')
//    const holographBridge = (new ethers.ContractFactory(holographBridgeABI, '0x', destinationWallet)).attach(await holograph.getBridge())
    CliUx.ux.action.stop()

    CliUx.ux.action.start('Calculating gas amounts and prices')
    let gasAmount
    try {
      gasAmount = await holographFactory.estimateGas.deployHolographableContract(deploymentConfig.config, deploymentConfig.signature, deploymentConfig.signer)
    } catch (error: any) {
      this.error(error.error.reason)
    }
    const gasPrice = await destinationWallet.provider.getGasPrice()
    CliUx.ux.action.stop()
    this.log('Transaction is estimated to cost a total of', ethers.utils.formatUnits(gasAmount.mul(gasPrice), 'ether'), 'native gas tokens (in ether)')

    const blockchainPrompt: any = await inquirer.prompt([
      {
        name: 'shouldContinue',
        message: 'Next steps submit the transaction, would you like to proceed?',
        type: 'confirm',
        default: true,
      },
    ])
    if (!blockchainPrompt.shouldContinue) {
      this.error('Dropping command, no blockchain transactions executed')
    }

    try {
      CliUx.ux.action.start('Sending transaction to mempool')
      const deployTx = await holographFactory.deployHolographableContract(deploymentConfig.config, deploymentConfig.signature, deploymentConfig.signer)
      this.debug(deployTx)
      CliUx.ux.action.stop('transaction hash is ' + deployTx.hash)

      CliUx.ux.action.start('Waiting for transaction to be mined and confirmed')
      const deployReceipt = await deployTx.wait()
      this.debug(deployReceipt)
      let collectionAddress
      for (let i = 0, l = deployReceipt.logs.length; i < l; i++) {
        const log = deployReceipt.logs [i]
        if (log.topics.length === 3 && log.topics[0] === '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b') {
          collectionAddress = '0x' + log.topics[1].slice(26)
          break
        }
      }

      CliUx.ux.action.stop('Collection deployed to ' + collectionAddress)
    } catch (error: any) {
      this.error(error.error.reason)
    }

    userWallet = null
    configFile = null

  }
}
