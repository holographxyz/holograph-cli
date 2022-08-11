import * as inquirer from 'inquirer'

import {CliUx, Command, Flags} from '@oclif/core'
import {ethers} from 'ethers'

import {ensureConfigFileIsValid} from '../../utils/config'

import {decodeDeploymentConfig, decodeDeploymentConfigInput, capitalize} from '../../utils/utils'

import {networkFlag, FilterType, OperatorMode, BlockJob, NetworkMonitor} from '../../utils/network-monitor'
import {startHealthcheckServer} from '../../utils/health-check-server'

export default class Operator extends Command {
  static description = 'Listen for EVM events for jobs and process them'
  static examples = ['$ holo operator --networks="rinkeby mumbai fuji" --mode=auto']
  static flags = {
    mode: Flags.string({
      description: 'The mode in which to run the operator',
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
    ...networkFlag,
  }

  /**
   * Operator class variables
   */
  operatorMode: OperatorMode = OperatorMode.listen

  networkMonitor!: NetworkMonitor

  async run(): Promise<void> {
    const {flags} = await this.parse(Operator)

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
      lastBlockFilename: 'operator-blocks.json',
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
    await this.networkMonitor.run(true, undefined, this.filterBuilder)
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
        } else if (transaction.to?.toLowerCase() === this.networkMonitor.operatorAddress) {
          this.handleOperatorBridgeEvents(transaction, receipt, job.network)
        } else {
          this.handleOperatorRequestEvents(transaction, receipt, job.network)
        }
      }
    }
  }

  handleContractDeployedEvents(
    transaction: ethers.Transaction,
    receipt: ethers.ContractReceipt,
    network: string,
  ): void {
    this.networkMonitor.structuredLog(
      network,
      `Checking if a new Holograph contract was deployed at tx: ${transaction.hash}`,
    )
    const config = decodeDeploymentConfigInput(transaction.data)
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
      }
    }
  }

  handleOperatorBridgeEvents(transaction: ethers.Transaction, receipt: ethers.ContractReceipt, network: string): void {
    this.networkMonitor.structuredLog(
      network,
      `Checking if an operator executed a job to bridge a contract / collection at tx: ${transaction.hash}`,
    )
    let event = null
    if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        if (event === null) {
          const log = receipt.logs[i]
          if (log.topics.length > 0 && log.topics[0] === this.networkMonitor.targetEvents.BridgeableContractDeployed) {
            event = log.topics
          }
        }
      }
    } else {
      this.networkMonitor.structuredLog(network, 'Failed to find BridgeableContractDeployed event from operator job')
    }

    if (event) {
      const deploymentInput = this.networkMonitor.abiCoder.decode(['bytes'], '0x' + transaction.data.slice(10))[0]
      const config = decodeDeploymentConfig(
        this.networkMonitor.abiCoder.decode(['bytes'], '0x' + deploymentInput.slice(10))[0],
      )
      const deploymentAddress = '0x' + event[1].slice(26)
      this.networkMonitor.structuredLog(
        network,
        '\nHolographOperator executed a job which bridged a collection\n' +
          `HolographFactory deployed a new collection on ${capitalize(network)} at address ${deploymentAddress}\n` +
          `Operator that deployed the collection is ${transaction.from}` +
          `The config used for deployHolographableContract function was ${JSON.stringify(config, null, 2)}\n`,
      )
    }
  }

  async handleOperatorRequestEvents(
    transaction: ethers.Transaction,
    receipt: ethers.ContractReceipt,
    network: string,
  ): Promise<void> {
    this.networkMonitor.structuredLog(
      network,
      `Checking if Operator was sent a bridge job via the LayerZero Relayer at tx: ${transaction.hash}`,
    )
    let event = null
    if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        if (event === null) {
          const log = receipt.logs[i]
          if (
            log.address.toLowerCase() === this.networkMonitor.operatorAddress &&
            log.topics.length > 0 &&
            log.topics[0] === this.networkMonitor.targetEvents.AvailableJob
          ) {
            event = log.data
          } else {
            this.networkMonitor.structuredLog(
              network,
              `LayerZero transaction is not relevant to AvailableJob event. ` +
                `Transaction was relayed to ${log.address} instead of ` +
                `The Operator at ${this.networkMonitor.operatorAddress}`,
            )
          }
        }
      }

      if (event) {
        const payload = this.networkMonitor.abiCoder.decode(['bytes'], event)[0]
        this.networkMonitor.structuredLog(
          network,
          `HolographOperator received a new bridge job on ${network} with job payload: ${payload}\n`,
        )

        if (this.operatorMode !== OperatorMode.listen) {
          await this.executePayload(network, payload)
        }
      }
    }
  }

  async executePayload(network: string, payload: string): Promise<void> {
    // If the operator is in listen mode, payloads will not be executed
    // If the operator is in manual mode, the payload must be manually executed
    // If the operator is in auto mode, the payload will be executed automatically
    let operate = this.operatorMode === OperatorMode.auto
    if (this.operatorMode === OperatorMode.manual) {
      const operatorPrompt: any = await inquirer.prompt([
        {
          name: 'shouldContinue',
          message: `A transaction appeared on ${network} for execution, would you like to operate?\n`,
          type: 'confirm',
          default: false,
        },
      ])
      operate = operatorPrompt.shouldContinue
    }

    if (operate) {
      const contract = this.networkMonitor.operatorContract.connect(this.networkMonitor.wallets[network])
      let gasLimit
      try {
        gasLimit = await contract.estimateGas.executeJob(payload)
      } catch (error: any) {
        this.error(error.reason)
      }

      const gasPrice = await contract.provider.getGasPrice()
      const jobTx = await contract.executeJob(payload, {gasPrice, gasLimit})
      this.debug(jobTx)
      this.networkMonitor.structuredLog(network, `Transaction hash is ${jobTx.hash}`)

      const jobReceipt = await jobTx.wait()
      this.debug(jobReceipt)
      this.networkMonitor.structuredLog(network, `Transaction ${jobTx.hash} mined and confirmed`)
    } else {
      this.networkMonitor.structuredLog(network, 'Dropped potential payload to execute')
    }
  }
}
