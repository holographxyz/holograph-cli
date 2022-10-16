import {CliUx, Command, Flags} from '@oclif/core'
import * as fs from 'fs-extra'
import {ethers, BigNumber} from 'ethers'
// import {TransactionReceipt} from '@ethersproject/abstract-provider'
import {ensureConfigFileIsValid} from '../../utils/config'
import {BlockJob, NetworkMonitor} from '../../utils/network-monitor'
import {getEnvironment} from '../../utils/environment'
import {
  validateContractAddress,
  validateTokenIdInput,
  checkContractAddressFlag,
  checkNetworkFlag,
  checkTokenIdFlag,
} from '../../utils/validation'
import {web3} from '../../utils/utils'

export default class BridgeNFT extends Command {
  static description = 'Beam a Holographable NFT from source chain to destination chain'
  static examples = [
    '$ holograph bridge:nft --sourceNetwork="goerli" --destinationNetwork="fuji" --collectionAddress="0x1318d3420b0169522eB8F3EF0830aceE700A2eda" --tokenId="0x01"',
  ]

  static flags = {
    collectionAddress: Flags.string({
      description: 'The address of the collection smart contract.',
      parse: validateContractAddress,
      multiple: false,
      required: false,
    }),
    tokenId: Flags.string({
      description: 'The token ID of the NFT to beam.',
      parse: validateTokenIdInput,
      multiple: false,
      required: false,
    }),
    sourceNetwork: Flags.string({
      description: 'The source network from which to beam.',
      multiple: false,
      required: false,
    }),
    destinationNetwork: Flags.string({
      description: 'The destination network which to beam to.',
      multiple: false,
      required: false,
    }),
  }

  async checkIfContractExists(
    network: string,
    provider: ethers.providers.Provider,
    contractAddress: string,
    throwError = true,
  ): Promise<boolean> {
    const code: string = await provider.getCode(contractAddress)
    if (code === '0x' || code === '') {
      if (throwError) {
        this.error(`Contract at ${contractAddress} does not exist on ${network}`)
      } else {
        this.log(`Contract at ${contractAddress} does not exist on ${network}`)
      }

      return false
    }

    return true
  }

  /**
   * BridgeNFT class variables
   */
  networkMonitor!: NetworkMonitor

  async fakeProcessor(job: BlockJob, transactions: ethers.providers.TransactionResponse[]): Promise<void> {
    this.networkMonitor.structuredLog(
      job.network,
      `This should not trigger: ${JSON.stringify(transactions, undefined, 2)}`,
    )
    Promise.resolve()
  }

  public async run(): Promise<void> {
    this.log('Loading user configurations...')
    const environment = getEnvironment()
    const {userWallet, configFile} = await ensureConfigFileIsValid(this.config.configDir, undefined, true)
    const {flags} = await this.parse(BridgeNFT)
    this.log('User configurations loaded.')

    const sourceNetwork: string = await checkNetworkFlag(
      configFile.networks,
      flags.sourceNetwork,
      'Select the source network from which to beam.',
    )
    const destinationNetwork: string = await checkNetworkFlag(
      configFile.networks,
      flags.destinationNetwork,
      'Select the destination network which to beam to.',
      sourceNetwork,
    )
    const collectionAddress: string = await checkContractAddressFlag(
      flags.collectionAddress,
      'Enter the address of the collection smart contract.',
    )
    const tokenId: string = await checkTokenIdFlag(flags.tokenId, 'Enter the token ID of the NFT to beam.')

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      networks: [sourceNetwork, destinationNetwork],
      debug: this.debug,
      processTransactions: this.fakeProcessor,
      userWallet,
    })

    CliUx.ux.action.start('Loading network RPC providers')
    await this.networkMonitor.initializeEthers()
    CliUx.ux.action.stop()

    // Check if the contract is deployed on the source chain and not on the destination chain
    CliUx.ux.action.start('Checking if the collection is deployed on both source and destination networks')
    const deployedOnSourceChain: boolean = await this.checkIfContractExists(
      sourceNetwork,
      this.networkMonitor.providers[sourceNetwork],
      collectionAddress,
      false,
    )
    const deployedOnDestinationChain: boolean = await this.checkIfContractExists(
      destinationNetwork,
      this.networkMonitor.providers[destinationNetwork],
      collectionAddress,
      false,
    )
    CliUx.ux.action.stop()
    if (!deployedOnSourceChain || !deployedOnDestinationChain) {
      this.log('You need to first deploy a collection on a network before you can beam from/to it.')
      this.exit()
    }

    CliUx.ux.action.start('Checking if collection is holographed')
    const holographedContract: boolean = await this.networkMonitor.registryContract.isHolographedContract(
      collectionAddress,
    )
    CliUx.ux.action.stop()
    if (!holographedContract) {
      this.log(
        'Collection is not an official holographed contract.\nYou cannot bridge it through this command.\nAlternatively, check if you are using the correct environment.',
      )
      this.exit()
    }

    CliUx.ux.action.start('Retrieving collection smart contract')
    const collectionABI = await fs.readJson(`./src/abi/${environment}/HolographERC721.json`)
    const collection = new ethers.Contract(
      collectionAddress,
      collectionABI,
      this.networkMonitor.providers[sourceNetwork],
    )
    CliUx.ux.action.stop()

    this.log(`tokenId is ${tokenId}`)
    CliUx.ux.action.start('Checking if token exists on source network')
    const tokenExists: boolean = await collection.exists(tokenId)
    CliUx.ux.action.stop()
    if (!tokenExists) {
      this.log('Token does not exist on source network.')
      this.exit()
    }

    CliUx.ux.action.start('Generating bridgeOutRequest payload')
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const holograph = this.networkMonitor.holograph
    const bridge = this.networkMonitor.bridgeContract
    const interfaces = this.networkMonitor.interfacesContract
    const operator = this.networkMonitor.operatorContract
    const sourceProvider = this.networkMonitor.providers[sourceNetwork]
    const destinationProvider = this.networkMonitor.providers[destinationNetwork]
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const sourceChainId: string = (
      await interfaces.connect(sourceProvider).getChainId(1, (await sourceProvider.getNetwork()).chainId, 2)
    ).toHexString()
    const destinationChainId: string = (
      await interfaces.connect(destinationProvider).getChainId(1, (await destinationProvider.getNetwork()).chainId, 2)
    ).toHexString()
    const wallet: string = this.networkMonitor.wallets[sourceNetwork].address
    const erc721payload: string = web3.eth.abi.encodeParameters(
      [wallet, wallet, tokenId],
      ['address', 'address', 'uint256'],
    )

    const estimatedPayload: string = await bridge
      .connect(sourceProvider)
      .callStatic.getBridgeOutRequestPayload(
        destinationChainId,
        collectionAddress,
        '0x' + 'ff'.repeat(32),
        '0x' + 'ff'.repeat(32),
        erc721payload,
      )
    CliUx.ux.action.stop()
    this.log(`estimatedPayload => ${estimatedPayload}`)

    const estimatedGas: string = BigNumber.from('10000000')
      .sub(
        await operator
          .connect(destinationProvider)
          .callStatic.jobEstimator(estimatedPayload, {gasLimit: BigNumber.from('10000000')}),
      )
      .toHexString()

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const payload: string = await bridge.connect(sourceProvider).callStatic.getBridgeOutRequestPayload(
      destinationChainId,
      collectionAddress,
      estimatedGas,
      // NEED TO GET PROPER GAS PRICE ESTIMATES FOR DESTINATION NETWORK
      BigNumber.from('1'),
      erc721payload,
    )

    // this.networkMonitor.bridgeContract
    /*
      leftover steps to do
      we need to get lz fee
      we need to execute beam request and echo job hash to user
     */
    /*
    CliUx.ux.action.start('Retrieving HolographFactory contract')
    const holographABI = await fs.readJson(`./src/abi/${environment}/Holograph.json`)
    const holograph = new ethers.ContractFactory(holographABI, '0x', sourceWallet).attach(
      HOLOGRAPH_ADDRESSES[environment],
    )

    const holographInterfacesABI = await fs.readJson(`./src/abi/${environment}/Interfaces.json`)
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

    const holographRegistryABI = await fs.readJson(`./src/abi${environment}/HolographRegistry.json`)
    const holographRegistry = new ethers.ContractFactory(holographRegistryABI, '0x', sourceWallet).attach(
      await holograph.getRegistry(),
    )

    // Check that the contract is Holographed
    if (holographRegistry.isHolographedContract(this.collectionAddress) === false) {
      throw new Error('Contract is not a Holograph contract')
    } else {
      this.log('Holographed contract found 👍')
    }

    const holographErc721ABI = await fs.readJson(`./src/abi/${environment}/HolographERC721.json`)
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

    const holographBridgeABI = await fs.readJson(`./src/abi/${environment}/HolographBridge.json`)
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
    const gasPrice = gasPriceBase.add(gasPriceBase.div(ethers.BigNumber.from('4'))) // gasPrice = gasPriceBase * 1.25
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
*/
    this.exit()
  }
}
