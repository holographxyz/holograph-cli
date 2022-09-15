import * as inquirer from 'inquirer'

import {CliUx, Command, Flags} from '@oclif/core'
import {ethers} from 'ethers'

import {ensureConfigFileIsValid} from '../../utils/config'

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
      startHealthcheckServer({networkMonitor: this.networkMonitor})
    }
  }

  async filterBuilder(): Promise<void> {
    this.networkMonitor.filters = [
      {
        type: FilterType.from,
        match: this.networkMonitor.LAYERZERO_RECEIVERS,
        networkDependant: true,
      },
    ]
    Promise.resolve()
  }

  async processTransactions(job: BlockJob, transactions: ethers.providers.TransactionResponse[]): Promise<void> {
    /* eslint-disable no-await-in-loop */
    if (transactions.length > 0) {
      for (const transaction of transactions) {
        this.debug(`Processing transaction ${transaction.hash} on ${job.network} at block ${transaction.blockNumber}`)
        const from: string | undefined = transaction.from?.toLowerCase()
        if (from === this.networkMonitor.LAYERZERO_RECEIVERS[job.network]) {
          await this.handleAvailableOperatorJobEvent(transaction, job.network)
        } else {
          this.networkMonitor.structuredLog(
            job.network,
            `Function processTransactions stumbled on an unknown transaction ${transaction.hash}`,
          )
        }
      }
    }
  }

  async handleAvailableOperatorJobEvent(
    transaction: ethers.providers.TransactionResponse,
    network: string,
  ): Promise<void> {
    let bridgeTransaction
    const receipt = await this.networkMonitor.providers[network].getTransactionReceipt(transaction.hash)
    if (receipt === null) {
      throw new Error(`Could not get receipt for ${transaction.hash}`)
    }

    if (receipt.status === 1) {
      this.networkMonitor.structuredLog(
        network,
        `Checking if Operator was sent a bridge job via the LayerZero Relayer at tx: ${transaction.hash}`,
      )
      const operatorJobPayload = this.networkMonitor.decodeAvailableJobEvent(receipt)
      const operatorJobHash = operatorJobPayload === undefined ? undefined : ethers.utils.keccak256(operatorJobPayload)
      if (operatorJobHash === undefined) {
        this.networkMonitor.structuredLog(network, `Could not extract relayer available job for ${transaction.hash}`)
      } else {
        this.networkMonitor.structuredLog(
          network,
          `HolographOperator received a new bridge job. The job payload hash is ${operatorJobHash}. The job payload is ${operatorJobPayload}`,
        )
        bridgeTransaction = this.networkMonitor.bridgeContract.interface.parseTransaction({
          data: operatorJobPayload!,
          value: ethers.BigNumber.from('0'),
        })
        this.networkMonitor.structuredLog(
          network,
          `Bridge-In trasaction type: ${bridgeTransaction.name} -->> ${bridgeTransaction.args}`,
        )
        if (this.operatorMode !== OperatorMode.listen) {
          await this.executePayload(network, operatorJobPayload!)
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
        switch (error.reason) {
          case 'execution reverted: HOLOGRAPH: already deployed': {
            this.networkMonitor.structuredLog(network, 'HOLOGRAPH: already deployed')

            break
          }

          case 'execution reverted: HOLOGRAPH: invalid job': {
            this.networkMonitor.structuredLog(network, 'HOLOGRAPH: invalid job')

            break
          }

          case 'execution reverted: HOLOGRAPH: not holographed': {
            this.networkMonitor.structuredLog(network, 'HOLOGRAPH: not holographed')

            break
          }

          default: {
            this.networkMonitor.structuredLogError(network, error, contract.address)
          }
        }

        // TODO: figure out how to display this data to front-end???
        return
      }

      const gasPrice = await contract.provider.getGasPrice()
      const jobRawTx = await contract.populateTransaction.executeJob(payload, {gasPrice, gasLimit})
      jobRawTx.nonce = this.networkMonitor.walletNonces[network]
      const jobTx = await this.networkMonitor.wallets[network].sendTransaction(jobRawTx)
      this.debug(jobTx)
      this.networkMonitor.structuredLog(network, `Transaction hash is ${jobTx.hash}`)
      this.networkMonitor.walletNonces[network]++
      jobTx.wait().then((jobReceipt: ethers.providers.TransactionReceipt) => {
        this.debug(jobReceipt)
        this.networkMonitor.structuredLog(network, `Transaction ${jobReceipt.transactionHash} mined and confirmed`)
      })
    } else {
      this.networkMonitor.structuredLog(network, 'Dropped potential payload to execute')
    }
  }
}
