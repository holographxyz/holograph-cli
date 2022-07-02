import {CliUx, Command, Flags} from '@oclif/core'
import * as inquirer from 'inquirer'
import * as fs from 'fs-extra'
import * as path from 'node:path'
import {ethers} from 'ethers'
import {CONFIG_FILE_NAME, ensureConfigFileIsValid} from '../../utils/config'
import {decodeDeploymentConfigInput} from '../../utils/utils'

export default class Contract extends Command {
  static description = 'Deploy a Holographable contract'

  static examples = [
    '$ holo deploy:contract --tx="0x42703541786f900187dbf909de281b4fda7ef9256f0006d3c11d886e6e678845"',
  ]

  static flags = {
    deploymentType: Flags.string({description: 'The type of deployment to use: [deployedTx, deploymentConfig]'}),
  }

  public async run(): Promise<void> {
    this.log('Loading user configurations...')
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    let {userWallet, configFile} = await ensureConfigFileIsValid(configPath, true)

    const {flags} = await this.parse(Contract)
    this.log('User configurations loaded.')

    let deploymentType = flags.deploymentType

    const allowedNetworks = ['rinkeby', 'mumbai']

    const deployProcess = [
      {
        name: 'extract deployment config from existing transaction',
        value: 'deployedTx',
        short: 'existing deployment'
      },
      {
        name: 'load custom deployment configuration',
        value: 'deploymentConfig',
        short: 'custom deployment'
      }
    ]

    if (deploymentType === undefined) {
      const prompt: any = await inquirer.prompt([
        {
          name: 'deploymentType',
          message: 'Select the contract deployment process to use',
          type: 'list',
          choices: deployProcess,
        },
      ])
      deploymentType = prompt.deploymentType
    }

    let remainingNetworks = allowedNetworks
    this.debug(`remainingNetworks = ${remainingNetworks}`)

    const destinationChainPrompt: any = await inquirer.prompt([
      {
        name: 'destinationNetwork',
        message: 'select the network where where the contract will be deployed to',
        type: 'list',
        choices: remainingNetworks,
      },
    ])
    const destinationChain = destinationChainPrompt.destinationNetwork

    CliUx.ux.action.start('Loading destination network RPC provider')
    const destinationChainProtocol = new URL(configFile.networks[destinationChain].providerUrl).protocol
    let destinationChainProvider
    switch (destinationChainProtocol) {
      case 'https:':
        destinationChainProvider = new ethers.providers.JsonRpcProvider(configFile.networks[destinationChain].providerUrl)
        break
      case 'wss:':
        destinationChainProvider = new ethers.providers.WebSocketProvider(configFile.networks[destinationChain].providerUrl)
        break
      default:
        throw new Error('Unsupported RPC URL protocol -> ' + destinationChainProtocol)
    }

    const destinationWallet = userWallet.connect(destinationChainProvider)
    CliUx.ux.action.stop()

    remainingNetworks = remainingNetworks.filter((item: string) => {
      return item !== destinationChain
    })

    let deploymentConfig

    switch (deploymentType) {
      case 'deployedTx': {
        const txChainPrompt: any = await inquirer.prompt([
          {
            name: 'txChain',
            message: 'select the network to extract transaction details from',
            type: 'list',
            choices: remainingNetworks,
          },
        ])
        const txChain = txChainPrompt.txChain
        CliUx.ux.action.start('Loading transaction network RPC provider')
        const txChainProtocol = new URL(configFile.networks[txChain].providerUrl).protocol
        let txChainProvider
        switch (txChainProtocol) {
          case 'https:':
            txChainProvider = new ethers.providers.JsonRpcProvider(configFile.networks[txChain].providerUrl)
            break
          case 'wss:':
            txChainProvider = new ethers.providers.WebSocketProvider(configFile.networks[txChain].providerUrl)
            break
          default:
            throw new Error('Unsupported RPC URL protocol -> ' + txChainProtocol)
        }

        const txChainWallet = userWallet.connect(txChainProvider)
        CliUx.ux.action.stop()
        const txPrompt: any = await inquirer.prompt([
          {
            name: 'tx',
            message: 'Enter the hash of transaction that deployed the contract',
            type: 'input',
            validate: async (input: string) => {
              return /^0x[\da-f]{64}$/i.test(input) ? true : 'Input is not a valid transaction hash'
            },
          },
        ])
        const tx = txPrompt.tx

        CliUx.ux.action.start('Retrieving transaction details from ' + txChain + ' network')
        const transaction = await txChainWallet.provider.getTransaction(tx)

        deploymentConfig = decodeDeploymentConfigInput(transaction.data)
        this.debug(deploymentConfig)
        CliUx.ux.action.stop()
        //
        break
      }

      case 'deploymentConfig': {
        throw new Error('Unsupported deployment type: ' + deploymentType + '... Still working on this one :(')
        break
      }

      default: {
        throw new Error('Unsupported deployment type: ' + deploymentType)
      }
    }

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
    let gasAmount
    try {
      gasAmount = await holographFactory.estimateGas.deployHolographableContract(
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
      ethers.utils.formatUnits(gasAmount.mul(gasPrice), 'ether'),
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
      )
      this.debug(deployTx)
      CliUx.ux.action.stop('transaction hash is ' + deployTx.hash)

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

    userWallet = null
    configFile = null

  }
}
