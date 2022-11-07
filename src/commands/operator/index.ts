import * as fs from 'fs-extra'
import * as path from 'node:path'
import * as inquirer from 'inquirer'
import {CliUx, Flags} from '@oclif/core'
import {TransactionDescription} from '@ethersproject/abi'
import {BigNumber} from '@ethersproject/bignumber'
import {TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'
import {Environment} from '@holographxyz/environment'
import {getNetworkByHolographId, networks} from '@holographxyz/networks'
import {ensureConfigFileIsValid} from '../../utils/config'
import {GasPricing} from '../../utils/gas'
import {networksFlag, FilterType, OperatorMode, BlockJob, NetworkMonitor} from '../../utils/network-monitor'
import {healthcheckFlag, startHealthcheckServer} from '../../utils/health-check-server'
import {web3, functionSignature, sha3, zeroAddress} from '../../utils/utils'
import {checkOptionFlag} from '../../utils/validation'
import {OperatorJobAwareCommand, OperatorJob} from '../../utils/operator-job'

/**
 * Operator
 * Description: The primary command for operating jobs on the Holograph network.
 */
export default class Operator extends OperatorJobAwareCommand {
  static description = 'Listen for EVM events for jobs and process them'
  static examples = ['$ <%= config.bin %> <%= command.id %> --networks goerli fuji mumbai --mode=auto --sync']

  static flags = {
    ...networksFlag,
    mode: Flags.string({
      description: 'The mode in which to run the operator',
      options: Object.values(OperatorMode),
      char: 'm',
    }),
    sync: Flags.boolean({
      description: 'Start from last saved block position instead of latest block position',
      default: false,
    }),
    ...healthcheckFlag,
    unsafePassword: Flags.string({
      description: 'Enter the plain text password for the wallet in the holograph cli config',
    }),
  }

  /**
   * Operator class variables
   */
  operatorMode: OperatorMode = OperatorMode.listen
  environment!: Environment
  jobsFile!: string

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    const {flags} = await this.parse(Operator)

    // Check the flags
    const enableHealthCheckServer = flags.healthCheck
    const syncFlag = flags.sync
    const unsafePassword = flags.unsafePassword

    this.operatorMode =
      OperatorMode[
        (await checkOptionFlag(
          Object.values(OperatorMode),
          flags.mode,
          'Select the mode in which to run the operator',
        )) as keyof typeof OperatorMode
      ]

    this.log(`Operator mode: ${this.operatorMode}`)

    this.log('Loading user configurations...')
    const {environment, userWallet, configFile} = await ensureConfigFileIsValid(
      this.config.configDir,
      unsafePassword,
      true,
    )
    this.environment = environment
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

    this.jobsFile = path.join(this.config.configDir, this.networkMonitor.environment + '.operator-job-details.json')

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

    this.operatorStatus.address = userWallet.address.toLowerCase()

    this.networkMonitor.exitCallback = this.exitCallback.bind(this)

    CliUx.ux.action.start(`Starting operator in mode: ${OperatorMode[this.operatorMode]}`)
    await this.networkMonitor.run(true, undefined, this.filterBuilder)
    CliUx.ux.action.stop('🚀')

    // check if file exists
    if (await fs.pathExists(this.jobsFile)) {
      // if file exists, need to add it to list of jobs to process
      this.operatorJobs = (await fs.readJson(this.jobsFile)) as {[key: string]: OperatorJob}
      // need to check each job and make sure it's still valid
      for (const jobHash of Object.keys(this.operatorJobs)) {
        this.operatorJobs[jobHash].gasLimit = BigNumber.from(this.operatorJobs[jobHash].gasLimit)
        this.operatorJobs[jobHash].gasPrice = BigNumber.from(this.operatorJobs[jobHash].gasPrice)
        this.operatorJobs[jobHash].jobDetails.startTimestamp = BigNumber.from(
          this.operatorJobs[jobHash].jobDetails.startTimestamp,
        )
        // if job is still valid, it will stay in object, otherwise it will be removed
        // eslint-disable-next-line no-await-in-loop
        await this.checkJobStatus(jobHash)
      }
    }

    for (const network of this.networkMonitor.networks) {
      // instantiate all network operator job watchers
      setTimeout(this.processOperatorJobs.bind(this, network), 60_000)
    }

    // Start health check server on port 6000
    // Can be used to monitor that the operator is online and running
    if (enableHealthCheckServer) {
      startHealthcheckServer(this.networkMonitor)
    }
  }

  exitCallback(): void {
    const jobs: {[key: string]: OperatorJob} = this.operatorJobs
    for (const jobHash of Object.keys(jobs)) {
      jobs[jobHash].gasLimit = BigNumber.from(jobs[jobHash].gasLimit).toHexString()
      jobs[jobHash].gasPrice = BigNumber.from(jobs[jobHash].gasPrice).toHexString()
      jobs[jobHash].jobDetails.startTimestamp = BigNumber.from(jobs[jobHash].jobDetails.startTimestamp).toHexString()
    }

    fs.writeFileSync(this.jobsFile, JSON.stringify(jobs, undefined, 2))
  }

  /**
   * Build the filters to search for events via the network monitor
   */
  async filterBuilder(): Promise<void> {
    this.networkMonitor.filters = [
      // want to catch AvailableOperatorJob event instead of watching LZ Endpoint from address
      {
        type: FilterType.from,
        match: this.networkMonitor.LAYERZERO_RECEIVERS,
        networkDependant: true,
      },
      // want to also catch FinishedOperatorJob and FailedOperatorJob event
      // for now we catch all calls to HolographOperator with function executeJob
      {
        type: FilterType.functionSig,
        match: functionSignature('executeJob(bytes)'),
        networkDependant: false,
      },
    ]
    if (this.environment === Environment.localhost) {
      this.networkMonitor.filters.push({
        type: FilterType.to,
        match: this.networkMonitor.bridgeAddress,
        networkDependant: false,
      })
    }

    // for first time init, get operator status details
    for (const network of this.networkMonitor.networks) {
      /* eslint-disable no-await-in-loop */
      this.operatorStatus.active[network] = false
      this.operatorStatus.currentPod[network] = 0
      this.operatorStatus.podIndex[network] = 0
      this.operatorStatus.podSize[network] = 0
      await this.updateOperatorStatus(network)
    }
  }

  /**
   * Process the transactions in each block job
   */
  async processTransactions(job: BlockJob, transactions: TransactionResponse[]): Promise<void> {
    /* eslint-disable no-await-in-loop */
    if (transactions.length > 0) {
      for (const transaction of transactions) {
        const tags: (string | number)[] = []
        tags.push(transaction.blockNumber as number, this.networkMonitor.randomTag())
        const to: string | undefined = transaction.to?.toLowerCase()
        const from: string | undefined = transaction.from?.toLowerCase()
        if (to === this.networkMonitor.bridgeAddress) {
          // this only triggers in localhost environment
          this.networkMonitor.structuredLog(
            job.network,
            `handleBridgeOutEvent ${networks[job.network].explorer}/tx/${transaction.hash}`,
            tags,
          )
          await this.handleBridgeOutEvent(transaction, job.network, tags)
        } else if (to === this.networkMonitor.operatorAddress) {
          // use this to speed up logic for getting AvailableOperatorJob event
          this.networkMonitor.structuredLog(
            job.network,
            `handleBridgeInEvent ${networks[job.network].explorer}/tx/${transaction.hash}`,
            tags,
          )
          await this.handleBridgeInEvent(transaction, job.network, tags)
        } else if (from === this.networkMonitor.LAYERZERO_RECEIVERS[job.network]) {
          this.networkMonitor.structuredLog(
            job.network,
            `handleAvailableOperatorJobEvent ${networks[job.network].explorer}/tx/${transaction.hash}`,
            tags,
          )
          await this.handleAvailableOperatorJobEvent(transaction, job.network, tags)
        } else if (transaction.data?.slice(0, 10).startsWith(functionSignature('executeJob(bytes)'))) {
          this.networkMonitor.structuredLog(
            job.network,
            `handleBridgeInEvent ${networks[job.network].explorer}/tx/${transaction.hash}`,
            tags,
          )
          await this.handleBridgeInEvent(transaction, job.network, tags)
        } else {
          this.networkMonitor.structuredLog(job.network, `irrelevant transaction`, tags)
        }
      }
    }
  }

  async handleBridgeOutEvent(
    transaction: TransactionResponse,
    network: string,
    tags: (string | number)[],
  ): Promise<void> {
    const receipt: TransactionReceipt | null = await this.networkMonitor.getTransactionReceipt({
      network,
      transactionHash: transaction.hash,
      attempts: 10,
      canFail: true,
    })
    if (receipt === null) {
      throw new Error(`Could not get receipt for ${transaction.hash}`)
    }

    if (receipt.status === 1) {
      this.networkMonitor.structuredLog(network, `Checking for job hash`, tags)
      const operatorJobHash: string | undefined = this.networkMonitor.decodeCrossChainMessageSentEvent(
        receipt,
        this.networkMonitor.operatorAddress,
      )
      if (operatorJobHash === undefined) {
        this.networkMonitor.structuredLog(network, `No CrossChainMessageSent event found`, tags)
      } else {
        const bridgeTransaction = await this.networkMonitor.bridgeContract.interface.parseTransaction({
          data: transaction.data,
        })
        const args: any[] = this.networkMonitor.decodeLzEvent(receipt, this.networkMonitor.lzEndpointAddress[network])!
        const jobHash: string = web3.utils.keccak256(args[2] as string)
        this.networkMonitor.structuredLog(network, `Bridge request found for job hash ${jobHash}`, tags)
        // adding this double check for just in case
        if (this.environment === Environment.localhost) {
          await this.executeLzPayload(
            getNetworkByHolographId(bridgeTransaction.args[0]).key,
            jobHash,
            [args[0], args[1], 0, args[2]],
            tags,
          )
        }
      }
    } else {
      this.networkMonitor.structuredLog(network, `Transaction failed, ignoring it`, tags)
    }
  }

  async handleBridgeInEvent(
    transaction: TransactionResponse,
    network: string,
    tags: (string | number)[],
  ): Promise<void> {
    const receipt: TransactionReceipt | null = await this.networkMonitor.getTransactionReceipt({
      network,
      transactionHash: transaction.hash,
      attempts: 10,
      canFail: true,
    })
    if (receipt === null) {
      throw new Error(`Could not get receipt for ${transaction.hash}`)
    }

    if (receipt.status === 1) {
      this.networkMonitor.structuredLog(network, `Checking for executeJob function`, tags)
      const parsedTransaction: TransactionDescription =
        this.networkMonitor.operatorContract.interface.parseTransaction(transaction)
      if (parsedTransaction.name === 'executeJob') {
        this.networkMonitor.structuredLog(network, `Extracting bridgeInRequest from transaction`, tags)
        const args: any[] | undefined = Object.values(parsedTransaction.args)
        const operatorJobPayload: string | undefined = args === undefined ? undefined : args[0]
        const operatorJobHash: string | undefined =
          operatorJobPayload === undefined ? undefined : sha3(operatorJobPayload)
        if (operatorJobHash === undefined) {
          this.networkMonitor.structuredLog(network, `Could not find bridgeInRequest in ${transaction.hash}`, tags)
        } else {
          this.networkMonitor.structuredLog(network, `Operator executed job ${operatorJobHash}`, tags)
          // remove job from operatorJobs if it exists
          if (operatorJobHash in this.operatorJobs) {
            this.networkMonitor.structuredLog(network, `Removing job from list of available jobs`, tags)
            delete this.operatorJobs[operatorJobHash]
          }

          // update operator details, in case operator was selected for a job, or any data changed
          this.networkMonitor.structuredLog(network, `Updating operator status`, tags)
          await this.updateOperatorStatus(network)
        }
      } else {
        this.networkMonitor.structuredLog(
          network,
          `Function call was ${parsedTransaction.name} and not executeJob`,
          tags,
        )
      }
    } else {
      this.networkMonitor.structuredLog(network, `Transaction failed, ignoring it`, tags)
    }
  }

  /**
   * Handle the AvailableOperatorJob event from the LayerZero contract when one is picked up while processing transactions
   */
  async handleAvailableOperatorJobEvent(
    transaction: TransactionResponse,
    network: string,
    tags: (string | number)[],
  ): Promise<void> {
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
      this.networkMonitor.structuredLog(network, `Checking for job hash`, tags)
      const operatorJobPayloadData = this.networkMonitor.decodeAvailableOperatorJobEvent(
        receipt,
        this.networkMonitor.operatorAddress,
      )
      const operatorJobHash = operatorJobPayloadData === undefined ? undefined : operatorJobPayloadData[0]
      const operatorJobPayload = operatorJobPayloadData === undefined ? undefined : operatorJobPayloadData[1]
      if (operatorJobHash === undefined) {
        this.networkMonitor.structuredLog(network, `No AvailableOperatorJob event found`, tags)
      } else {
        this.networkMonitor.structuredLog(network, `Found a new job ${operatorJobHash}`, tags)
        // first update operator details, in case operator was selected for a job, or any data changed
        this.networkMonitor.structuredLog(network, `Updating operator status`, tags)
        await this.updateOperatorStatus(network)
        // then add operator job to internal list of jobs to monitor and work on
        this.networkMonitor.structuredLog(network, `Adding job to list of available jobs`, tags)
        await this.decodeOperatorJob(network, operatorJobHash as string, operatorJobPayload as string, tags)
      }
    } else {
      this.networkMonitor.structuredLog(network, `Transaction failed, ignoring it`, tags)
    }
  }

  processOperatorJob = async (network: string, jobHash: string, tags: (string | number)[]): Promise<void> => {
    // if success then pass back payload hash to remove it from list
    if (await this.executeJob(jobHash, tags)) {
      // check job status just in case
      await this.checkJobStatus(jobHash)
      // job was a success
      this.processOperatorJobs(network, jobHash)
    } else {
      // check job status just in case
      await this.checkJobStatus(jobHash)
      // job failed, gotta try again
      this.processOperatorJobs(network)
    }

    Promise.resolve()
  }

  processOperatorJobs = (network: string, jobHash?: string): void => {
    const tags: (string | number)[] = [this.networkMonitor.randomTag()]
    if (jobHash !== undefined && jobHash !== '' && jobHash in this.operatorJobs) {
      delete this.operatorJobs[jobHash]
    }

    const gasPricing: GasPricing = this.networkMonitor.gasPrices[network]
    let highestGas: BigNumber = BigNumber.from('0')
    const now: number = Date.now()
    // update wait times really quickly
    this.updateJobTimes()
    // DO LOGIC HERE FOR FINDING VALID JOB
    const jobs: OperatorJob[] = []
    // extract jobs for network
    for (const job of Object.values(this.operatorJobs)) {
      if (job.network === network) {
        jobs.push(job)
      }
    }

    // sort jobs based on target time, to prioritize ones that need to be finished first
    jobs.sort((a: OperatorJob, b: OperatorJob): number => {
      return a.targetTime - b.targetTime
    })
    const candidates: OperatorJob[] = []
    for (const job of jobs) {
      // check that time is within scope
      if (job.targetTime < now) {
        // add to list of candidates
        candidates.push(job)
        // find highest gas candidate first
        if (BigNumber.from(job.gasPrice).gt(highestGas)) {
          highestGas = BigNumber.from(job.gasPrice)
        }
      }
    }

    if (candidates.length > 0) {
      // sort candidates by gas priority
      // returning highest gas first
      candidates.sort((a: OperatorJob, b: OperatorJob): number => {
        return BigNumber.from(b.gasPrice).sub(BigNumber.from(a.gasPrice)).toNumber()
      })
      const compareGas: BigNumber = gasPricing.isEip1559 ? gasPricing.maxFeePerGas! : gasPricing.gasPrice!
      let foundCandidate = false
      for (const candidate of candidates) {
        if (candidate.jobDetails.operator === zeroAddress || BigNumber.from(candidate.gasPrice).gte(compareGas)) {
          this.networkMonitor.structuredLog(network, `Sending job ${candidate.hash} for execution`, tags)
          // have a valid job to do right away
          this.processOperatorJob(network, candidate.hash, tags)
          foundCandidate = true
          break
        }
      }

      if (!foundCandidate) {
        setTimeout(this.processOperatorJobs.bind(this, network), 1000)
      }
    } else {
      setTimeout(this.processOperatorJobs.bind(this, network), 1000)
    }
  }

  /**
   * Execute the job
   */
  async executeJob(jobHash: string, tags: (string | number)[]): Promise<boolean> {
    // quickly check that job is still valid
    await this.checkJobStatus(jobHash)
    if (jobHash in this.operatorJobs) {
      const job: OperatorJob = this.operatorJobs[jobHash]
      const network: string = job.network
      let operate = this.operatorMode === OperatorMode.auto
      if (this.operatorMode === OperatorMode.manual) {
        const operatorPrompt: any = await inquirer.prompt([
          {
            name: 'shouldContinue',
            message: `A job is available for execution, would you like to operate?\n`,
            type: 'confirm',
            default: true,
          },
        ])
        operate = operatorPrompt.shouldContinue
      }

      if (operate) {
        const gasPricing: GasPricing = this.networkMonitor.gasPrices[network]
        const gasPrice: BigNumber = gasPricing.isEip1559 ? gasPricing.maxFeePerGas! : gasPricing.gasPrice!

        const receipt: TransactionReceipt | null = await this.networkMonitor.executeTransaction({
          network,
          tags,
          contract: this.networkMonitor.operatorContract,
          methodName: 'executeJob',
          args: [job.payload],
          gasPrice: gasPrice,
          gasLimit: BigNumber.from(job.gasLimit).mul(BigNumber.from('2')),
          canFail: false,
          waitForReceipt: true,
          interval: 1000,
        })
        if (receipt !== null && receipt.status === 1) {
          delete this.operatorJobs[jobHash]
        }

        return receipt !== null
      }

      this.networkMonitor.structuredLog(network, 'Available job will not be executed', tags)
      return false
    }

    return true
  }

  /**
   * Execute the lz message payload on the destination network
   */
  async executeLzPayload(network: string, jobHash: string, args: any[], tags: (string | number)[]): Promise<void> {
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
      const data: string = (
        await this.networkMonitor.messagingModuleContract
          .connect(this.networkMonitor.localhostWallets[network])
          .populateTransaction.lzReceive(...args)
      ).data!
      let estimatedGas: BigNumber | undefined
      try {
        estimatedGas = await this.networkMonitor.lzEndpointContract[network].estimateGas.adminCall(
          this.networkMonitor.messagingModuleAddress,
          data,
        )
      } catch {
        this.networkMonitor.structuredLog(network, 'Job is not valid/available for ' + jobHash, tags)
      }

      if (estimatedGas !== undefined) {
        this.networkMonitor.structuredLog(network, 'Sending cross-chain message for ' + jobHash, tags)
        const tx = await this.networkMonitor.lzEndpointContract[network].adminCall(
          this.networkMonitor.messagingModuleAddress,
          data,
        )
        const receipt = await tx.wait()
        if (receipt.status === 1) {
          this.networkMonitor.structuredLog(network, 'Sent cross-chain message for ' + jobHash, tags)
        } else {
          this.networkMonitor.structuredLog(network, 'Failed sending cross-chain message for ' + jobHash, tags)
        }
      }
    } else {
      this.networkMonitor.structuredLog(network, 'Dropped potential payload to execute', tags)
    }
  }
}
