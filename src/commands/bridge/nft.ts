import {CliUx, Command, Flags} from '@oclif/core'
import * as inquirer from 'inquirer'
import * as fs from 'fs-extra'
import * as path from 'node:path'
import {ethers} from 'ethers'
import {CONFIG_FILE_NAME, ensureConfigFileIsValid} from '../../utils/config'
import {deploymentFlags} from '../../utils/contract-deployment'
import {addressValidator, tokenValidator} from '../../utils/validation'

export default class Contract extends Command {
  static description = 'Bridge a Holographable NFT from source chain to destination chain'

  static examples = ['$ holo bridge:nft --address="0x1318d3420b0169522eB8F3EF0830aceE700A2eda" --tokenId=1']

  static flags = {
    sourceNetwork: Flags.string({description: 'The name of source network, from which to make the bridge request'}),
    destinationNetwork: Flags.string({
      description: 'The name of destination network, where the bridge request is sent to',
    }),
    address: Flags.string({description: 'The address of the contract on the source chain', required: true}),
    tokenId: Flags.string({description: 'The ID of the NFT on the source chain', required: true}),
    ...deploymentFlags,
  }

  public async run(): Promise<void> {
    this.log('Loading user configurations...')
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    const {userWallet, configFile} = await ensureConfigFileIsValid(configPath, true)

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

    const contractAddress: string = flags.address
    const tokenId: string = flags.tokenId

    // Validate the command inputs
    if (!addressValidator.test(contractAddress)) {
      throw new Error('Invalid contract address')
    }

    if (!tokenValidator.test(tokenId)) {
      this.error('Invalid token ID')
    }

    CliUx.ux.action.start('Loading RPC providers')
    const sourceProtocol = new URL(configFile.networks[sourceNetwork].providerUrl).protocol
    let sourceProvider
    switch (sourceProtocol) {
      case 'https:':
        sourceProvider = new ethers.providers.JsonRpcProvider(configFile.networks[sourceNetwork].providerUrl)
        break
      case 'wss:':
        sourceProvider = new ethers.providers.WebSocketProvider(configFile.networks[sourceNetwork].providerUrl)
        break
      default:
        throw new Error('Unsupported RPC URL protocol -> ' + sourceProtocol)
    }

    const sourceWallet = userWallet.connect(sourceProvider)
    this.debug('Source network', await sourceWallet.provider.getNetwork())

    const destinationProtocol = new URL(configFile.networks[destinationNetwork].providerUrl).protocol
    let destinationProvider
    switch (destinationProtocol) {
      case 'https:':
        destinationProvider = new ethers.providers.JsonRpcProvider(configFile.networks[destinationNetwork].providerUrl)
        break
      case 'wss:':
        destinationProvider = new ethers.providers.WebSocketProvider(
          configFile.networks[destinationNetwork].providerUrl,
        )
        break
      default:
        throw new Error('Unsupported RPC URL protocol -> ' + destinationProtocol)
    }

    const destinationWallet = userWallet.connect(destinationProvider)
    this.debug('Destination network', await destinationWallet.provider.getNetwork())
    CliUx.ux.action.stop()

    const allowedNetworks = ['rinkeby', 'mumbai']
    let remainingNetworks = allowedNetworks
    this.debug(`remainingNetworks = ${remainingNetworks}`)
    remainingNetworks = remainingNetworks.filter((item: string) => {
      return item !== destinationNetwork
    })

    CliUx.ux.action.stop()

    // Check if the contract is deployed on the source chain and not on the destination chain
    CliUx.ux.action.start('Checking if the contract is deployed on the source chain, and not on the destination chain')
    if ((await sourceProvider.getCode(contractAddress)) === '0x') {
      this.error(`Contract at ${contractAddress} does not exist on the source chain`)
    }

    if ((await destinationProvider.getCode(contractAddress)) !== '0x') {
      this.error(`Contract at ${contractAddress} already exists on the destination chain`)
    }

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

    const holographRegistryABI = await fs.readJson('./src/abi/HolographRegistry.json')
    const holographRegistry = new ethers.ContractFactory(holographRegistryABI, '0x', sourceWallet).attach(
      await holograph.getRegistry(),
    )

    // Check that the contract is Holographed
    if (holographRegistry.isHolographedContract(contractAddress) === false) {
      throw new Error('Contract is not a Holograph contract')
    } else {
      this.log('Holographed contract found')
    }

    // const holographErc721ABI = await fs.readJson('./src/abi/HolographERC721.json')
    // const holographErc721 = new ethers.ContractFactory(holographErc721ABI, '0x', sourceWallet).attach(
    //   await holograph.getBridge(),
    // )

    // TODO: Figure out why these checks are causing errors
    // Error: missing revert data in call exception; Transaction reverted without a reason string
    // Check that the NFT exists
    // if ((await holographErc721.exists(ethers.BigNumber.from(tokenId))) === false) {
    //   throw new Error('NFT does not exist')
    // }

    // if ((await holographErc721.ownerOf(ethers.BigNumber.from(tokenId))) !== userWallet.address) {
    //   throw new Error('Token is not owned by the user')
    // }

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
          gasAmount = await holographBridge.estimateGas.erc721out(
            holographToChainId,
            contractAddress,
            userWallet.address,
            userWallet.address,
            tokenId,
            {
              value: startingPayment,
            },
          )
        } catch (error: any) {
          if (error.reason !== lzFeeError) {
            throw new Error(error.message)
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
      const deployTx = await holographBridge.erc721out(
        holographToChainId,
        contractAddress,
        userWallet.address,
        userWallet.address,
        tokenId,
        {
          value: startingPayment,
        },
      )
      this.debug(deployTx)
      CliUx.ux.action.stop('transaction hash is ' + deployTx.hash)

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
