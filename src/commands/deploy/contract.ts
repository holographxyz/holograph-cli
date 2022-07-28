import {CliUx, Command} from '@oclif/core'
import * as inquirer from 'inquirer'
import * as fs from 'fs-extra'
import * as path from 'node:path'
import {ethers} from 'ethers'
import {CONFIG_FILE_NAME, ensureConfigFileIsValid} from '../../utils/config'
import {ConfigNetwork, ConfigNetworks} from '../../utils/config'
import {deploymentFlags, prepareDeploymentConfig} from '../../utils/contract-deployment'

export default class Contract extends Command {
  static description = 'Deploy a Holographable contract'

  static examples = ['$ holo deploy:contract --tx="0x42703541786f900187dbf909de281b4fda7ef9256f0006d3c11d886e6e678845"']

  static flags = {
    ...deploymentFlags,
  }

  public async run(): Promise<void> {
    this.log('Loading user configurations...')
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    const {userWallet, configFile} = await ensureConfigFileIsValid(configPath, undefined, true)

    if (userWallet === undefined) {
      throw new Error('Wallet could not be unlocked')
    }

    const {flags} = await this.parse(Contract)
    this.log('User configurations loaded.')

    const supportedNetworks = ['rinkeby', 'mumbai', 'fuji']
    let remainingNetworks = supportedNetworks
    this.debug(`remainingNetworks = ${remainingNetworks}`)

    const destinationNetworkPrompt: any = await inquirer.prompt([
      {
        name: 'destinationNetwork',
        message: 'select the network to which the contract will be deployed',
        type: 'list',
        choices: remainingNetworks,
      },
    ])
    const destinationNetwork = destinationNetworkPrompt.destinationNetwork

    remainingNetworks = remainingNetworks.filter((item: string) => {
      return item !== destinationNetwork
    })

    CliUx.ux.action.start('Loading destination network RPC provider')
    const destinationProviderUrl: string = (
      configFile.networks[destinationNetwork as keyof ConfigNetworks] as ConfigNetwork
    ).providerUrl
    const destinationNetworkProtocol: string = new URL(destinationProviderUrl).protocol
    let destinationNetworkProvider
    switch (destinationNetworkProtocol) {
      case 'https:':
        destinationNetworkProvider = new ethers.providers.JsonRpcProvider(destinationProviderUrl)
        break
      case 'wss:':
        destinationNetworkProvider = new ethers.providers.WebSocketProvider(destinationProviderUrl)
        break
      default:
        throw new Error('Unsupported RPC URL protocol -> ' + destinationNetworkProtocol)
    }

    const destinationWallet = userWallet.connect(destinationNetworkProvider)
    CliUx.ux.action.stop()

    const deploymentConfig = await prepareDeploymentConfig(
      configFile,
      userWallet,
      flags as Record<string, string | undefined>,
      remainingNetworks,
    )
    this.debug(deploymentConfig)

    CliUx.ux.action.start('Retrieving HolographFactory contract')
    const holographABI = await fs.readJson('./src/abi/Holograph.json')
    const holograph = new ethers.ContractFactory(holographABI, '0x', destinationWallet).attach(
      '0xD11a467dF6C80835A1223473aB9A48bF72eFCF4D'.toLowerCase(),
    )

    const holographFactoryABI = await fs.readJson('./src/abi/HolographFactory.json')
    const holographFactory = new ethers.ContractFactory(holographFactoryABI, '0x', destinationWallet).attach(
      await holograph.getFactory(),
    )
    CliUx.ux.action.stop()

    CliUx.ux.action.start('Calculating gas amounts and prices')
    let gasLimit
    try {
      gasLimit = await holographFactory.estimateGas.deployHolographableContract(
        deploymentConfig.config,
        deploymentConfig.signature,
        deploymentConfig.signer,
      )
    } catch (error: any) {
      this.error(error.reason)
    }

    const gasPrice = await destinationWallet.provider.getGasPrice()
    CliUx.ux.action.stop()
    this.log(
      'Transaction is estimated to cost a total of',
      ethers.utils.formatUnits(gasLimit.mul(gasPrice), 'ether'),
      'native gas tokens (in ether)',
    )

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
      const deployTx = await holographFactory.deployHolographableContract(
        deploymentConfig.config,
        deploymentConfig.signature,
        deploymentConfig.signer,
        { gasPrice, gasLimit })
      this.debug(deployTx)
      CliUx.ux.action.stop('Transaction hash is ' + deployTx.hash)

      CliUx.ux.action.start('Waiting for transaction to be mined and confirmed')
      const deployReceipt = await deployTx.wait()
      this.debug(deployReceipt)
      let collectionAddress
      for (let i = 0, l = deployReceipt.logs.length; i < l; i++) {
        const log = deployReceipt.logs[i]
        if (
          log.topics.length === 3 &&
          log.topics[0] === '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b'
        ) {
          collectionAddress = '0x' + log.topics[1].slice(26)
          break
        }
      }

      CliUx.ux.action.stop('Collection deployed to ' + collectionAddress)
    } catch (error: any) {
      this.error(error.error.reason)
    }

    this.exit()
  }
}
