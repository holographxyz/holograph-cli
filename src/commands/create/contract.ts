import {CliUx, Command, Flags} from '@oclif/core'
import * as inquirer from 'inquirer'
import * as fs from 'fs-extra'
import {ethers} from 'ethers'
import {TransactionReceipt} from '@ethersproject/abstract-provider'
import {BytecodeType, bytecodes} from '../../utils/bytecodes'
import {ensureConfigFileIsValid} from '../../utils/config'
import {networkFlag, BlockJob, NetworkMonitor} from '../../utils/network-monitor'
import {deploymentFlags, deploymentProcesses, DeploymentType, DeploymentConfig, decodeDeploymentConfig, decodeDeploymentConfigInput} from '../../utils/contract-deployment'
import {validateContractAddress, validateTokenIdInput, validateTransactionHash, checkBytecodeFlag, checkBytecodeTypeFlag, checkContractAddressFlag, checkDeploymentTypeFlag, checkNetworkFlag, checkNumberFlag, checkOptionFlag, checkStringFlag, checkTokenIdFlag, checkTransactionHashFlag} from '../../utils/validation'
import {NetworkType, Network, networks} from '@holographxyz/networks'

const HolographERC20Event = [
  {name: 'bridgeIn', value: 1},
  {name: 'bridgeOut', value: 2},
  {name: 'afterApprove', value: 3},
  {name: 'beforeApprove', value: 4},
  {name: 'afterOnERC20Received', value: 5},
  {name: 'beforeOnERC20Received', value: 6},
  {name: 'afterBurn', value: 7},
  {name: 'beforeBurn', value: 8},
  {name: 'afterMint', value: 9},
  {name: 'beforeMint', value: 10},
  {name: 'afterSafeTransfer', value: 11},
  {name: 'beforeSafeTransfer', value: 12},
  {name: 'afterTransfer', value: 13},
  {name: 'beforeTransfer', value: 14},
]

const HolographERC721Event = [
  {name: 'bridgeIn', value: 1},
  {name: 'bridgeOut', value: 2},
  {name: 'afterApprove', value: 3},
  {name: 'beforeApprove', value: 4},
  {name: 'afterApprovalAll', value: 5},
  {name: 'beforeApprovalAll', value: 6},
  {name: 'afterBurn', value: 7},
  {name: 'beforeBurn', value: 8},
  {name: 'afterMint', value: 9},
  {name: 'beforeMint', value: 10},
  {name: 'afterSafeTransfer', value: 11},
  {name: 'beforeSafeTransfer', value: 12},
  {name: 'afterTransfer', value: 13},
  {name: 'beforeTransfer', value: 14},
  {name: 'beforeOnERC721Received', value: 15},
  {name: 'afterOnERC721Received', value: 16},
]

export default class Contract extends Command {
  static description = 'Deploy a Holographable contract directly to another chain'
  static examples = ['$ holograph create:contract --deploymentType="deployedTx" --tx="0xdb8b393dd18a71b386c8de75b87310c0c8ded0c57cf6b4c5bab52873d54d1e8a" --txNetwork="eth_goerli"']

  static flags = {
    ...deploymentFlags,
  }

  /**
   * Contract class variables
   */
  networkMonitor!: NetworkMonitor

  public async run(): Promise<void> {
    this.log('Loading user configurations...')
    const {environment, userWallet, configFile, supportedNetworks} = await ensureConfigFileIsValid(this.config.configDir, undefined, true)

    const {flags} = await this.parse(Contract)
    this.log('User configurations loaded.')

    let tx: string
    let txNetwork: string | undefined
    let deploymentConfig!: DeploymentConfig
    let deploymentConfigJson: string | undefined
    let deploymentConfigFile: string | undefined

    const deploymentType: DeploymentType = await checkDeploymentTypeFlag(flags.deploymentType, 'Select the type of deployment to use');
    switch (deploymentType) {
      case DeploymentType.deployedTx:
        txNetwork = await checkOptionFlag(supportedNetworks, flags.txNetwork, 'Select the network on which the transaction was executed')
        tx = await checkTransactionHashFlag(flags.tx, 'Enter the hash of transaction that deployed the original contract')
        break
      case DeploymentType.deploymentConfig:
        deploymentConfigJson = flags.deploymentConfig
        deploymentConfigFile = flags.deploymentConfigFile
        if (deploymentConfigJson !== undefined && deploymentConfigJson !== '') {
          // a config json was provided
          deploymentConfig = JSON.parse(deploymentConfigJson as string) as DeploymentConfig
        } else if (deploymentConfigFile !== undefined && deploymentConfigFile !== '') {
          if (await fs.pathExists(deploymentConfigFile as string)) {
            deploymentConfig = (await fs.readJson(deploymentConfigFile as string)) as DeploymentConfig
          } else {
            throw new Error('The file "' + (deploymentConfigFile as string) + '" does not exist.')
          }
        } else {
          throw new Error('You must include a "deploymentConfig" or "deploymentConfigFile" flag, to use the "deploymentConfig" deployment type.')
        }
        break
      case DeploymentType.createConfig:
        const chainType: string = await checkOptionFlag(supportedNetworks, undefined, 'Select the primary network of the contract (does not prepend chainId to tokenIds)')
        txNetwork = chainType
        const salt: string = await checkTokenIdFlag(undefined, 'Enter a bytes32 hash or number to use for salt hash')
        const bytecodeType: BytecodeType = await checkBytecodeTypeFlag(undefined, 'Select the bytecode type to deploy')
        const contractTypes: string[] = ['HolographERC20', 'HolographERC721']
        const contractType = bytecodeType === BytecodeType.Custom ? await checkOptionFlag(contractTypes, undefined, 'Select the contract type to create') : bytecodeType === BytecodeType.SampleERC20 ? 'HolographERC20' : 'HolographERC721'
        const byteCode: string = bytecodeType === BytecodeType.Custom ? await checkBytecodeFlag(undefined, 'Enter a hex encoded string of the bytecode you want to use') : bytecodes[bytecodeType]
        let initCode!: string
        switch (contractType) {
          case 'HolographERC20':
            const tokenName: string = await checkStringFlag(undefined, 'Enter the token name to use')
            const tokenSymbol: string = await checkStringFlag(undefined, 'Enter the token symbol to use')
            const domainSeperator: string = tokenName
            const domainVersion: number = 1
            const decimals: number = await checkNumberFlag(undefined, 'Enter the number of decimals [0-18] to use. The recommended number is 18.')
            if (decimals > 18 || decimals < 0) {
              throw new Error('Invalid decimals was provided: ' + decimals.toString())
            }

            await inquirer.prompt([
              {
                type: 'checkbox',
                message: 'Select toppings',
                name: 'toppings',
                choices: HolographERC20Event
              },
            ])
/*
  eventConfig: BytesLike,
*/
            break
          case 'HolographERC721':
            const collectionName: string = await checkStringFlag(undefined, 'Enter the collection name to use')
            const collectionSymbol: string = await checkStringFlag(undefined, 'Enter the collection symbol to use')
            const royaltyBps: number = await checkNumberFlag(undefined, 'Enter the percentage of royalty to collect in basepoints. (1 = 0.01%, 10000 = 100%)')
            if (royaltyBps > 10000 || royaltyBps < 0) {
              throw new Error('Invalid royalty basepoints was provided: ' + royaltyBps.toString())
            }

            await inquirer.prompt([
              {
                type: 'checkbox',
                message: 'Select toppings',
                name: 'toppings',
                choices: HolographERC20Event
              },
            ])
/*
  eventConfig: BytesLike,
*/
            break
        }

/*
  config: {
    contractType: string
    chainType: number
    salt: string
    byteCode: string
    initCode: string
  }
  signature: {
    r: string
    s: string
    v: number
  }
  signer: string
*/
        this.log('createConfig')
        break
    }
    const targetNetwork: string = await checkNetworkFlag(configFile.networks, flags.targetNetwork, 'Select the network on which the contract will be executed', txNetwork)


  }
}

/*
    const network: string = await checkNetworkFlag(configFile.networks, flags.network, 'Select the network on which to mint the nft.')
    const collectionAddress: string = await checkContractAddressFlag(flags.collectionAddress, 'Enter the address of the collection smart contract.')
    const tokenId: string = flags.tokenId as string
    const tokenUriType: TokenUriType = TokenUriType[flags.tokenUriType as string as keyof typeof TokenUriType]
    const tokenUri: string = flags.tokenUri as string

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      networks: [network],
      debug: this.debug,
      userWallet,
    })

      deploymentType: Flags.string({
    description: 'The type of deployment to use: [deployedTx, deploymentConfig]',
    multiple: false,
    options: ['deployedTx', 'deploymentConfig'],
    required: false,
  }),



targetNetwork
    const destinationNetworkPrompt: any = await inquirer.prompt([
      {
        name: 'destinationNetwork',
        message: 'Select the network to which the contract will be deployed',
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

    const destinationWallet = userWallet?.connect(destinationNetworkProvider)
    CliUx.ux.action.stop()

    const deploymentConfig = await prepareDeploymentConfig(
      configFile,
      userWallet!,
      flags as Record<string, string | undefined>,
      remainingNetworks,
    )
    this.debug(deploymentConfig)

    CliUx.ux.action.start('Retrieving HolographFactory contract ABIs')
    const holographABI = await fs.readJson(`./src/abi/${environment}/Holograph.json`)
    const holograph = new ethers.ContractFactory(holographABI, '0x', destinationWallet).attach(
      HOLOGRAPH_ADDRESSES[environment],
    )

    const holographFactoryABI = await fs.readJson(`./src/abi/${environment}/HolographFactory.json`)
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

    const gasPriceBase = await destinationWallet!.provider.getGasPrice()
    const gasPrice = gasPriceBase.add(gasPriceBase.div(ethers.BigNumber.from('4'))) // gasPrice = gasPriceBase * 1.25

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
        {gasPrice, gasLimit},
      )
      this.debug(deployTx)
      CliUx.ux.action.stop('Transaction hash is ' + deployTx.hash)

      CliUx.ux.action.start('Waiting for transaction to be mined and confirmed')
      const deployReceipt = await deployTx.wait()
      this.debug(deployReceipt)
      let collectionAddress
      for (let i = 0, l = deployReceipt.logs.length; i < l; i++) {
        const log = deployReceipt.logs[i]
        if (log.topics.length === 3 && log.topics[0] === this.targetEvents.BridgeableContractDeployed) {
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
*/
