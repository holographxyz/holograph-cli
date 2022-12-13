import * as inquirer from 'inquirer'
import * as fs from 'fs-extra'
import path from 'node:path'

import {CliUx, Command, Flags} from '@oclif/core'
import {formatUnits} from '@ethersproject/units'
import {Contract} from '@ethersproject/contracts'
import {WebSocketProvider, JsonRpcProvider} from '@ethersproject/providers'
import {BigNumber} from '@ethersproject/bignumber'
import {BytesLike} from '@ethersproject/bytes'
import {TransactionReceipt} from '@ethersproject/abstract-provider'
import {networks, supportedShortNetworks} from '@holographxyz/networks'

import {ensureConfigFileIsValid} from '../../utils/config'
import {NetworkMonitor} from '../../utils/network-monitor'
import {
  validateContractAddress,
  validateNetwork,
  validateTokenIdInput,
  checkContractAddressFlag,
  checkOptionFlag,
  checkTokenIdFlag,
} from '../../utils/validation'
import {GasPricing} from '../../utils/gas'
import {generateInitCode} from '../../utils/utils'

export default class BridgeNFT extends Command {
  static description = 'Bridge a Holographable NFT from one network to another.'
  static examples = [
    '$ <%= config.bin %> <%= command.id %> --sourceNetwork="goerli" --destinationNetwork="fuji" --collectionAddress="0x1318d3420b0169522eB8F3EF0830aceE700A2eda" --tokenId="0x01"',
  ]

  static flags = {
    collectionAddress: Flags.string({
      description: 'The address of the collection smart contract',
      parse: validateContractAddress,
      multiple: false,
      required: false,
    }),
    tokenId: Flags.string({
      description: 'The token ID of the NFT to beam',
      parse: validateTokenIdInput,
      multiple: false,
      required: false,
    }),
    sourceNetwork: Flags.string({
      description: 'The source network from which to beam',
      parse: validateNetwork,
      options: supportedShortNetworks,
      multiple: false,
      required: false,
    }),
    destinationNetwork: Flags.string({
      description: 'The destination network which to beam to',
      parse: validateNetwork,
      options: supportedShortNetworks,
      multiple: false,
      required: false,
    }),
  }

  async checkIfContractExists(
    network: string,
    provider: WebSocketProvider | JsonRpcProvider,
    contractAddress: string,
    throwError = true,
  ): Promise<boolean> {
    const code: string = await provider.getCode(contractAddress)
    if (code === '0x' || code === '') {
      if (throwError) {
        this.error(`Contract at ${contractAddress} does not exist on ${networks[network].shortKey} network`)
      } else {
        this.log(`Contract at ${contractAddress} does not exist on ${networks[network].shortKey} network`)
      }

      return false
    }

    return true
  }

  /**
   * BridgeNFT class variables
   */
  networkMonitor!: NetworkMonitor

  public async run(): Promise<void> {
    this.log('Loading user configurations...')
    const {environment, userWallet, configFile, supportedNetworksOptions} = await ensureConfigFileIsValid(
      this.config.configDir,
      undefined,
      true,
    )
    const {flags} = await this.parse(BridgeNFT)
    this.log('User configurations loaded')

    const sourceNetwork: string = await checkOptionFlag(
      supportedNetworksOptions,
      flags.sourceNetwork,
      'Select the source network from which to beam',
    )
    const destinationNetwork: string = await checkOptionFlag(
      supportedNetworksOptions,
      flags.destinationNetwork,
      'Select the destination network which to beam to',
      sourceNetwork,
    )
    const collectionAddress: string = await checkContractAddressFlag(
      flags.collectionAddress,
      'Enter the address of the collection smart contract',
    )
    const tokenId: string = await checkTokenIdFlag(flags.tokenId, 'Enter the token ID of the NFT to beam')

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      networks: [sourceNetwork, destinationNetwork],
      debug: this.debug,
      userWallet,
      verbose: false,
    })

    CliUx.ux.action.start('Loading network RPC providers')
    await this.networkMonitor.run(true)
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
      if (!deployedOnSourceChain) {
        this.networkMonitor.structuredLog(
          sourceNetwork,
          `Collection does not exist on ${networks[sourceNetwork].shortKey} network.`,
        )
      }

      if (!deployedOnDestinationChain) {
        this.networkMonitor.structuredLog(
          destinationNetwork,
          `Collection does not exist on ${networks[destinationNetwork].shortKey} network.`,
        )
      }

      this.log('You can deploy the missing contracts with the "create:contract" or "bridge:contract" command.')
      this.exit()
    }

    CliUx.ux.action.start('Checking if collection is holographed')
    const holographedContract: boolean = await this.networkMonitor.registryContract.isHolographedContract(
      collectionAddress,
    )
    CliUx.ux.action.stop()
    if (!holographedContract) {
      this.log(
        'Collection is not an official holographed contract. You cannot bridge it through this command. Alternatively, check if you are using the correct environment.',
      )
      this.exit()
    }

    CliUx.ux.action.start('Retrieving collection smart contract')
    const collectionABI = await fs.readJson(path.join(__dirname, `../../abi/${environment}/HolographERC721.json`))
    const collection = new Contract(collectionAddress, collectionABI, this.networkMonitor.providers[sourceNetwork])
    CliUx.ux.action.stop()

    this.log(`tokenId is ${tokenId}`)
    CliUx.ux.action.start('Checking if token ID exists on ' + sourceNetwork + ' network.')
    const tokenExists: boolean = await collection.exists(tokenId)
    CliUx.ux.action.stop()
    if (!tokenExists) {
      this.log('Token does not exist.')
      this.exit()
    }

    const data: BytesLike = generateInitCode(
      ['address', 'address', 'uint256'],
      [userWallet.address, userWallet.address, tokenId],
    )

    const TESTGASLIMIT: BigNumber = BigNumber.from('10000000')

    let payload: BytesLike = await this.networkMonitor.bridgeContract
      .connect(this.networkMonitor.providers[sourceNetwork])
      .callStatic.getBridgeOutRequestPayload(
        networks[destinationNetwork].holographId,
        collectionAddress,
        '0x' + 'ff'.repeat(32),
        '0x' + 'ff'.repeat(32),
        data as string,
      )

    let estimatedGas: BigNumber = TESTGASLIMIT.sub(
      await this.networkMonitor.operatorContract
        .connect(this.networkMonitor.providers[destinationNetwork])
        .callStatic.jobEstimator(payload as string, {gasLimit: TESTGASLIMIT}),
    )

    const gasPricing: GasPricing = this.networkMonitor.gasPrices[destinationNetwork]
    let gasPrice: BigNumber = gasPricing.isEip1559 ? gasPricing.maxFeePerGas! : gasPricing.gasPrice!
    gasPrice = gasPrice.add(gasPrice.div(BigNumber.from('4')))

    payload = await this.networkMonitor.bridgeContract
      .connect(this.networkMonitor.providers[sourceNetwork])
      .callStatic.getBridgeOutRequestPayload(
        networks[destinationNetwork].holographId,
        collectionAddress,
        estimatedGas,
        // allow LZ module to set gas price
        // '0x' + '00'.repeat(32),
        gasPrice,
        data as string,
      )

    const fees: BigNumber[] = await this.networkMonitor.bridgeContract
      .connect(this.networkMonitor.providers[sourceNetwork])
      .callStatic.getMessageFee(networks[destinationNetwork].holographId, estimatedGas, gasPrice, payload)
    const total: BigNumber = fees[0].add(fees[1])
    estimatedGas = TESTGASLIMIT.sub(
      await this.networkMonitor.operatorContract
        .connect(this.networkMonitor.providers[destinationNetwork])
        .callStatic.jobEstimator(payload as string, {value: total, gasLimit: TESTGASLIMIT}),
    )
    this.log('hlg fee', formatUnits(fees[0], 'ether'), 'ether')
    this.log('lz fee', formatUnits(fees[1], 'ether'), 'ether')
    this.log('lz gasPrice', formatUnits(fees[2], 'gwei'), 'GWEI')
    this.log('our estimated gasPrice', formatUnits(gasPrice, 'gwei'), 'GWEI')
    this.log('estimated gas usage', estimatedGas.toNumber())

    const blockchainPrompt: any = await inquirer.prompt([
      {
        name: 'shouldContinue',
        message: 'Next steps submit the transaction, would you like to proceed?',
        type: 'confirm',
        default: true,
      },
    ])
    if (!blockchainPrompt.shouldContinue) {
      this.log('Dropping command, no blockchain transactions executed')
      this.exit()
    }

    CliUx.ux.action.start('Making beam request...')
    const receipt: TransactionReceipt | null = await this.networkMonitor.executeTransaction({
      network: sourceNetwork,
      contract: this.networkMonitor.bridgeContract.connect(this.networkMonitor.providers[destinationNetwork]),
      methodName: 'bridgeOutRequest',
      args: [networks[destinationNetwork].holographId, collectionAddress, estimatedGas, gasPrice, data as string],
      waitForReceipt: true,
      value: total.add(total.div(BigNumber.from('4'))),
    })
    CliUx.ux.action.stop()

    if (receipt === null) {
      throw new Error('failed to confirm that the transaction was mined')
    } else {
      const jobHash: string | undefined = this.networkMonitor.decodeCrossChainMessageSentEvent(
        receipt,
        this.networkMonitor.operatorAddress,
      )
      if (jobHash === undefined) {
        this.log('Failed to extract cross-chain job hash transaction receipt')
      }

      this.log(
        `Cross-chain beaming from ${networks[sourceNetwork].shortKey} network, to ${networks[destinationNetwork].shortKey} network has started under job hash ${jobHash}`,
      )
    }

    this.exit()
  }
}
