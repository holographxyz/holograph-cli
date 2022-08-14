import {CliUx, Command, Flags} from '@oclif/core'
import * as inquirer from 'inquirer'
import * as fs from 'fs-extra'
import {ethers} from 'ethers'
import {ensureConfigFileIsValid} from '../../utils/config'
import {ConfigFile, ConfigNetwork, ConfigNetworks} from '../../utils/config'
import {addressValidator, tokenValidator} from '../../utils/validation'

export default class Contract extends Command {
  static description = 'Bridge a Holographable NFT from source chain to destination chain'

  static examples = ['$ holo bridge:nft --address="0x1318d3420b0169522eB8F3EF0830aceE700A2eda" --tokenId=1']

  static flags = {
    sourceNetwork: Flags.string({description: 'The name of source network, from which to make the bridge request'}),
    destinationNetwork: Flags.string({
      description: 'The name of destination network, where the bridge request is sent to',
    }),
    address: Flags.string({description: 'The address of the contract on the source chain'}),
    tokenId: Flags.string({description: 'The ID of the NFT on the source chain (number or 32-byte hex string)'}),
  }

  collectionAddress = ''
  tokenId = ''
  sourceNetwork = ''
  destinationNetwork = ''

  async validateCollectionAddress(): Promise<void> {
    if (this.collectionAddress === '') {
      const prompt: any = await inquirer.prompt([
        {
          name: 'collectionAddress',
          message: 'Enter the contract address of the collection on the source chain',
          type: 'string',
          validate: async (input: string) => {
            return addressValidator.test(input) ? true : 'Input is not a valid contract address'
          },
        },
      ])
      this.collectionAddress = prompt.collectionAddress
    }

    if (!addressValidator.test(this.collectionAddress)) {
      throw new Error(`Invalid collection address: ${this.collectionAddress}`)
    }
  }

  async validateTokenId(): Promise<void> {
    if (this.tokenId === '') {
      const prompt: any = await inquirer.prompt([
        {
          name: 'tokenId',
          message: 'Select the token ID to bridge',
          type: 'string',
          validate: async (input: string) => {
            return tokenValidator.test(input) ? true : 'Input is neither a valid number or 32-byte hex string'
          },
        },
      ])
      this.tokenId = prompt.tokenId
    }

    if (!tokenValidator.test(this.tokenId)) {
      this.error('Invalid token ID')
    }
  }

  async validateSourceNetwork(configFile: ConfigFile): Promise<void> {
    if (this.sourceNetwork === '' || !(this.sourceNetwork in configFile.bridge)) {
      this.log(
        'Source network not provided, or does not exist in the config file',
        'Reverting to default "from" network from config',
      )
      this.sourceNetwork = configFile.bridge.source
    }
  }

  async validateDestinationNetwork(configFile: ConfigFile): Promise<void> {
    if (this.destinationNetwork === '' || !(this.destinationNetwork in configFile.networks)) {
      this.log(
        'Destination network not provided, or does not exist in the config file',
        'Reverting to default "from" network from config',
      )
      this.destinationNetwork = configFile.bridge.destination
    }
  }

  async checkContractCode(chainName: string, provider: ethers.providers.Provider, checkAddress: string): Promise<void> {
    if ((await provider.getCode(checkAddress)) === '0x') {
      this.error(`Contract at ${checkAddress} does not exist on the ${chainName} chain`)
    }
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Contract)

    // Have the user input the contract address and token ID if they don't provide flags
    this.collectionAddress = flags.address || ''
    this.tokenId = flags.tokenId || ''

    await this.validateCollectionAddress()
    await this.validateTokenId()

    this.log('Loading user configurations...')
    const {userWallet, configFile} = await ensureConfigFileIsValid(this.config.configDir, undefined, true)
    this.log('User configurations loaded.')

    this.sourceNetwork = flags.sourceNetwork || ''
    await this.validateSourceNetwork(configFile)
    this.destinationNetwork = flags.destinationNetwork || ''
    await this.validateDestinationNetwork(configFile)

    if (this.sourceNetwork === this.destinationNetwork) {
      throw new Error('Cannot bridge to/from the same network')
    }

    CliUx.ux.action.start('Loading RPC providers')
    const sourceProviderUrl: string = (configFile.networks[this.sourceNetwork as keyof ConfigNetworks] as ConfigNetwork)
      .providerUrl
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

    const sourceWallet: ethers.Wallet = userWallet.connect(sourceProvider)
    this.debug('Source network', await sourceWallet.provider.getNetwork())

    const destinationProviderUrl: string = (
      configFile.networks[this.destinationNetwork as keyof ConfigNetworks] as ConfigNetwork
    ).providerUrl
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

    const destinationWallet: ethers.Wallet = userWallet.connect(destinationProvider)
    CliUx.ux.action.stop()
    this.debug('Destination network', await destinationWallet.provider.getNetwork())

    const supportedNetworks = ['rinkeby', 'mumbai', 'fuji']
    let remainingNetworks = supportedNetworks
    this.debug(`remainingNetworks = ${remainingNetworks}`)
    remainingNetworks = remainingNetworks.filter((item: string) => {
      return item !== this.destinationNetwork
    })

    // Check if the contract is deployed on the source chain and not on the destination chain
    CliUx.ux.action.start('Checking if the contract is deployed on both source and destination chains')
    await this.checkContractCode('source', sourceProvider, this.collectionAddress)
    await this.checkContractCode('destination', destinationProvider, this.collectionAddress)
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
    if (holographRegistry.isHolographedContract(this.collectionAddress) === false) {
      throw new Error('Contract is not a Holograph contract')
    } else {
      this.log('Holographed contract found 👍')
    }

    const holographErc721ABI = await fs.readJson('./src/abi/HolographERC721.json')
    const holographErc721 = new ethers.ContractFactory(holographErc721ABI, '0x', sourceWallet).attach(
      this.collectionAddress,
    )

    const tokenIdBn = ethers.BigNumber.from(this.tokenId)

    if ((await holographErc721.exists(tokenIdBn)) === false) {
      throw new Error('NFT does not exist')
    }

    const tokenOwner = await holographErc721.ownerOf(tokenIdBn)

    if (
      tokenOwner !== userWallet.address &&
      (await holographErc721.getApproved(tokenIdBn)) !== userWallet.address &&
      (await holographErc721.isApprovedForAll(tokenOwner, userWallet.address)) === false
    ) {
      throw new Error('Token is not owned by the user, or approved for user')
    }

    const holographBridgeABI = await fs.readJson('./src/abi/HolographBridge.json')
    const holographBridge = new ethers.ContractFactory(holographBridgeABI, '0x', sourceWallet).attach(
      await holograph.getBridge(),
    )
    CliUx.ux.action.stop()

    CliUx.ux.action.start('Calculating gas amounts and prices')
    let gasLimit: ethers.BigNumber | undefined

    // Don't modify lzFeeError. It is returned from LZ so we must check this exact string
    const lzFeeError = 'execution reverted: LayerZero: not enough native for fees'
    let startingPayment = ethers.utils.parseUnits('0.000000001', 'ether')
    const powerOfTen = ethers.BigNumber.from(10)
    const calculateGas = async function (collectionAddress: string, tokenId: string) {
      if (gasLimit === undefined) {
        try {
          gasLimit = await holographBridge.estimateGas.erc721out(
            holographToChainId,
            collectionAddress,
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
        await calculateGas(collectionAddress, tokenId)
      }
    }

    try {
      await calculateGas(this.collectionAddress, this.tokenId)
    } catch (error: any) {
      this.error(error)
    }

    if (gasLimit === undefined) {
      this.error('Could not identify messaging costs')
    }

    const gasPriceBase = await sourceWallet.provider.getGasPrice()
    const gasPrice = gasPriceBase.add(gasPriceBase.div(ethers.BigNumber.from("4"))) // gasPrice = gasPriceBase * 1.25
    CliUx.ux.action.stop()
    this.log(
      'Transaction is estimated to cost a total of',
      ethers.utils.formatUnits(gasLimit.mul(gasPrice), 'ether'),
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
        this.collectionAddress,
        userWallet.address,
        userWallet.address,
        this.tokenId,
        {
          gasPrice,
          gasLimit,
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
