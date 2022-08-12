import * as inquirer from 'inquirer'

import {CliUx, Command, Flags} from '@oclif/core'
import {ethers} from 'ethers'

import {ensureConfigFileIsValid} from '../../utils/config'

import {decodeDeploymentConfigInput, capitalize, DeploymentConfig} from '../../utils/utils'

import {networkFlag, FilterType, OperatorMode, BlockJob, NetworkMonitor, warpFlag} from '../../utils/network-monitor'
import {startHealthcheckServer} from '../../utils/health-check-server'

export default class Propagator extends Command {
  static description = 'Listen for EVM events deploys collections to ther supported networks'
  static examples = ['$ holo propagator --networks="rinkeby mumbai fuji" --mode=auto']
  static flags = {
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
    ...warpFlag,
    ...networkFlag,
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
    const {userWallet, configFile} = await ensureConfigFileIsValid(this.config.configDir, unsafePassword, true)
    this.log('User configurations loaded.')

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      networks: flags.networks,
      debug: this.debug,
      processTransactions: this.processTransactions,
      userWallet,
      lastBlockFilename: 'propagator-blocks.json',
      warp: flags.warp,
    })

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
          message: 'Propagator has previous (missed) blocks that can be synced. Would you like to sync?',
          type: 'confirm',
          default: true,
        },
      ])
      if (syncPrompt.shouldSync === false) {
        this.networkMonitor.latestBlockHeight = {}
        this.networkMonitor.currentBlockHeight = {}
      }
    }

    CliUx.ux.action.start(`Starting propagator in mode: ${OperatorMode[this.operatorMode]}`)
    await this.networkMonitor.run(!(flags.warp > 0), undefined, this.filterBuilder)
    CliUx.ux.action.stop('🚀')

    // Start server
    if (enableHealthCheckServer) {
      startHealthcheckServer()
    }
  }

  async filterBuilder(): Promise<void> {
    this.networkMonitor.filters = [
      {
        type: FilterType.from,
        match: this.networkMonitor.LAYERZERO_RECEIVERS,
        networkDependant: true,
      },
      {
        type: FilterType.to,
        match: this.networkMonitor.factoryAddress,
        networkDependant: false,
      },
      {
        type: FilterType.to,
        match: this.networkMonitor.operatorAddress,
        networkDependant: false,
      },
    ]
    Promise.resolve()
  }

  async processTransactions(job: BlockJob, transactions: ethers.Transaction[]): Promise<void> {
    /* eslint-disable no-await-in-loop */
    if (transactions.length > 0) {
      for (const transaction of transactions) {
        const receipt = await this.networkMonitor.providers[job.network].getTransactionReceipt(
          transaction.hash as string,
        )
        if (receipt === null) {
          throw new Error(`Could not get receipt for ${transaction.hash}`)
        }

        this.debug(`Processing transaction ${transaction.hash} on ${job.network} at block ${receipt.blockNumber}`)
        if (transaction.to?.toLowerCase() === this.networkMonitor.factoryAddress) {
          this.handleContractDeployedEvents(transaction, receipt, job.network)
        }
      }
    }
  }

  async handleContractDeployedEvents(
    transaction: ethers.Transaction,
    receipt: ethers.ContractReceipt,
    network: string,
  ): Promise<void> {
    this.networkMonitor.structuredLog(
      network,
      `Checking if a new Holograph contract was deployed at tx: ${transaction.hash}`,
    )
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
            this.networkMonitor.structuredLog(
              network,
              `BridgeableContractDeployed event not found in ${transaction.hash}`,
            )
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
      let gasLimit
      try {
        gasLimit = await factory.estimateGas.deployHolographableContract(
          deploymentConfig.config,
          deploymentConfig.signature,
          deploymentConfig.signer,
        )
      } catch (error: any) {
        this.networkMonitor.structuredLog(network, `Calculating Gas has failed for collection ${deploymentAddress}`)
        this.networkMonitor.structuredLogError(network, error, deploymentAddress)
        return
      }

      const gasPriceBase = await this.networkMonitor.providers[network].getGasPrice()
      const gasPrice = gasPriceBase.add (gasPriceBase.div(ethers.BigNumber.from("4"))) // gasPrice = gasPriceBase * 1.25

      this.networkMonitor.structuredLog(
        network,
        `Gas price in Gwei = ${ethers.utils.formatUnits(gasPrice, 'gwei')} for collection ${deploymentAddress}`,
      )
      this.networkMonitor.structuredLog(
        network,
        `Transaction is estimated to cost a total of ${ethers.utils.formatUnits(
          gasLimit.mul(gasPrice),
          'ether',
        )} native gas tokens (in ether) for collection ${deploymentAddress}`,
      )

      try {
        const deployTx = await factory.deployHolographableContract(
          deploymentConfig.config,
          deploymentConfig.signature,
          deploymentConfig.signer,
          {gasPrice, gasLimit},
        )
        this.debug(JSON.stringify(deployTx, null, 2))

        this.networkMonitor.structuredLog(
          network,
          `Transaction created with hash ${deployTx.hash} for collection ${deploymentAddress}`,
        )

        const deployReceipt = await deployTx.wait()

        this.networkMonitor.structuredLog(
          network,
          `Transaction minted with hash ${deployTx.hash} for collection ${deploymentAddress}`,
        )
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

        this.networkMonitor.structuredLog(
          network,
          `Successfully deployed collection ${collectionAddress} = ${deploymentAddress}`,
        )
        return
      } catch (error: any) {
        this.networkMonitor.structuredLog(network, `Submitting tx for collection ${deploymentAddress} failed`)
        this.networkMonitor.structuredLogError(network, error, deploymentAddress)
      }
    } else {
      this.networkMonitor.structuredLog(network, `Collection ${deploymentAddress} already deployed`)
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
