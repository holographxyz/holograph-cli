import {TransactionReceipt} from '@ethersproject/abstract-provider'
import {Environment} from '@holographxyz/environment'
import {CliUx, Flags} from '@oclif/core'
import color from '@oclif/color'
import dotenv from 'dotenv'

import {BlockHeightProcessType, Logger} from '../../types/api'
import {InterestingLog} from '../../types/network-monitor'
import {
  EventType,
  BloomType,
  BloomFilter,
  buildFilter,
  BloomFilterMap,
  CrossChainMessageSentEvent,
  AvailableOperatorJobEvent,
  FinishedOperatorJobEvent,
  FailedOperatorJobEvent,
} from '../../utils/event'

import {
  BlockJob,
  NetworkMonitor,
  networksFlag,
  replayFlag,
  processBlockRange,
  OperatorMode,
} from '../../utils/network-monitor'
import {HealthCheck} from '../../base-commands/healthcheck'
import {ensureConfigFileIsValid} from '../../utils/config'
import ApiService, {HOLOGRAPH_VERSION_ENV} from '../../services/api-service'

import {shouldSync, syncFlag} from '../../flags/sync.flag'
import {BlockHeightOptions, blockHeightFlag} from '../../flags/update-block-height.flag'

dotenv.config()

/*
  NEED TO CHECK
*/
import * as fs from 'fs-extra'
import * as path from 'node:path'
import * as inquirer from 'inquirer'
import {BigNumber} from '@ethersproject/bignumber'
import {GasPricing} from '../../utils/gas'
import {checkOptionFlag} from '../../utils/validation'
import {OperatorJobAwareCommand, OperatorJob} from '../../utils/operator-job'
import {IntrinsicGasTooLowError} from '../../utils/errors'
/*
  END NEED TO CHECK
*/

/**
 * Operator
 * Description: The primary command for operating jobs on the Holograph network.
 */
export default class Operator extends OperatorJobAwareCommand {
  static description = 'Listen for jobs and execute jobs.'
  static examples = ['$ <%= config.bin %> <%= command.id %> --networks goerli fuji mumbai --mode=auto --sync']

  static flags = {
    mode: Flags.string({
      description: 'The mode in which to run the operator',
      options: Object.values(OperatorMode),
      char: 'm',
    }),
    unsafePassword: Flags.string({
      description: 'Enter the plain text password for the wallet in the holograph cli config',
    }),
    host: Flags.string({
      description: 'The host to send data to',
      char: 'h',
      required: false,
    }),
    greedy: Flags.boolean({
      description: 'Enable greedy mode which will retry failed jobs with a higher gas limit in order to execute',
      default: false,
    }),
    ...syncFlag,
    ...blockHeightFlag,
    ...networksFlag,
    ...replayFlag,
    ...processBlockRange,
    ...HealthCheck.flags,
  }

  private isJobBeingExecuted: {[jobHash: string]: boolean} = {}

  // API Params
  BASE_URL?: string
  apiService!: ApiService
  apiColor = color.keyword('orange')
  errorColor = color.keyword('red')
  bloomFilters!: BloomFilterMap
  updateBlockHeight!: string

  environment!: Environment
  legacyBlocks = true

  /**
   * Operator class variables
   */
  operatorMode: OperatorMode = OperatorMode.listen
  jobsFile!: string

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    try {
      this.log(`\n👉 Holograph Version: ${HOLOGRAPH_VERSION_ENV}\n`)
      this.log(`Operator command has begun!!!`)
      const {flags} = await this.parse(Operator)
      this.BASE_URL = flags.host
      this.updateBlockHeight = flags.updateBlockHeight
      const processBlockRange = flags['process-block-range']
      this.legacyBlocks = !processBlockRange

      this.operatorMode = await this.setOperatorMode(flags.mode)

      const {environment, userWallet, configFile} = await this.loadConfigurations(flags.unsafePassword)
      this.environment = environment

      if (flags.replay !== '0') {
        this.log('Replay flag enabled, will not load or save block heights.')
        this.updateBlockHeight = BlockHeightOptions.DISABLE
      }

      await this.authenticateApi()
      this.initializeNetworkMonitor(flags, userWallet, configFile)
      await this.manageBlockHeights(flags)
      this.setApiServiceLogs()

      if (!(await shouldSync(flags.sync, this.networkMonitor.latestBlockHeight))) {
        this.resetBlockHeights()
      }

      this.operatorStatus.address = userWallet.address.toLowerCase()
      this.networkMonitor.exitCallback = this.exitCallback.bind(this)

      await this.startNetworkMonitor(flags)
      await this.processSavedJobs()
      this.scheduleJobsProcessing()

      if (flags.healthCheck) {
        await this.startHealthCheckServer(flags.healthCheckPort || 6000)
      }

      this.log(`Operator started running successfully.`)
    } catch (error) {
      this.handleErrorAndExit('An error occurred in the run method', error)
    }
  }

  async loadConfigurations(unsafePassword: any): Promise<{environment: any; userWallet: any; configFile: any}> {
    this.log('Loading user configurations...')
    const configurations = await ensureConfigFileIsValid(this.config.configDir, unsafePassword, true)
    this.log('User configurations loaded.')
    return configurations
  }

  async authenticateApi(): Promise<void> {
    if (this.BASE_URL && this.updateBlockHeight === BlockHeightOptions.API) {
      if (this.environment === Environment.experimental || this.environment === Environment.localhost) {
        this.log(`Skipping API authentication for ${Environment[this.environment]} environment`)
      } else {
        this.log(`Using API for block height track ...`)
        const logger: Logger = {
          log: this.log,
          warn: this.warn,
          debug: this.debug,
          error: this.error,
          jsonEnabled: () => false,
        }
        try {
          this.apiService = new ApiService(this.BASE_URL, logger)
          await this.apiService.operatorLogin()
          this.log(this.apiColor(`Successfully authenticated into API ${this.BASE_URL}`))
        } catch (error: any) {
          this.handleErrorAndExit('Failed to get Operator Token from API', error)
        }
      }
    }
  }

  handleErrorAndExit(message: string, error: any): void {
    this.log(`Error: ${message}`)
    this.log(JSON.stringify({...error, stack: error.stack}))
    this.exit()
  }

  async setOperatorMode(mode: any): Promise<OperatorMode> {
    return OperatorMode[
      (await checkOptionFlag(
        Object.values(OperatorMode),
        mode,
        'Select the mode in which to run the operator',
      )) as keyof typeof OperatorMode
    ]
  }

  initializeNetworkMonitor(flags: any, userWallet: any, configFile: any): void {
    this.networkMonitor = new NetworkMonitor({
      parent: this,
      configFile,
      networks: flags.networks,
      debug: this.debug,
      processLogs: this.processLogs,
      userWallet,
      lastBlockFilename: 'operator-blocks.json',
      replay: flags.replay,
      apiService: this.apiService,
      BlockHeightOptions: this.updateBlockHeight as BlockHeightOptions,
      processBlockRange: flags['process-block-range'],
      greedy: flags.greedy,
    })
    this.jobsFile = path.join(this.config.configDir, this.networkMonitor.environment + '.operator-job-details.json')
  }

  async manageBlockHeights(flags: any): Promise<void> {
    switch (this.updateBlockHeight) {
      case BlockHeightOptions.API:
        if (flags.host === undefined) {
          this.errorColor(`--blockHeight flag option API requires the --host flag`)
        }

        this.networkMonitor.latestBlockHeight = await this.networkMonitor.loadLastBlocksHeights(
          BlockHeightProcessType.OPERATOR,
        )
        break
      case BlockHeightOptions.FILE:
        this.networkMonitor.latestBlockHeight = await this.networkMonitor.loadLastBlocks(this.config.configDir)
        break
      case BlockHeightOptions.DISABLE:
        this.log(`Block height update is disable, it'll not be saved or updated anywhere`)
        this.networkMonitor.latestBlockHeight = {}
        this.networkMonitor.currentBlockHeight = {}
        break
    }
  }

  setApiServiceLogs(): void {
    if (this.apiService !== undefined) {
      this.apiService.setStructuredLog(this.networkMonitor.structuredLog.bind(this.networkMonitor))
      this.apiService.setStructuredLogError(this.networkMonitor.structuredLogError.bind(this.networkMonitor))
    }
  }

  resetBlockHeights(): void {
    this.networkMonitor.latestBlockHeight = {}
    this.networkMonitor.currentBlockHeight = {}
  }

  async startNetworkMonitor(flags: any): Promise<void> {
    CliUx.ux.action.start(`Starting operator in mode: ${OperatorMode[this.operatorMode]}`)
    const continuous = flags.replay === '0'
    await this.networkMonitor.run(continuous, undefined, this.filterBuilder2)
    CliUx.ux.action.stop('🚀')
  }

  async processSavedJobs(): Promise<void> {
    try {
      // Check if file exists
      if (await fs.pathExists(this.jobsFile)) {
        this.log('Saved jobs file exists, parsing it for valid/active jobs.')
        // if file exists, need to add it to list of jobs to process
        this.operatorJobs = (await fs.readJson(this.jobsFile)) as {[key: string]: OperatorJob}

        // Need to check each job and make sure it's still valid
        for (const jobHash of Object.keys(this.operatorJobs)) {
          this.operatorJobs[jobHash].gasLimit = BigNumber.from(this.operatorJobs[jobHash].gasLimit)
          this.operatorJobs[jobHash].gasPrice = BigNumber.from(this.operatorJobs[jobHash].gasPrice)
          this.operatorJobs[jobHash].jobDetails.startTimestamp = BigNumber.from(
            this.operatorJobs[jobHash].jobDetails.startTimestamp,
          )

          // If job is still valid, it will stay in object, otherwise it will be removed
          await this.checkJobStatus(jobHash)
          this.log('Saved jobs parsing completed.')
        }
      } else {
        this.log('Saved jobs file not found (not loaded).')
      }
    } catch (error) {
      this.handleErrorAndExit('An error occurred while processing saved jobs', error)
    }
  }

  scheduleJobsProcessing(): void {
    for (const network of this.networkMonitor.networks) {
      // This starts processing jobs after an initial delay (currently set to 0 seconds)
      setTimeout(async () => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          try {
            await this.processOperatorJobs(network)
            // eslint-disable-next-line no-promise-executor-return
            await new Promise(resolve => setTimeout(resolve, 1000)) // Waits for 1 second
          } catch (error) {
            console.error(`Error processing jobs for network ${network}:`, error)
          }
        }
      }, 0) // You can increase this value for a longer initial delay
    }
  }

  async startHealthCheckServer(port: number): Promise<void> {
    // Start health check server
    // Can be used to monitor that the operator is online and running
    await this.config.runHook('healthCheck', {networkMonitor: this.networkMonitor, port})
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

  bloomFilterAddress = (address: string): Pick<BloomFilter, 'bloomType' | 'bloomValue' | 'bloomValueHashed'> => ({
    bloomType: BloomType.contract,
    bloomValue: address,
    bloomValueHashed: address,
  })

  async filterBuilder2(): Promise<void> {
    const operatorAddress = this.networkMonitor.operatorAddress

    const buildEventFilter = (eventType: EventType, targetAddress?: string) =>
      buildFilter(
        BloomType.topic,
        eventType,
        undefined,
        targetAddress ? [this.bloomFilterAddress(targetAddress!)] : undefined,
      )

    this.bloomFilters = {
      [EventType.CrossChainMessageSent]: buildEventFilter(EventType.CrossChainMessageSent, operatorAddress),
      [EventType.AvailableOperatorJob]: buildEventFilter(EventType.AvailableOperatorJob, operatorAddress),
      [EventType.FinishedOperatorJob]: buildEventFilter(EventType.FinishedOperatorJob, operatorAddress),
      [EventType.FailedOperatorJob]: buildEventFilter(EventType.FailedOperatorJob, operatorAddress),
    }

    this.networkMonitor.bloomFilters = Object.values(this.bloomFilters) as BloomFilter[]

    // for first time init, get operator status details
    for (const network of this.networkMonitor.networks) {
      this.operatorStatus.active[network] = false
      this.operatorStatus.currentPod[network] = 0
      this.operatorStatus.podIndex[network] = 0
      this.operatorStatus.podSize[network] = 0
      await this.updateOperatorStatus(network)
    }
  }

  async processLogs(job: BlockJob, interestingLog: InterestingLog[]): Promise<void> {
    const startTime = performance.now()

    if (interestingLog.length <= 0) {
      return
    }

    // Map over the transactions to create an array of Promises
    const transactionPromises = interestingLog.map(interestingLog => this.processSingleTransaction(interestingLog, job))

    // Use Promise.all to execute all the Promises concurrently
    await Promise.all(transactionPromises)

    const endTime = performance.now()
    const duration = endTime - startTime
    this.networkMonitor.structuredLog(
      job.network,
      `Processed ${transactionPromises.length} transactions in ${duration}ms`,
    )
  }

  async processSingleTransaction(interestingLog: InterestingLog, job: BlockJob) {
    const tags: (string | number)[] = [
      interestingLog.transaction.blockNumber as number,
      this.networkMonitor.randomTag(),
    ]
    const type: EventType = EventType[interestingLog.bloomId as keyof typeof EventType]

    // Log processing of transaction
    this.networkMonitor.structuredLog(
      job.network,
      `Processing transaction ${interestingLog.transaction.hash} at block ${interestingLog.transaction.blockNumber}`,
      tags,
    )
    this.networkMonitor.structuredLog(job.network, `Identified this as a ${interestingLog.bloomId} event`, tags)

    try {
      switch (type) {
        case EventType.CrossChainMessageSent:
          await this.handleCrossChainMessageSentEvent(job, type, interestingLog, tags)
          break
        case EventType.AvailableOperatorJob:
          await this.handleAvailableOperatorJobEvent(job, type, interestingLog, tags)
          break
        case EventType.FinishedOperatorJob:
          await this.handleFinishedOperatorJobEvent(job, type, interestingLog, tags)
          break
        case EventType.FailedOperatorJob:
          await this.handleFailedOperatorJobEvent(job, type, interestingLog, tags)
          break

        default:
          this.networkMonitor.structuredLogError(job.network, `UNKNOWN EVENT`, tags)
      }
    } catch (error: any) {
      this.networkMonitor.structuredLogError(
        job.network,
        this.errorColor(`Error processing transaction: `, error),
        tags,
      )
    }
  }

  async handleCrossChainMessageSentEvent(
    job: BlockJob,
    type: EventType,
    interestingLog: InterestingLog,
    tags: (string | number)[],
  ) {
    try {
      const crossChainMessageSentEvent: CrossChainMessageSentEvent | null = this.bloomFilters[
        type
      ]!.bloomEvent.decode<CrossChainMessageSentEvent>(type, interestingLog.log!)
      if (crossChainMessageSentEvent !== null) {
        this.networkMonitor.structuredLog(
          job.network,
          `Bridge request found for job hash ${crossChainMessageSentEvent.messageHash}`,
          tags,
        )
      }
    } catch (error: any) {
      this.networkMonitor.structuredLogError(
        job.network,
        this.errorColor(`Decoding CrossChainMessageSentEvent error: `, error),
        tags,
      )
    }
  }

  async handleAvailableOperatorJobEvent(
    job: BlockJob,
    type: EventType,
    interestingLog: InterestingLog,
    tags: (string | number)[],
  ) {
    try {
      const availableOperatorJobEvent: AvailableOperatorJobEvent | null = this.bloomFilters[
        type
      ]!.bloomEvent.decode<AvailableOperatorJobEvent>(type, interestingLog.log!)

      if (availableOperatorJobEvent !== null) {
        this.networkMonitor.structuredLog(job.network, `Found a new job ${availableOperatorJobEvent.jobHash}`, tags)

        // First update operator details, in case operator was selected for a job, or any data changed
        this.networkMonitor.structuredLog(job.network, `Updating operator status`, tags)
        const statusUpdateSuccessful = await this.updateOperatorStatus(job.network)

        if (!statusUpdateSuccessful) {
          this.networkMonitor.structuredLogError(
            job.network,
            `Failed to update operator status. Proceeding with last known status for job ${availableOperatorJobEvent.jobHash}`,
            tags,
          )
        }

        // Then add operator job to internal list of jobs to monitor and work on
        this.networkMonitor.structuredLog(job.network, `Adding job to list of available jobs`, tags)
        await this.decodeOperatorJob(
          job.network,
          availableOperatorJobEvent.jobHash,
          availableOperatorJobEvent.payload,
          tags,
        )
      }
    } catch (error: any) {
      this.networkMonitor.structuredLogError(
        job.network,
        this.errorColor(`Decoding AvailableOperatorJobEvent error: `, error),
        tags,
      )
    }
  }

  async handleFinishedOperatorJobEvent(
    job: BlockJob,
    type: EventType,
    interestingLog: InterestingLog,
    tags: (string | number)[],
  ) {
    try {
      const finishedOperatorJobEvent: FinishedOperatorJobEvent | null = this.bloomFilters[
        type
      ]!.bloomEvent.decode<FinishedOperatorJobEvent>(type, interestingLog.log!)
      if (finishedOperatorJobEvent !== null) {
        this.networkMonitor.structuredLog(
          job.network,
          `Operator executed job ${finishedOperatorJobEvent.jobHash}`,
          tags,
        )
        // remove job from operatorJobs if it exists
        if (finishedOperatorJobEvent.jobHash in this.operatorJobs) {
          this.networkMonitor.structuredLog(job.network, `Removing job from list of available jobs`, tags)
          delete this.operatorJobs[finishedOperatorJobEvent.jobHash]
        }

        // update operator details, in case operator was selected for a job, or any data changed
        this.networkMonitor.structuredLog(job.network, `Updating operator status`, tags)
        await this.updateOperatorStatus(job.network)
      }
    } catch (error: any) {
      this.networkMonitor.structuredLogError(
        job.network,
        this.errorColor(`Decoding FinishedOperatorJobEvent error: `, error),
        tags,
      )
    }
  }

  async handleFailedOperatorJobEvent(
    job: BlockJob,
    type: EventType,
    interestingLog: InterestingLog,
    tags: (string | number)[],
  ) {
    try {
      const failedOperatorJobEvent: FailedOperatorJobEvent | null = this.bloomFilters[
        type
      ]!.bloomEvent.decode<FailedOperatorJobEvent>(type, interestingLog.log!)
      if (failedOperatorJobEvent !== null) {
        this.networkMonitor.structuredLog(
          job.network,
          `Operator job finished but with failed code ${failedOperatorJobEvent.jobHash}`,
          tags,
        )
      }
    } catch (error: any) {
      this.networkMonitor.structuredLogError(
        job.network,
        this.errorColor(`Decoding FailedOperatorJobEvent error: `, error),
        tags,
      )
    }
  }

  processOperatorJob = async (network: string, jobHash: string, tags: (string | number)[]): Promise<void> => {
    this.networkMonitor.structuredLog(network, `Beginning to process job with hash: ${jobHash}`, tags)

    const isJobExecutedSuccessfully = await this.executeJob(jobHash, tags)

    if (isJobExecutedSuccessfully) {
      this.networkMonitor.structuredLog(
        network,
        `Job with hash: ${jobHash} was executed successfully. Removing it from the list of jobs being processed.`,
        tags,
      )

      // We can now delete the job hash from the list of jobs being processed
      if (jobHash && this.operatorJobs[jobHash]) {
        delete this.operatorJobs[jobHash]
      }
    } else {
      this.networkMonitor.structuredLog(
        network,
        `Job with hash: ${jobHash} failed to execute. Checking its status...`,
        tags,
      )
      await this.checkJobStatus(jobHash, tags)

      this.networkMonitor.structuredLog(
        network,
        `Reprocessing operator jobs after failed execution of job: ${jobHash}`,
        tags,
      )
    }
  }

  processOperatorJobs = async (network: string): Promise<void> => {
    const jobCount = Object.keys(this.operatorJobs).length

    this.networkMonitor.structuredLog(network, `Starting processOperatorJobs`)

    if (jobCount === 0) {
      this.networkMonitor.structuredLog(network, `No jobs to process`)
      return
    }

    this.networkMonitor.structuredLog(
      network,
      `New jobs to process detected. Current job count for ${network}: ${jobCount}`,
    )

    let selectedJob: OperatorJob | null = null

    try {
      this.debug(`Continue job processing for network: ${network}`)

      const gasPricing: GasPricing = this.networkMonitor.gasPrices[network]
      if (!gasPricing) {
        this.networkMonitor.structuredLogError(network, `Missing gas pricing data for network ${network}`)
        return
      }

      this.networkMonitor.structuredLog(network, `Updating job times`)
      this.updateJobTimes()
      const jobs: OperatorJob[] = Object.values(this.operatorJobs).filter(job => job.network === network)

      this.networkMonitor.structuredLog(network, `Sorting jobs by priority`)
      const sortedJobs = this.sortJobsByPriority(jobs)

      this.networkMonitor.structuredLog(network, `Selecting job`)
      selectedJob = this.selectJob(sortedJobs, gasPricing)

      if (selectedJob) {
        this.networkMonitor.structuredLog(network, `Selected job: ${selectedJob.hash}`)
        const tags = this.operatorJobs[selectedJob.hash]?.tags ?? [this.networkMonitor.randomTag()]
        this.networkMonitor.structuredLog(network, `Sending job ${selectedJob.hash} for execution`, tags)
        await this.processOperatorJob(network, selectedJob.hash, tags)
      } else {
        this.networkMonitor.structuredLog(network, `No job selected. Will check again in the next interval.`)
      }

      this.networkMonitor.structuredLog(network, `Job processing for network: ${network} completed.`)
    } catch (error: any) {
      this.networkMonitor.structuredLogError(
        network,
        `An error occurred while processing jobs for network: ${network}`,
        error,
      )

      // Add the failed job to failed jobs list
      if (selectedJob && selectedJob.hash) {
        this.failedOperatorJobs[selectedJob.hash] = this.operatorJobs[selectedJob.hash]

        // Delete the job from the original operatorJobs
        delete this.operatorJobs[selectedJob.hash]

        this.networkMonitor.structuredLogError(
          network,
          `Error processing job ${selectedJob.hash} for network: ${network}. Current failed jobs count: ${
            Object.keys(this.failedOperatorJobs).length
          }`,
          error,
        )
      }
    }
  }

  // This function sorts jobs based on target time and then by gas price.
  sortJobsByPriority(jobs: OperatorJob[]): OperatorJob[] {
    const now = Date.now()
    const validJobs = jobs.filter(job => job.targetTime < now)
    return validJobs.sort((a, b) => {
      const timeDiff = a.targetTime - b.targetTime
      if (timeDiff !== 0) return timeDiff
      return BigNumber.from(b.gasPrice).sub(BigNumber.from(a.gasPrice)).toNumber()
    })
  }

  // This function selects the best job based on the provided gas pricing.
  selectJob(jobs: OperatorJob[], gasPricing: GasPricing): OperatorJob | null {
    const compareGas: BigNumber = gasPricing.isEip1559 ? gasPricing.nextBlockFee! : gasPricing.gasPrice!

    let totalGas: BigNumber = BigNumber.from(0)
    for (const job of jobs) {
      totalGas = totalGas.add(BigNumber.from(job.gasPrice))
      if (BigNumber.from(job.gasPrice).gte(compareGas)) {
        return job
      }
    }

    // Calculate average gas price.
    const averageGasPrice: BigNumber = jobs.length > 0 ? totalGas.div(jobs.length) : BigNumber.from(0)

    this.networkMonitor.structuredLog(
      undefined,
      `None of the jobs in queue can be executed with the current gas pricing. ${
        jobs.length
      } jobs in queue. Gas price: ${compareGas.toString()}. Average gas provided: ${averageGasPrice.toString()}`,
    )
    return null
  }

  /**
   * Execute the job
   */
  async executeJob(jobHash: string, tags: (string | number)[]): Promise<boolean> {
    this.networkMonitor.structuredLog(undefined, `Starting execute job`, tags)
    let network: string | undefined

    try {
      // Idempotency check
      if (this.isJobBeingExecuted[jobHash]) {
        this.networkMonitor.structuredLog(undefined, 'Job is already being executed', tags)
        return false
      }

      this.isJobBeingExecuted[jobHash] = true

      // Check job status
      this.networkMonitor.structuredLog(undefined, `Checking job status...`, tags)
      await this.checkJobStatus(jobHash, tags)

      if (!(jobHash in this.operatorJobs)) {
        this.networkMonitor.structuredLog(undefined, `Job hash is not in the operator jobs... returning`, tags)
        return true
      }

      const job: OperatorJob = this.operatorJobs[jobHash]
      network = job.network
      let operate = this.operatorMode === OperatorMode.auto

      // Operator mode handling
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

      if (!operate) {
        this.networkMonitor.structuredLog(network, 'Not in mode to execute. Available job will not be executed', tags)
        return false
      }

      // Transaction handling
      this.networkMonitor.structuredLog(network, `About to execute the transaction`, tags)
      const receipt: TransactionReceipt | null = await this.networkMonitor.executeTransaction({
        network,
        tags,
        contract: this.networkMonitor.operatorContract,
        methodName: 'executeJob',
        args: [job.payload],
        gasPrice: BigNumber.from(job.gasPrice),
        gasLimit: BigNumber.from(job.gasLimit).mul(BigNumber.from('2')),
        canFail: true,
        waitForReceipt: true,
        interval: 5000,
        attempts: 30,
      })

      if (receipt && receipt.status === 1) {
        this.networkMonitor.structuredLog(
          network,
          `Execution succeeded. Removing job ${jobHash} from the operator jobs queue`,
          tags,
        )
        delete this.operatorJobs[jobHash]
      }

      return receipt !== null
    } catch (error: any) {
      this.networkMonitor.structuredLogError(network, `An error occurred while executing job: ${jobHash}`, error)

      if (error instanceof IntrinsicGasTooLowError) {
        this.networkMonitor.structuredLogError(
          network,
          `IntrinsicGasTooLowError occurred while executing job: ${jobHash}. The job's gas limit is to low to ever succeed. Removing job from queue.`,
          error.message,
        )
        delete this.operatorJobs[jobHash]
      }

      return false
    } finally {
      this.networkMonitor.structuredLog(network, `Removing lock on job hash`, tags)
      this.isJobBeingExecuted[jobHash] = false
    }
  }
}
