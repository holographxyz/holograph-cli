import * as path from 'node:path'
import * as inquirer from 'inquirer'

import {CliUx, Command, Flags} from '@oclif/core'
import {BigNumber, ethers} from 'ethers'

import {CONFIG_FILE_NAME, ensureConfigFileIsValid} from '../../utils/config'

import {decodeDeploymentConfigInput, capitalize, DeploymentConfig} from '../../utils/utils'

import {BlockJob, NetworkMonitor} from '../../utils/network-monitor'
import {startHealtcheckServer} from '../../utils/health-check-server'

import color from '@oclif/color'

enum OperatorMode {
  listen,
  manual,
  auto,
}

export default class Propagator extends Command {
  static LAST_BLOCKS_FILE_NAME = 'propagator-blocks.json'
  static description = 'Listen for EVM events deploys collections to ther supported networks'
  static examples = ['$ holo propagator --networks="rinkeby mumbai fuji" --mode=auto']
  static flags = {
    networks: Flags.string({description: 'Comma separated list of networks to operate to', multiple: true}),
    mode: Flags.string({
      description: 'The mode in which to run the propagator',
      options: ['listen', 'manual', 'auto'],
      char: 'm',
    }),
    healthCheck: Flags.boolean({
      description: 'Launch server on http://localhost:6000 to make sure command is still running',
      default: false,
    }),
    sync: Flags.boolean({
      description: 'Start from last saved block position instead of latest block position',
      default: false,
    }),
    unsafePassword: Flags.string({
      description: 'Enter the plain text password for the wallet in the holo cli config',
    }),
  }

  crossDeployments: string[] = []

  /**
   * Propagator class variables
   */
  operatorMode: OperatorMode = OperatorMode.listen

  networkMonitor!: NetworkMonitor

  async run(): Promise<void> {
    const {flags} = await this.parse(Propagator)

    const enableHealthCheckServer = flags.healthCheck
    const syncFlag = flags.sync
    const unsafePassword = flags.unsafePassword

    // Have the user input the mode if it's not provided
    let mode: string | undefined = flags.mode

    if (!mode) {
      const prompt: any = await inquirer.prompt([
        {
          name: 'mode',
          message: 'Enter the mode in which to run the operator',
          type: 'list',
          choices: ['listen', 'manual', 'auto'],
          default: 'listen',
        },
      ])
      mode = prompt.mode
    }

    this.operatorMode = OperatorMode[mode as keyof typeof OperatorMode]
    this.log(`Operator mode: ${this.operatorMode}`)

    this.log('Loading user configurations...')
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    const {userWallet, configFile} = await ensureConfigFileIsValid(configPath, unsafePassword, true)
    this.log('User configurations loaded.')

    // Load defaults for the networks from the config file
    if (flags.networks === undefined || '') {
      flags.networks = Object.keys(configFile.networks)
    }

    const blockJobs: {[key: string]: BlockJob[]} = {}

    for (let i = 0, l = flags.networks.length; i < l; i++) {
      const network = flags.networks[i]
      if (Object.keys(configFile.networks).includes(network)) {
        blockJobs[network] = []
      } else {
        // If network is not supported remove it from the array
        flags.networks.splice(i, 1)
        l--
        i--
      }
    }

    const networks: string[] = flags.networks

    this.networkMonitor = new NetworkMonitor(this, configFile, networks, this.debug, this.processBlock, userWallet, 'propagator-blocks.json')

    this.networkMonitor.latestBlockHeight = await this.networkMonitor.loadLastBlocks(this.config.configDir)
    let canSync = false
    const lastBlockKeys: string[] = Object.keys(this.networkMonitor.latestBlockHeight)
    for (let i = 0, l: number = lastBlockKeys.length; i < l; i++) {
      if (this.networkMonitor.latestBlockHeight[lastBlockKeys[i]] > 0) {
        canSync = true
        break
      }
    }

    if (canSync && !syncFlag) {
      const syncPrompt: any = await inquirer.prompt([
        {
          name: 'shouldSync',
          message: 'Operator has previous (missed) blocks that can be synced. Would you like to sync?',
          type: 'confirm',
          default: true,
        },
      ])
      if (syncPrompt.shouldSync === false) {
        this.networkMonitor.latestBlockHeight = {}
        this.networkMonitor.currentBlockHeight = {}
      }
    }

    CliUx.ux.action.start(`Starting operator in mode: ${OperatorMode[this.operatorMode]}`)
    await this.networkMonitor.run(true, blockJobs)
    CliUx.ux.action.stop('🚀')

    // Start server
    if (enableHealthCheckServer) {
      startHealtcheckServer()
    }
  }

  async processBlock(job: BlockJob): Promise<void> {
    this.networkMonitor.structuredLog(job.network, `Processing Block ${job.block}`)
    const block = await this.networkMonitor.providers[job.network].getBlockWithTransactions(job.block)
    if (block !== null && 'transactions' in block) {
      if (block.transactions.length === 0) {
        this.networkMonitor.structuredLog(job.network, `Zero block transactions for block ${job.block}`)
      }

      const interestingTransactions = []
      for (let i = 0, l = block.transactions.length; i < l; i++) {
        const transaction = block.transactions[i]
        if (transaction.from.toLowerCase() === this.networkMonitor.LAYERZERO_RECEIVERS[job.network]) {
          // We have LayerZero call, need to check it it's directed towards Holograph operators
          interestingTransactions.push(transaction)
        } else if ('to' in transaction && transaction.to !== null && transaction.to !== '') {
          const to: string = transaction.to!.toLowerCase()
          // Check if it's a factory call
          if (to === this.networkMonitor.factoryAddress || to === this.networkMonitor.operatorAddress) {
            // We have a potential factory deployment or operator bridge transaction
            interestingTransactions.push(transaction)
          }
        }
      }

      if (interestingTransactions.length > 0) {
        this.networkMonitor.structuredLog(
          job.network,
          `Found ${interestingTransactions.length} interesting transactions on block ${job.block}`,
        )
        this.processTransactions(job, interestingTransactions)
      } else {
        this.networkMonitor.blockJobHandler(job.network, job)
      }
    } else {
      this.networkMonitor.structuredLog(job.network, `${job.network} ${color.red('Dropped block!')} ${job.block}`)
      this.networkMonitor.blockJobs[job.network].unshift(job)
      this.networkMonitor.blockJobHandler(job.network)
    }
  }

  async processTransactions(job: BlockJob, transactions: ethers.Transaction[]): Promise<void> {
    /* eslint-disable no-await-in-loop */
    if (transactions.length > 0) {
      for (const transaction of transactions) {
        const receipt = await this.networkMonitor.providers[job.network].getTransactionReceipt(transaction.hash as string)
        if (receipt === null) {
          throw new Error(`Could not get receipt for ${transaction.hash}`)
        }

        this.debug(`Processing transaction ${transaction.hash} on ${job.network} at block ${receipt.blockNumber}`)
        if (transaction.to?.toLowerCase() === this.networkMonitor.factoryAddress) {
          this.handleContractDeployedEvents(transaction, receipt, job.network)
        }
      }
    }

    this.networkMonitor.blockJobHandler(job.network, job)
  }

  async handleContractDeployedEvents(
    transaction: ethers.Transaction,
    receipt: ethers.ContractReceipt,
    network: string,
  ): Promise<void> {
    this.networkMonitor.structuredLog(network, `Checking if a new Holograph contract was deployed at tx: ${transaction.hash}`)
    const config: DeploymentConfig = decodeDeploymentConfigInput(transaction.data)
    let event = null
    if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        if (event === null) {
          const log = receipt.logs[i]
          if (log.topics.length > 0 && log.topics[0] === this.networkMonitor.targetEvents.BridgeableContractDeployed) {
            event = log.topics
            break
          } else {
            this.networkMonitor.structuredLog(network, `BridgeableContractDeployed event not found in ${transaction.hash}`)
          }
        }
      }

      if (event) {
        const deploymentAddress = '0x' + event[1].slice(26)
        this.networkMonitor.structuredLog(
          network,
          `\nHolographFactory deployed a new collection on ${capitalize(network)} at address ${deploymentAddress}\n` +
            `Wallet that deployed the collection is ${transaction.from}\n` +
            `The config used for deployHolographableContract was ${JSON.stringify(config, null, 2)}\n` +
            `The transaction hash is: ${transaction.hash}\n`,
        )
        if (
          this.operatorMode !== OperatorMode.listen &&
          !this.crossDeployments.includes(deploymentAddress.toLowerCase())
        ) {
          await this.executePayload(network, config, deploymentAddress)
        }
      }
    }
  }

  async deployContract(network: string, deploymentConfig: DeploymentConfig, deploymentAddress: string): Promise<void> {
    const contractCode = await this.networkMonitor.providers[network].getCode(deploymentAddress)
    if (contractCode === '0x') {
      const factory: ethers.Contract = this.networkMonitor.factoryContract.connect(this.networkMonitor.wallets[network])
      this.networkMonitor.structuredLog(network, `Calculating gas price for collection ${deploymentAddress}`)
      let gasAmount
      try {
        gasAmount = await factory.estimateGas.deployHolographableContract(
          deploymentConfig.config,
          deploymentConfig.signature,
          deploymentConfig.signer,
        )
      } catch (error: any) {
        this.networkMonitor.structuredLog(network, `Calculating Gas has failed for collection ${deploymentAddress}`)
        this.log(error)
        this.error(error.reason)
      }

      const gasPrice = network === 'mumbai' ? BigNumber.from('55000000000') : (await this.networkMonitor.providers[network].getGasPrice());

      this.networkMonitor.structuredLog(network, `Gas price in Gwei = ${ethers.utils.formatUnits(gasPrice, "gwei")} for collection ${deploymentAddress}`)
      this.networkMonitor.structuredLog(network, `Transaction is estimated to cost a total of ${ethers.utils.formatUnits(gasAmount.mul(gasPrice), 'ether')} native gas tokens (in ether) for collection ${deploymentAddress}`)

      try {
        const deployTx = await factory.deployHolographableContract(
          deploymentConfig.config,
          deploymentConfig.signature,
          deploymentConfig.signer,
        )
        this.debug(JSON.stringify(deployTx, null, 2))

        this.networkMonitor.structuredLog(network, `Transaction created with hash ${deployTx.hash} for collection ${deploymentAddress}`)

        const deployReceipt = await deployTx.wait()

        this.networkMonitor.structuredLog(network, `Transaction minted with hash ${deployTx.hash} for collection ${deploymentAddress}`)
        this.debug(JSON.stringify(deployReceipt, null, 2))
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

        this.networkMonitor.structuredLog(network, `Successfully deployed collection ${collectionAddress} = ${deploymentAddress}`)
        return
      } catch (error: any) {
        this.networkMonitor.structuredLog(network,`Submitting tx for collection ${deploymentAddress} failed`)
        this.log(error)
        this.error(error.error.reason)
      }
    } else {
      this.networkMonitor.structuredLog(network, `collection ${deploymentAddress} already deployed`)
    }
  }

  async executePayload(network: string, config: DeploymentConfig, deploymentAddress: string): Promise<void> {
    // If the propagator is in listen mode, contract deployments will not be executed
    // If the propagator is in manual mode, the contract deployments must be manually executed
    // If the propagator is in auto mode, the contract deployments will be executed automatically
    let operate = this.operatorMode === OperatorMode.auto
    if (this.operatorMode === OperatorMode.manual) {
      const propagatorPrompt: any = await inquirer.prompt([
        {
          name: 'shouldContinue',
          message: `A contract appeared on ${network} for cross-chain deployment, would you like to deploy?\n`,
          type: 'confirm',
          default: false,
        },
      ])
      operate = propagatorPrompt.shouldContinue
    }

    if (operate) {
      this.crossDeployments.push(deploymentAddress.toLowerCase())
      for (const selectedNetwork of this.networkMonitor.networks) {
        if (selectedNetwork !== network) {
          this.networkMonitor.structuredLog(network, `Trying to deploy contract from ${network} to ${selectedNetwork}`)
          await this.deployContract(selectedNetwork, config, deploymentAddress)
        }
      }
    } else {
      this.networkMonitor.structuredLog(network, 'Dropped potential contract deployment to execute')
    }
  }
}
