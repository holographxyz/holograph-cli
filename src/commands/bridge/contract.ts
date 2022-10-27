import {CliUx, Command, Flags} from '@oclif/core'
import * as inquirer from 'inquirer'
import * as fs from 'fs-extra'
import {ethers, BytesLike, BigNumber} from 'ethers'
import {TransactionReceipt} from '@ethersproject/abstract-provider'
import {ensureConfigFileIsValid} from '../../utils/config'
import {web3, zeroAddress, generateInitCode} from '../../utils/utils'
import {NetworkMonitor} from '../../utils/network-monitor'
import {DeploymentConfig} from '../../utils/contract-deployment'
import {validateNetwork, validateNonEmptyString, checkOptionFlag, checkStringFlag} from '../../utils/validation'
import {networks, supportedShortNetworks} from '@holographxyz/networks'

export default class BridgeContract extends Command {
  static description =
    'Bridge a Holographable contract from source chain to destination chain. You need to have a deployment config JSON file. Use the "contract:create" command to create or extract one.'

  static examples = [
    '$ <%= config.bin %> <%= command.id %> --sourceNetwork="ethereumTestnetGoerli" --destinationNetwork="avalancheTestnet" --deploymentConfig="./MyContract.json"',
  ]

  static flags = {
    sourceNetwork: Flags.string({
      description: 'The network from which contract deploy request will be sent',
      parse: validateNetwork,
      options: supportedShortNetworks,
      multiple: false,
      required: false,
    }),
    destinationNetwork: Flags.string({
      description: 'The network on which the contract will be deployed',
      parse: validateNetwork,
      options: supportedShortNetworks,
      multiple: false,
      required: false,
    }),
    deploymentConfig: Flags.string({
      description: 'The config file to use',
      parse: validateNonEmptyString,
      multiple: false,
      required: false,
    }),
  }

  /**
   * Contract class variables
   */
  networkMonitor!: NetworkMonitor

  public async run(): Promise<void> {
    this.log('Loading user configurations...')
    const {userWallet, configFile, supportedNetworksOptions} = await ensureConfigFileIsValid(
      this.config.configDir,
      undefined,
      true,
    )

    const {flags} = await this.parse(BridgeContract)
    this.log('User configurations loaded')

    const sourceNetwork: string = await checkOptionFlag(
      supportedNetworksOptions,
      flags.sourceNetwork,
      'Select the network from which contract deploy request will be sent',
    )
    const destinationNetwork: string = await checkOptionFlag(
      supportedNetworksOptions,
      flags.destinationNetwork,
      'Select the network on which the contract will be deployed',
      sourceNetwork,
    )
    let deploymentConfig!: DeploymentConfig
    const deploymentConfigFile: string = await checkStringFlag(flags.deploymentConfig, 'Enter the config file to use')
    if (await fs.pathExists(deploymentConfigFile as string)) {
      deploymentConfig = (await fs.readJson(deploymentConfigFile as string)) as DeploymentConfig
    } else {
      throw new Error('The file "' + (deploymentConfigFile as string) + '" does not exist')
    }

    const configHash: BytesLike = web3.utils.keccak256(
      '0x' +
        (deploymentConfig.config.contractType as string).slice(2) +
        (deploymentConfig.config.chainType as string).slice(2) +
        (deploymentConfig.config.salt as string).slice(2) +
        web3.utils.keccak256(deploymentConfig.config.byteCode as string).slice(2) +
        web3.utils.keccak256(deploymentConfig.config.initCode as string).slice(2) +
        (deploymentConfig.signer as string).slice(2),
    )

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

    CliUx.ux.action.start('Checking that contract is not already deployed on "' + destinationNetwork + '" network')
    const contractAddress: string = await this.networkMonitor.registryContract
      .connect(this.networkMonitor.providers[destinationNetwork])
      .getContractTypeAddress(configHash)
    CliUx.ux.action.stop()
    if (contractAddress !== zeroAddress) {
      throw new Error('Contract already deployed at ' + contractAddress + ' on "' + destinationNetwork + '" network')
    }

    const data: BytesLike = generateInitCode(
      ['tuple(bytes32,uint32,bytes32,bytes,bytes)', 'tuple(bytes32,bytes32,uint8)', 'address'],
      [
        [
          deploymentConfig.config.contractType,
          deploymentConfig.config.chainType,
          deploymentConfig.config.salt,
          deploymentConfig.config.byteCode,
          deploymentConfig.config.initCode,
        ],
        [deploymentConfig.signature.r, deploymentConfig.signature.s, deploymentConfig.signature.v],
        deploymentConfig.signer,
      ],
    )

    const TESTGASLIMIT: BigNumber = BigNumber.from('10000000')
    const GASPRICE: BigNumber = await this.networkMonitor.providers[destinationNetwork].getGasPrice()

    let payload: BytesLike = await this.networkMonitor.bridgeContract
      .connect(this.networkMonitor.providers[sourceNetwork])
      .callStatic.getBridgeOutRequestPayload(
        networks[destinationNetwork].holographId,
        this.networkMonitor.factoryAddress,
        '0x' + 'ff'.repeat(32),
        // allow LZ module to set gas price
        // '0x' + '00'.repeat(32),
        '0x' + 'ff'.repeat(32),
        data as string,
      )

    let estimatedGas: BigNumber = TESTGASLIMIT.sub(
      await this.networkMonitor.operatorContract
        .connect(this.networkMonitor.providers[destinationNetwork])
        .callStatic.jobEstimator(payload as string, {gasLimit: TESTGASLIMIT}),
    )

    payload = await this.networkMonitor.bridgeContract
      .connect(this.networkMonitor.providers[sourceNetwork])
      .callStatic.getBridgeOutRequestPayload(
        networks[destinationNetwork].holographId,
        this.networkMonitor.factoryAddress,
        estimatedGas,
        // allow LZ module to set gas price
        // '0x' + '00'.repeat(32),
        GASPRICE,
        data as string,
      )

    const fees: BigNumber[] = await this.networkMonitor.bridgeContract
      .connect(this.networkMonitor.providers[sourceNetwork])
      .callStatic.getMessageFee(networks[destinationNetwork].holographId, estimatedGas, /* 0 */ GASPRICE, payload)
    const total: BigNumber = fees[0].add(fees[1])
    estimatedGas = TESTGASLIMIT.sub(
      await this.networkMonitor.operatorContract
        .connect(this.networkMonitor.providers[destinationNetwork])
        .callStatic.jobEstimator(payload as string, {value: total, gasLimit: TESTGASLIMIT}),
    )
    // this.log('gas price', ethers.utils.formatUnits(fees[2], 'gwei'), 'GWEI')
    this.log('hlg fee', ethers.utils.formatUnits(fees[0], 'ether'), 'ether')
    this.log('lz fee', ethers.utils.formatUnits(fees[1], 'ether'), 'ether')
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
      args: [
        networks[destinationNetwork].holographId,
        this.networkMonitor.factoryAddress,
        estimatedGas,
        GASPRICE,
        data as string,
      ],
      waitForReceipt: true,
      value: total.mul(BigNumber.from('2')),
      gasPrice: GASPRICE.mul(BigNumber.from('2')),
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
        `Cross-chain beaming has started under job hash ${jobHash}, from ${sourceNetwork} network, to ${destinationNetwork} network.`,
      )
    }

    this.exit()
  }
}
