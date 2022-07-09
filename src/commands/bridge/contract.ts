import {CliUx, Command, Flags} from '@oclif/core'
import * as inquirer from 'inquirer'
import * as fs from 'fs-extra'
import * as path from 'node:path'
import {ethers} from 'ethers'
import {CONFIG_FILE_NAME, ensureConfigFileIsValid} from '../../utils/config'
import {ConfigNetwork, ConfigNetworks} from '../../utils/config'
import {deploymentFlags, prepareDeploymentConfig} from '../../utils/contract-deployment'

export default class Contract extends Command {
  static description = 'Bridge a Holographable contract from source chain to destination chain'

  static examples = ['$ holo bridge:contract --tx="0x42703541786f900187dbf909de281b4fda7ef9256f0006d3c11d886e6e678845"']

  static flags = {
    sourceNetwork: Flags.string({description: 'The name of source network, from which to make the bridge request'}),
    destinationNetwork: Flags.string({
      description: 'The name of destination network, where the bridge request is sent to',
    }),
    ...deploymentFlags,
  }

  public async run(): Promise<void> {
    this.log('Loading user configurations...')
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    const {userWallet, configFile} = await ensureConfigFileIsValid(configPath, true)

    if (userWallet === undefined) {
      throw new Error('Wallet could not be unlocked')
    }

    const {flags} = await this.parse(Contract)
    this.log('User configurations loaded.')

    let sourceNetwork: string = flags.sourceNetwork || ''
    if (sourceNetwork === '' || !(sourceNetwork in configFile.networks)) {
      this.log(
        'Source network not provided, or does not exist in the config file',
        'Reverting to default "from" network from config',
      )
      sourceNetwork = configFile.networks.from
    }

    let destinationNetwork: string = flags.destinationNetwork || ''
    if (destinationNetwork === '' || !(destinationNetwork in configFile.networks)) {
      this.log(
        'Destination network not provided, or does not exist in the config file',
        'reverting to default "to" network from config',
      )
      destinationNetwork = configFile.networks.to
    }

    if (sourceNetwork === destinationNetwork) {
      throw new Error('Cannot bridge to/from the same network')
    }

    CliUx.ux.action.start('Loading RPC providers')
    const sourceProviderUrl: string = (configFile.networks[sourceNetwork as keyof ConfigNetworks] as ConfigNetwork).providerUrl
    const sourceProtocol: string = new URL(sourceProviderUrl).protocol
    let sourceProvider
    switch (sourceProtocol) {
      case 'https:':
        sourceProvider = new ethers.providers.JsonRpcProvider(sourceProviderUrl)
        break
      case 'wss:':
        sourceProvider = new ethers.providers.WebSocketProvider(sourceProviderUrl)
        break
      default:
        throw new Error('Unsupported RPC URL protocol -> ' + sourceProtocol)
    }

    const sourceWallet = userWallet.connect(sourceProvider)
    this.debug('Source network', await sourceWallet.provider.getNetwork())

    const destinationProviderUrl: string = (configFile.networks[destinationNetwork as keyof ConfigNetworks] as ConfigNetwork).providerUrl
    const destinationProtocol: string = new URL(destinationProviderUrl).protocol
    let destinationProvider
    switch (destinationProtocol) {
      case 'https:':
        destinationProvider = new ethers.providers.JsonRpcProvider(destinationProviderUrl)
        break
      case 'wss:':
        destinationProvider = new ethers.providers.WebSocketProvider(destinationProviderUrl)
        break
      default:
        throw new Error('Unsupported RPC URL protocol -> ' + destinationProtocol)
    }

    const destinationWallet = userWallet.connect(destinationProvider)
    this.debug('Destination network', await destinationWallet.provider.getNetwork())
    CliUx.ux.action.stop()

    const allowedNetworks: string[] = ['rinkeby', 'mumbai']
    let remainingNetworks: string[] = allowedNetworks
    this.debug(`remainingNetworks = ${remainingNetworks}`)
    remainingNetworks = remainingNetworks.filter((item: string) => {
      return item !== destinationNetwork
    })

    const deploymentConfig = await prepareDeploymentConfig(configFile, userWallet, flags as Record<string, string | undefined>, remainingNetworks)

    this.debug(deploymentConfig)
    CliUx.ux.action.stop()

    CliUx.ux.action.start('Retrieving HolographFactory contract')
    const holographABI = await fs.readJson('./src/abi/Holograph.json')
    const holograph = new ethers.ContractFactory(holographABI, '0x', sourceWallet).attach(
      '0xD11a467dF6C80835A1223473aB9A48bF72eFCF4D'.toLowerCase(),
    )

    const holographInterfacesABI = await fs.readJson('./src/abi/Interfaces.json')
    const holographInterfaces = new ethers.ContractFactory(holographInterfacesABI, '0x', sourceWallet).attach(
      await holograph.getInterfaces(),
    )

    const holographToChainId = await holographInterfaces.getChainId(
      1,
      (
        await destinationProvider.getNetwork()
      ).chainId,
      2,
    )
    const holographBridgeABI = await fs.readJson('./src/abi/HolographBridge.json')
    const holographBridge = new ethers.ContractFactory(holographBridgeABI, '0x', sourceWallet).attach(
      await holograph.getBridge(),
    )
    CliUx.ux.action.stop()

    CliUx.ux.action.start('Calculating gas amounts and prices')
    let gasAmount: ethers.BigNumber | undefined

    // Don't modify lzFeeError. It is returned from LZ so we must check this exact string
    const lzFeeError = 'execution reverted: LayerZero: not enough native for fees'
    let startingPayment = ethers.utils.parseUnits('0.000000001', 'ether')
    const powerOfTen = ethers.BigNumber.from(10)
    const calculateGas = async function () {
      if (gasAmount === undefined) {
        try {
          gasAmount = await holographBridge.estimateGas.deployOut(
            holographToChainId,
            deploymentConfig.config,
            deploymentConfig.signature,
            deploymentConfig.signer,
            {
              value: startingPayment,
            },
          )
        } catch (error: any) {
          if (error.reason !== lzFeeError) {
            throw new Error(error.reason)
          }
        }

        startingPayment = startingPayment.mul(powerOfTen)
        await calculateGas()
      }
    }

    try {
      await calculateGas()
    } catch (error: any) {
      this.error(error)
    }

    if (gasAmount === undefined) {
      this.error('Could not identify messaging costs')
    }

    const gasPrice = await sourceWallet.provider.getGasPrice()
    CliUx.ux.action.stop()
    this.log(
      'Transaction is estimated to cost a total of',
      ethers.utils.formatUnits(gasAmount.mul(gasPrice), 'ether'),
      'native gas tokens (in ether).',
      'And you will send a value of',
      ethers.utils.formatEther(startingPayment),
      'native gas tokens (in ether) for messaging protocol',
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
      const deployTx = await holographBridge.deployOut(
        holographToChainId,
        deploymentConfig.config,
        deploymentConfig.signature,
        deploymentConfig.signer,
        {
          value: startingPayment,
        },
      )
      this.debug(deployTx)
      CliUx.ux.action.stop('Transaction hash is ' + deployTx.hash)

      CliUx.ux.action.start('Waiting for transaction to be mined and confirmed')
      const deployReceipt = await deployTx.wait()
      this.debug(deployReceipt)

      CliUx.ux.action.stop()
      this.log('Transaction', deployTx.hash, 'confirmed')
    } catch (error: any) {
      this.error(error.error.reason)
    }

    this.exit()
  }
}
