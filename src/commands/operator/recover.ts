import * as inquirer from 'inquirer'

import {CliUx, Flags} from '@oclif/core'
import {BigNumber} from 'ethers'
import {TransactionResponse, TransactionReceipt} from '@ethersproject/abstract-provider'
import {TransactionDescription} from '@ethersproject/abi'
import {networks, supportedNetworks} from '@holographxyz/networks'

import {ensureConfigFileIsValid} from '../../utils/config'
import {NetworkMonitor, OperatorMode} from '../../utils/network-monitor'
import {checkOptionFlag, checkTransactionHashFlag} from '../../utils/validation'
import {OperatorJobAwareCommand} from '../../utils/operator-job'
import {HealthCheck} from '../../base-commands/healthcheck'
import {Environment} from '@holographxyz/environment'
import ApiService from '../../services/api-service'
import {CrossChainTransaction, Logger, TransactionStatus} from '../../types/api'
import color from '@oclif/color'
import {decodeAvailableOperatorJobEvent, decodeLzPacketEvent} from '../../events/events'
import * as fs from 'fs-extra'
import {chainIdToNetwork, networkToChainId, sha3} from '../../utils/web3'

enum Step {
  OPERATOR,
  MESSAGE,
}

interface IncompleteJobs {
  // eslint-disable-next-line camelcase
  source_tx?: string
  // eslint-disable-next-line camelcase
  source_chain_id?: number
}

export default class Recover extends OperatorJobAwareCommand {
  static description = 'Attempt to re-run/recover a specific job.'
  static examples = ['$ <%= config.bin %> <%= command.id %> --network="ethereumTestnetGoerli" --tx="0x..."']

  static flags = {
    host: Flags.string({
      description: 'The host to send data to',
      char: 'h',
    }),
    network: Flags.string({
      description: 'The network on which the transaction was executed',
      options: supportedNetworks,
      dependsOn: ['tx'],
    }),
    tx: Flags.string({
      description: 'The hash of transaction that we want to attempt to execute',
      dependsOn: ['network'],
    }),
    file: Flags.string({
      char: 'f',
      description:
        'JSON file path of incomplete jobs (ie "./incompleteJobs.json") in format [{ source_tx, source_chain_id}]',
      exclusive: ['tx'],
    }),
    mode: Flags.string({
      description: 'The mode in which to run the operator',
      options: Object.values(OperatorMode),
      char: 'm',
    }),
    greedy: Flags.boolean({
      description: 'Enable greedy mode which will retry failed jobs with a higher gas limit in order to execute',
      default: false,
    }),
    'update-db': Flags.boolean({
      description: 'Update the DB with the status of the bridge that was being processed',
      dependsOn: ['host'],
    }),
    ...HealthCheck.flags,
    'config-file': Flags.string({description: 'Path to the config file to load'}),
    // NOTE: Apply dash case to operator and indexer
    'unsafe-password': Flags.string({
      description: 'Enter the plain text password for the wallet in the holograph cli config',
    }),
  }

  // API Params
  BASE_URL!: string
  JWT!: string
  apiService!: ApiService
  environment!: Environment
  apiColor = color.keyword('orange')
  errorColor = color.keyword('red')
  operatorMode: OperatorMode = OperatorMode.listen

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    const {flags} = await this.parse(Recover)
    const configFilePath = flags['config-file'] ?? this.config.configDir
    const unsafePassword = flags['unsafe-password']

    this.log('Loading user configurations...')
    const {userWallet, configFile} = await ensureConfigFileIsValid(configFilePath, unsafePassword, true)
    this.log('User configurations loaded.')

    this.operatorMode =
      OperatorMode[
        (await checkOptionFlag(
          Object.values(OperatorMode),
          flags.mode,
          'Select the mode in which to run the operator',
        )) as keyof typeof OperatorMode
      ]

    this.log(`Operator mode: ${this.operatorMode}`)

    if (flags.host !== undefined) {
      this.BASE_URL = flags.host
    }

    if (
      this.environment === Environment.localhost ||
      this.environment === Environment.experimental ||
      this.BASE_URL === undefined
    ) {
      this.log(`Skipping API authentication for ${Environment[this.environment]} environment`)
    } else {
      // Create API Service for GraphQL requests
      try {
        const logger: Logger = {
          log: this.log,
          warn: this.warn,
          debug: this.debug,
          error: this.error,
          jsonEnabled: () => false,
        }
        this.apiService = new ApiService(this.BASE_URL, logger)
        await this.apiService.operatorLogin()
      } catch (error: any) {
        this.error(error)
      }

      if (this.apiService === undefined) {
        throw new Error('API service is not defined')
      }

      this.log(this.apiColor(`API: Successfully authenticated as an operator`))
    }

    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      debug: this.debug,
      userWallet,
      verbose: false,
      greedy: flags.greedy,
    })

    if (this.apiService !== undefined) {
      this.apiService.setStructuredLog(this.networkMonitor.structuredLog.bind(this.networkMonitor))
      this.apiService.setStructuredLogError(this.networkMonitor.structuredLogError.bind(this.networkMonitor))
    }

    CliUx.ux.action.start('Loading network RPC providers')
    await this.networkMonitor.run(true)
    CliUx.ux.action.stop()

    let txArray = []
    // If network and tx flags are provided, construct an array of one element
    if (Boolean(flags.network) || Boolean(flags.tx)) {
      const flagNetwork: string = await checkOptionFlag(
        supportedNetworks,
        flags.network,
        'Select the network to extract transaction details from',
      )

      const flagTx: string = await checkTransactionHashFlag(
        flags.tx,
        'Enter the hash of transaction from which to extract recovery data from',
      )

      txArray = [{sourceChainId: networkToChainId[flagNetwork], sourceTx: flagTx}]
    } else {
      if (!(await fs.pathExists(flags.file as string))) {
        this.error(`Problem reading ${flags.file}`)
      }

      let incompleteJobs: IncompleteJobs[] = []
      try {
        incompleteJobs = (await fs.readJson(flags.file as string)) as IncompleteJobs[]
        // TODO: add validation of the file
      } catch {
        this.error(`One or more lines are an invalid Incomplete jobs JSON object`)
      }

      txArray = incompleteJobs.map(item => {
        return {
          sourceChainId: item.source_chain_id,
          sourceTx: item.source_tx,
        }
      })
    }

    this.log(`Number of jobs to resolve: ${txArray.length}`)

    // Check balance of operator wallet for every unique network in txArray
    // If we do not have funds we should not process jobs.
    const uniqueNetworks = txArray
      .filter((value, index, self) => {
        return self.findIndex(v => v.sourceChainId === value.sourceChainId) === index
      })
      .map(item => item.sourceChainId)
    await this.networkMonitor.checkWalletBalances(userWallet.address, uniqueNetworks as number[])

    for (const element of txArray) {
      const tx = element.sourceTx as string
      const network = chainIdToNetwork()[element.sourceChainId as number]
      this.log('Retrieving transaction details from ' + network + ' network for tx ' + tx)
      const transaction = await this.networkMonitor.getTransaction({
        transactionHash: tx,
        network,
        canFail: true,
        attempts: 30,
        interval: 500,
      })

      if (transaction === null) {
        this.networkMonitor.structuredLog(network, 'Could not retrieve the transaction')
        // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
        this.exit()
      } else {
        await this.processTransaction(network, transaction)
      }
    }

    this.exit()
  }

  /**
   * Process a transaction and attempt to either handle the bridge out or bridge in depending on the event emitted
   */
  async processTransaction(network: string, transaction: TransactionResponse): Promise<void> {
    this.networkMonitor.structuredLog(
      network,
      `Processing transaction ${transaction.hash} at block ${transaction.blockNumber}`,
    )
    const to: string | undefined = transaction.to?.toLowerCase()
    const from: string | undefined = transaction.from?.toLowerCase()
    switch (to) {
      case this.networkMonitor.bridgeAddress: {
        // check if tx is on
        await this.handleBridgeOutEvent(transaction, network)

        break
      }

      default:
        if (from === this.networkMonitor.LAYERZERO_RECEIVERS[network]) {
          await this.handleAvailableOperatorJobEvent(transaction, network)
        } else {
          this.networkMonitor.structuredLog(
            network,
            `Function processTransaction stumbled on an unknown transaction ${transaction.hash}`,
          )
          this.exit()
        }
    }
  }

  /**
   * Handles the event emitted by the bridge contract when a token is bridged out
   */
  async handleBridgeOutEvent(transaction: TransactionResponse, network: string): Promise<void> {
    const receipt: TransactionReceipt | null = await this.networkMonitor.getTransactionReceipt({
      network,
      transactionHash: transaction.hash,
      attempts: 30,
      canFail: true,
    })
    if (receipt === null) {
      throw new Error(`Could not get receipt for ${transaction.hash}`)
    }

    if (receipt.status === 1) {
      this.networkMonitor.structuredLog(network, `Checking if a bridge request was made at tx: ${transaction.hash}`)
      const operatorJobPayload =
        this.networkMonitor.decodePacketEvent(receipt) ??
        decodeLzPacketEvent(receipt, this.networkMonitor.messagingModuleAddress)
      const operatorJobHash = operatorJobPayload === undefined ? undefined : sha3(operatorJobPayload)
      if (operatorJobHash === undefined) {
        this.networkMonitor.structuredLog(network, `Could not extract cross-chain packet for ${transaction.hash}`)
      } else {
        const bridgeTransaction: TransactionDescription =
          this.networkMonitor.bridgeContract.interface.parseTransaction(transaction)
        const chainId: number = (
          await this.networkMonitor.interfacesContract.getChainId(2, BigNumber.from(bridgeTransaction.args.toChain), 1)
        ).toNumber()
        let destinationNetwork: string | undefined
        const networkNames: string[] = supportedNetworks

        for (let i = 0, l = networkNames.length; i < l; i++) {
          const n = networks[networkNames[i]]
          if ((n.chain as number) === chainId) {
            destinationNetwork = networkNames[i]
            break
          }
        }

        if (destinationNetwork === undefined) {
          throw new Error('Failed to identify destination network from the bridge-out request')
        }

        this.networkMonitor.structuredLog(
          network,
          `Bridge-Out transaction type: ${bridgeTransaction.name} -->> ${bridgeTransaction.args}`,
        )

        await this.executePayload(destinationNetwork, operatorJobPayload!, Step.MESSAGE)
      }
    }
  }

  /**
   * Handles the event emitted by the operator contract when a job is available and can be executed
   */
  async handleAvailableOperatorJobEvent(transaction: TransactionResponse, network: string): Promise<void> {
    const receipt: TransactionReceipt | null = await this.networkMonitor.getTransactionReceipt({
      network,
      transactionHash: transaction.hash,
      attempts: 30,
      canFail: true,
    })

    if (receipt === null) {
      throw new Error(`Could not get receipt for ${transaction.hash}`)
    }

    if (receipt.status === 1) {
      this.networkMonitor.structuredLog(
        network,
        `Checking if Operator was sent a bridge job via the LayerZero Relayer at tx: ${transaction.hash}`,
      )
      const operatorJobEvent: string[] | undefined = decodeAvailableOperatorJobEvent(
        receipt,
        this.networkMonitor.operatorAddress,
      )

      const operatorJobPayload: string | undefined = operatorJobEvent === undefined ? undefined : operatorJobEvent![1]
      const operatorJobHash: string | undefined = operatorJobPayload === undefined ? undefined : operatorJobEvent![0]

      if (operatorJobHash === undefined) {
        this.networkMonitor.structuredLog(network, `Could not extract relayer available job for ${transaction.hash}`)
      } else {
        this.networkMonitor.structuredLog(
          network,
          `HolographOperator received a new bridge job. The job payload hash is ${operatorJobHash}. The job payload is ${operatorJobPayload}`,
        )
        const bridgeTransaction = this.networkMonitor.bridgeContract.interface.parseTransaction({
          data: operatorJobPayload!,
        })
        this.networkMonitor.structuredLog(
          network,
          `Bridge-In transaction type: ${bridgeTransaction.name} -->> ${bridgeTransaction.args}`,
        )
        await this.executePayload(network, operatorJobPayload!, Step.OPERATOR)
      }
    }
  }

  /**
   * Execute the payload on the destination network
   */
  async executePayload(network: string, payload: string, step: Step): Promise<void> {
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
          default: true,
        },
      ])
      operate = operatorPrompt.shouldContinue
    }

    if (operate) {
      const response = await this.networkMonitor.executeTransaction({
        network,
        contract: this.networkMonitor.operatorContract,
        methodName: 'executeJob',
        args: [payload],
      })

      // Manually disabled this as its only needed if indexer is not running when this is processed
      if (response !== null && response.status === 1 && this.updateDB) {
        await this.updateDB(network, sha3(payload), step)
      }
    }
  }

  async updateDB(network: string, jobHash: string, step: Step): Promise<void> {
    if (this.apiService === undefined) {
      return
    }

    let updatedCrossChainTransaction: CrossChainTransaction | undefined

    try {
      this.networkMonitor.structuredLog(network, `Checking status for jobHash: ${jobHash}...`)

      const crossChainTransaction = await this.apiService.getCrossChainTransaction(jobHash)

      if (
        crossChainTransaction.sourceStatus !== TransactionStatus.COMPLETED ||
        crossChainTransaction.messageStatus !== TransactionStatus.COMPLETED
      ) {
        this.networkMonitor.structuredLog(network, `Bridging is not completed in the DB...`)

        updatedCrossChainTransaction = crossChainTransaction

        if (step === Step.OPERATOR) {
          updatedCrossChainTransaction.sourceStatus = TransactionStatus.COMPLETED
          updatedCrossChainTransaction.messageStatus = TransactionStatus.COMPLETED
        } else if (step === Step.MESSAGE) {
          updatedCrossChainTransaction.messageStatus = TransactionStatus.COMPLETED
        }

        updatedCrossChainTransaction.data = undefined
        delete updatedCrossChainTransaction.id
      }
    } catch (error: any) {
      this.networkMonitor.structuredLogError(network, error, [this.errorColor(`Request failed with errors`)])
    }

    if (updatedCrossChainTransaction !== undefined) {
      try {
        this.networkMonitor.structuredLog(network, `Updating bridging in the DB...`)

        const rawResponse = await this.apiService.updateCrossChainTransactionStatus(updatedCrossChainTransaction)

        if (rawResponse !== undefined) {
          const {data: response, headers} = rawResponse

          const requestId = headers.get('x-request-id') ?? ''
          this.networkMonitor.structuredLog(network, `Query response ${JSON.stringify(response)}`, [requestId])
        }
      } catch (error: any) {
        this.networkMonitor.structuredLogError(network, error, [
          this.errorColor(`Request failed with errors: ${error}`),
        ])
      }
    }
  }
}
