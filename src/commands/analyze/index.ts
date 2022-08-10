import {Command, Flags} from '@oclif/core'
import {ethers} from 'ethers'

import {ConfigFile, ensureConfigFileIsValid} from '../../utils/config'

import {FilterType, BlockJob, Scope, NetworkMonitor} from '../../utils/network-monitor'

export default class Analyze extends Command {
  static description = 'Extract all operator jobs and get their status'
  static examples = [
    `$ holo analyze --scope='[{"network":"rinkeby","startBlock":10857626,"endBlock":11138178},{"network":"mumbai","startBlock":26758573,"endBlock":27457918},{"network":"fuji","startBlock":11406945,"endBlock":12192217}]'`,
  ]

  static flags = {
    scope: Flags.string({
      description:
        'single-line JSON object array of blocks to analyze "[{ network: string, startBlock: number, endBlock: number }]"',
      multiple: true,
    }),
  }

  networkMonitor!: NetworkMonitor

  validateScope(scope: Scope, configFile: ConfigFile, networks: string[], scopeJobs: Scope[]): void {
    if ('network' in scope && 'startBlock' in scope && 'endBlock' in scope) {
      if (Object.keys(configFile.networks).includes(scope.network as string)) {
        if (!networks.includes(scope.network as string)) {
          networks.push(scope.network as string)
        }

        scopeJobs.push(scope)
      } else {
        this.log(`${scope.network} is not a supported network`)
      }
    } else {
      this.log(`${scope} is an invalid Scope object`)
    }
  }

  scopeOut(configFile: ConfigFile, scopeFlags: string[]): {networks: string[], scopeJobs: Scope[]} {
    const networks: string[] = []
    const scopeJobs: Scope[] = []
    for (const scopeString of scopeFlags) {
      try {
        const scopeArray: Scope[] = JSON.parse(scopeString)
        for (const scope of scopeArray) {
          this.validateScope(scope, configFile, networks, scopeJobs)
        }
      } catch {
        this.log(`${scopeString} is an invalid Scope[] JSON object`)
      }
    }

    return {networks, scopeJobs}
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Analyze)

    this.log('Loading user configurations...')
    const {configFile} = await ensureConfigFileIsValid(this.config.configDir, undefined, false)
    this.log('User configurations loaded.')
    const {networks, scopeJobs} = this.scopeOut(configFile, flags.scope)

    this.log(`${JSON.stringify(scopeJobs, undefined, 4)}`)

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      networks,
      debug: this.debug,
      processTransactions: this.processTransactions,
    })

    const blockJobs: {[key: string]: BlockJob[]} = {}

    // Setup websocket subscriptions and start processing blocks
    for (let i = 0, l = networks.length; i < l; i++) {
      const network: string = networks[i]
      blockJobs[network] = []
      for (const scopeJob of scopeJobs) {
        if (scopeJob.network === network) {
          // Allow syncing up to current block height if endBlock is set to 0
          let endBlock = scopeJob.endBlock
          if (scopeJob.endBlock === 0) {
            /* eslint-disable no-await-in-loop */
            endBlock = await this.networkMonitor.providers[network].getBlockNumber()
          }

          for (let n = scopeJob.startBlock, nl = endBlock; n <= nl; n++) {
            blockJobs[network].push({
              network: network,
              block: n,
            } as BlockJob)
          }
        }
      }
    }

    await this.networkMonitor.run(false, blockJobs, this.filterBuilder)
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
        match: this.networkMonitor.bridgeAddress,
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

        this.networkMonitor.structuredLog(
          job.network,
          `Processing transaction ${transaction.hash} on ${job.network} at block ${receipt.blockNumber}`,
        )
        const to: string | undefined = transaction.to?.toLowerCase()
        const from: string | undefined = transaction.from?.toLowerCase()
        if (to === this.networkMonitor.bridgeAddress) {
          // We have bridge job
          await this.handleBridgeOutEvent(transaction, receipt, job.network)
        } else if (to === this.networkMonitor.operatorAddress) {
          // We have a bridge job being executed
          // Check that it worked?
          await this.handleBridgeInEvent(transaction, receipt, job.network)
        } else if (from === this.networkMonitor.LAYERZERO_RECEIVERS[job.network]) {
          // We have an available operator job event
          await this.handleAvailableOperatorJobEvent(transaction, receipt, job.network)
        } else {
          this.networkMonitor.structuredLog(
            job.network,
            `Function processTransactions stumbled on an unknown transaction ${transaction.hash}`,
          )
        }
      }
    }
  }

  async handleBridgeOutEvent(
    transaction: ethers.Transaction,
    receipt: ethers.ContractReceipt,
    network: string,
  ): Promise<void> {
    // 0xa1caf2ea == erc721out
    // 0xa45561bb == erc20out
    // 0xa4bd02d7 == deployOut
    // let functionSignature: string = transaction.data.substring(0, 10).toLowerCase()
    const parsedTransaction: ethers.utils.TransactionDescription =
      this.networkMonitor.bridgeContract.interface.parseTransaction(transaction)
    switch (parsedTransaction.sighash) {
      case '0xa1caf2ea':
      case '0xa45561bb':
      case '0xa4bd02d7':
        // deployOut
        this.networkMonitor.structuredLog(
          network,
          `Bridge-Out event captured: ${parsedTransaction.name} -->> ${parsedTransaction.args}`,
        )
        break
      default:
        this.networkMonitor.structuredLog(network, `Unknown Bridge function executed in tx: ${transaction.hash}`)
        break
    }
  }

  async handleBridgeInEvent(
    transaction: ethers.Transaction,
    receipt: ethers.ContractReceipt,
    network: string,
  ): Promise<void> {
    const parsedTransaction: ethers.utils.TransactionDescription =
      this.networkMonitor.operatorContract.interface.parseTransaction(transaction)
    let bridgeTransaction: ethers.utils.TransactionDescription
    switch (parsedTransaction.name) {
      case 'executeJob':
        this.networkMonitor.structuredLog(
          network,
          `Bridge-In event captured: ${parsedTransaction.name} -->> ${parsedTransaction.args}`,
        )
        bridgeTransaction = this.networkMonitor.bridgeContract.interface.parseTransaction({
          data: parsedTransaction.args._payload,
          value: ethers.BigNumber.from('0'),
        })
        this.networkMonitor.structuredLog(
          network,
          `Bridge-In trasaction type: ${bridgeTransaction.name} -->> ${bridgeTransaction.args}`,
        )
        break
      default:
        this.networkMonitor.structuredLog(network, `Unknown Bridge function executed in tx: ${transaction.hash}`)
        break
    }
  }

  async handleAvailableOperatorJobEvent(
    transaction: ethers.Transaction,
    receipt: ethers.ContractReceipt,
    network: string,
  ): Promise<void> {
    this.networkMonitor.structuredLog(
      network,
      `Checking if Operator was sent a bridge job via the LayerZero Relayer at tx: ${transaction.hash}`,
    )
    let event = null
    if ('logs' in receipt && receipt.logs !== null && receipt.logs.length > 0) {
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
        await this.validateOperatorJob(transaction.hash!, network, payload)
      }
    }
  }

  async validateOperatorJob(transactionHash: string, network: string, payload: string): Promise<void> {
    const contract: ethers.Contract = this.networkMonitor.operatorContract.connect(
      this.networkMonitor.providers[network],
    )
    let hasError = false
    try {
      await contract.estimateGas.executeJob(payload)
    } catch (error: any) {
      hasError = true
      if (error.reason !== 'execution reverted: HOLOGRAPH: invalid job') {
        this.networkMonitor.structuredLog(network, error.reason)
      }
    }

    if (hasError) {
      this.networkMonitor.structuredLog(network, `Transaction: ${transactionHash} has already been done`)
    } else {
      this.networkMonitor.structuredLog(network, `Transaction: ${transactionHash} job needs to be done`)
    }
  }
}
