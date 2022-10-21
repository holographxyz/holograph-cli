import * as inquirer from 'inquirer'

import {CliUx, Flags} from '@oclif/core'
import {ethers} from 'ethers'

import {ensureConfigFileIsValid} from '../../utils/config'

import {networksFlag, FilterType, OperatorMode, BlockJob, NetworkMonitor} from '../../utils/network-monitor'
import {BaseCommand} from '../../base-commands/base-command'

/**
 * Operator
 * Description: The primary command for operating jobs on the Holograph network.
 */
export default class Operator extends BaseCommand {
  static description = 'Listen for EVM events for jobs and process them'
  static examples = ['$ <%= config.bin %> <%= command.id %> --networks="goerli mumbai fuji" --mode=auto']

  static flags = {
    mode: Flags.string({
      description: 'The mode in which to run the operator',
      options: ['listen', 'manual', 'auto'],
      char: 'm',
    }),
    // ...healthcheckFlag,
    sync: Flags.boolean({
      description: 'Start from last saved block position instead of latest block position',
      default: false,
    }),
    unsafePassword: Flags.string({
      description: 'Enter the plain text password for the wallet in the holograph cli config',
    }),
    ...networksFlag,
    ...BaseCommand.flags,
  }

  operatorMode: OperatorMode = OperatorMode.listen
  networkMonitor!: NetworkMonitor

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    await super.run()
    const {flags} = await this.parse(Operator)

    // Check the flags
    const enableHealthCheckServer = flags.healthCheck
    const healthCheckPort = flags.healthCheckPort
    const syncFlag = flags.sync
    const unsafePassword = flags.unsafePassword

    // if (healthCheckPort && !portValidator(healthCheckPort)) {
    //   this.error('The port should be in the [3000, 65535] range.')
    // }

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

    // Load the last block height from the file
    this.networkMonitor.latestBlockHeight = await this.networkMonitor.loadLastBlocks(this.config.configDir)

    // Check if the operator has previous missed blocks
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

    // Start health check server on port 6000 or healthCheckPort
    // Can be used to monitor that the operator is online and running
    if (enableHealthCheckServer) {
      await this.config.runHook('healthCheck', {networkMonitor: this.networkMonitor, healthCheckPort})
    }
  }

  /**
   * Build the filters to search for events via the network monitor
   */
  async filterBuilder(): Promise<void> {
    this.networkMonitor.filters = [
      {
        type: FilterType.from,
        match: this.networkMonitor.LAYERZERO_RECEIVERS,
        networkDependant: true,
      },
    ]
    return Promise.resolve()
  }

  /**
   * Process the transactions in each block job
   */
  async processTransactions(job: BlockJob, transactions: ethers.providers.TransactionResponse[]): Promise<void> {
    /* eslint-disable no-await-in-loop */
    if (transactions.length > 0) {
      for (const transaction of transactions) {
        const tags: (string | number)[] = []
        tags.push(transaction.blockNumber as number, this.networkMonitor.randomTag())
        const from: string | undefined = transaction.from?.toLowerCase()
        if (from === this.networkMonitor.LAYERZERO_RECEIVERS[job.network]) {
          await this.handleAvailableOperatorJobEvent(transaction, job.network, tags)
        } else {
          this.networkMonitor.structuredLog(
            job.network,
            `Function processTransactions stumbled on an unknown transaction ${transaction.hash}`,
            tags,
          )
        }
      }
    }
  }

  /**
   * Handle the AvailableOperatorJob event from the LayerZero contract when one is picked up while processing transactions
   */
  async handleAvailableOperatorJobEvent(
    transaction: ethers.providers.TransactionResponse,
    network: string,
    tags: (string | number)[],
  ): Promise<void> {
    const receipt: ethers.providers.TransactionReceipt | null = await this.networkMonitor.getTransactionReceipt({
      network,
      transactionHash: transaction.hash,
      attempts: 30,
      canFail: true,
    })
    if (receipt === null) {
      throw new Error(`Could not get receipt for ${transaction.hash}`)
    } else {
      this.networkMonitor.structuredLog(network, `Transaction ${receipt.transactionHash} receipt received`, tags)
    }

    if (receipt.status === 1) {
      this.networkMonitor.structuredLog(
        network,
        `Checking if Operator was sent a bridge job via the LayerZero Relayer at tx: ${transaction.hash}`,
        tags,
      )
      const operatorJobPayload = this.networkMonitor.decodeAvailableJobEvent(receipt)
      const operatorJobHash = operatorJobPayload === undefined ? undefined : ethers.utils.keccak256(operatorJobPayload)
      if (operatorJobHash === undefined) {
        this.networkMonitor.structuredLog(
          network,
          `Could not extract relayer available job for ${transaction.hash}`,
          tags,
        )
      } else {
        this.networkMonitor.structuredLog(
          network,
          `HolographOperator received a new bridge job. The job payload hash is ${operatorJobHash}. The job payload is ${operatorJobPayload}`,
          tags,
        )
        const bridgeTransaction = this.networkMonitor.bridgeContract.interface.parseTransaction({
          data: operatorJobPayload!,
          value: ethers.BigNumber.from('0'),
        })
        this.networkMonitor.structuredLog(
          network,
          `Bridge-In transaction type: ${bridgeTransaction.name} -->> ${bridgeTransaction.args}`,
          tags,
        )
        if (this.operatorMode !== OperatorMode.listen) {
          await this.executePayload(network, operatorJobPayload!, tags)
        }
      }
    }
  }

  /**
   * Execute the payload on the destination network
   */
  async executePayload(network: string, payload: string, tags: (string | number)[]): Promise<void> {
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
      await this.networkMonitor.executeTransaction({
        network,
        tags,
        contract: this.networkMonitor.operatorContract,
        methodName: 'executeJob',
        args: [payload],
      })
    } else {
      this.networkMonitor.structuredLog(network, 'Dropped potential payload to execute', tags)
    }
  }
}
