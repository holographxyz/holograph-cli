import {TransactionReceipt} from '@ethersproject/abstract-provider'
import {Environment} from '@holographxyz/environment'
import {CliUx, Flags} from '@oclif/core'
import color from '@oclif/color'
import dotenv from 'dotenv'

import {BlockHeightProcessType, Logger} from '../../types/api'
import {InterestingTransaction} from '../../types/network-monitor'
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
import ApiService from '../../services/api-service'

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
    ...syncFlag,
    ...blockHeightFlag,
    ...networksFlag,
    ...replayFlag,
    ...processBlockRange,
    ...HealthCheck.flags,
  }

  // API Params
  BASE_URL?: string
  apiService!: ApiService
  apiColor = color.keyword('orange')
  errorColor = color.keyword('red')
  bloomFilters!: BloomFilterMap

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
    this.log(`Operator command has begun!!!`)
    const {flags} = await this.parse(Operator)
    this.BASE_URL = flags.host
    const enableHealthCheckServer = flags.healthCheck
    const healthCheckPort = flags.healthCheckPort
    let updateBlockHeight = flags.updateBlockHeight
    const syncFlag = flags.sync
    const processBlockRange = flags['process-block-range']
    this.legacyBlocks = !processBlockRange
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
    this.log('User configurations loaded.')

    this.environment = environment

    if (flags.replay !== '0') {
      this.log('Replay flag enabled, will not load or save block heights.')
      updateBlockHeight = BlockHeightOptions.DISABLE
    }

    if (
      this.BASE_URL !== undefined &&
      updateBlockHeight !== undefined &&
      updateBlockHeight === BlockHeightOptions.API
    ) {
      if (this.environment === Environment.experimental || this.environment === Environment.localhost) {
        this.log(`Skipping API authentication for ${Environment[this.environment]} environment`)
      } else {
        this.log(`Using API for block height track ...`)
        // Create API Service for GraphQL requests
        try {
          const logger: Logger = {
            log: this.log,
            warn: this.warn,
            debug: this.debug,
            error: this.error,
            jsonEnabled: () => false,
          }
          this.apiService = new ApiService(this.BASE_URL!, logger)
          await this.apiService.operatorLogin()
        } catch (error: any) {
          this.log('Error: Failed to get Operator Token from API')
          // NOTE: sample of how to do logs when in production mode
          this.log(JSON.stringify({...error, stack: error.stack}))
          this.exit()
        }

        if (this.apiService === undefined) {
          throw new Error('API service is not defined')
        }

        this.log(this.apiColor(`Successfully authenticated into API ${flags.host}`))
      }
    }

    this.networkMonitor = new NetworkMonitor({
      enableV2: true,
      parent: this,
      configFile,
      networks: flags.networks,
      debug: this.debug,
      processTransactions2: this.processTransactions2,
      userWallet,
      lastBlockFilename: 'operator-blocks.json',
      replay: flags.replay,
      apiService: this.apiService,
      BlockHeightOptions: updateBlockHeight as BlockHeightOptions,
      processBlockRange: processBlockRange,
    })

    this.jobsFile = path.join(this.config.configDir, this.networkMonitor.environment + '.operator-job-details.json')

    switch (updateBlockHeight) {
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

    if (this.apiService !== undefined) {
      this.apiService.setStructuredLog(this.networkMonitor.structuredLog.bind(this.networkMonitor))
      this.apiService.setStructuredLogError(this.networkMonitor.structuredLogError.bind(this.networkMonitor))
    }

    if ((await shouldSync(syncFlag, this.networkMonitor.latestBlockHeight)) === false) {
      this.networkMonitor.latestBlockHeight = {}
      this.networkMonitor.currentBlockHeight = {}
    }

    this.operatorStatus.address = userWallet.address.toLowerCase()

    this.networkMonitor.exitCallback = this.exitCallback.bind(this)

    CliUx.ux.action.start(`Starting operator in mode: ${OperatorMode[this.operatorMode]}`)
    const continuous = flags.replay === '0' // If replay is set, run network monitor stops after catching up to the latest block
    await this.networkMonitor.run(continuous, undefined, this.filterBuilder2)
    CliUx.ux.action.stop('🚀')

    // check if file exists
    if (await fs.pathExists(this.jobsFile)) {
      this.log('Saved jobs file exists, parsing it for valid/active jobs.')
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
        // Tags not passed in because they do not exist
        // Maybe save tags with the job hash so we can pass it back in here
        await this.checkJobStatus(jobHash)
      }
    } else {
      this.log('Saved jobs file not found (not loaded).')
    }

    for (const network of this.networkMonitor.networks) {
      // instantiate all network operator job watchers
      setTimeout(this.processOperatorJobs.bind(this, network), 60_000)
    }

    // Start health check server on port 6000 or healthCheckPort
    // Can be used to monitor that the operator is online and running
    if (enableHealthCheckServer) {
      await this.config.runHook('healthCheck', {networkMonitor: this.networkMonitor, healthCheckPort})
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

  async processTransactions2(job: BlockJob, interestingTransactions: InterestingTransaction[]): Promise<void> {
    const startTime = performance.now()

    if (interestingTransactions.length <= 0) {
      return
    }

    // Map over the transactions to create an array of Promises
    const transactionPromises = interestingTransactions.map(interestingTransaction =>
      this.processSingleTransaction(interestingTransaction, job),
    )

    // Use Promise.all to execute all the Promises concurrently
    await Promise.all(transactionPromises)

    const endTime = performance.now()
    const duration = endTime - startTime
    this.networkMonitor.structuredLog(
      job.network,
      `Processed ${transactionPromises.length} transactions in ${duration}ms`,
    )
  }

  async processSingleTransaction(interestingTransaction: InterestingTransaction, job: BlockJob) {
    const tags: (string | number)[] = [
      interestingTransaction.transaction.blockNumber as number,
      this.networkMonitor.randomTag(),
    ]
    const type: EventType = EventType[interestingTransaction.bloomId as keyof typeof EventType]

    // Log processing of transaction
    this.networkMonitor.structuredLog(
      job.network,
      `Processing transaction ${interestingTransaction.transaction.hash} at block ${interestingTransaction.transaction.blockNumber}`,
      tags,
    )
    this.networkMonitor.structuredLog(job.network, `Identified this as a ${interestingTransaction.bloomId} event`, tags)

    try {
      switch (type) {
        case EventType.CrossChainMessageSent:
          await this.handleCrossChainMessageSentEvent(job, type, interestingTransaction, tags)
          break
        case EventType.AvailableOperatorJob:
          await this.handleAvailableOperatorJobEvent(job, type, interestingTransaction, tags)
          break
        case EventType.FinishedOperatorJob:
          await this.handleFinishedOperatorJobEvent(job, type, interestingTransaction, tags)
          break
        case EventType.FailedOperatorJob:
          await this.handleFailedOperatorJobEvent(job, type, interestingTransaction, tags)
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
    interestingTransaction: InterestingTransaction,
    tags: (string | number)[],
  ) {
    try {
      const crossChainMessageSentEvent: CrossChainMessageSentEvent | null = this.bloomFilters[
        type
      ]!.bloomEvent.decode<CrossChainMessageSentEvent>(type, interestingTransaction.log!)
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
    interestingTransaction: InterestingTransaction,
    tags: (string | number)[],
  ) {
    try {
      const availableOperatorJobEvent: AvailableOperatorJobEvent | null = this.bloomFilters[
        type
      ]!.bloomEvent.decode<AvailableOperatorJobEvent>(type, interestingTransaction.log!)

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
    interestingTransaction: InterestingTransaction,
    tags: (string | number)[],
  ) {
    try {
      const finishedOperatorJobEvent: FinishedOperatorJobEvent | null = this.bloomFilters[
        type
      ]!.bloomEvent.decode<FinishedOperatorJobEvent>(type, interestingTransaction.log!)
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
    interestingTransaction: InterestingTransaction,
    tags: (string | number)[],
  ) {
    try {
      const failedOperatorJobEvent: FailedOperatorJobEvent | null = this.bloomFilters[
        type
      ]!.bloomEvent.decode<FailedOperatorJobEvent>(type, interestingTransaction.log!)
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
    // if success then pass back payload hash to remove it from list
    if (await this.executeJob(jobHash, tags)) {
      // check job status just in case
      await this.checkJobStatus(jobHash, tags)
      // job was a success
      this.processOperatorJobs(network, jobHash) // here the jobHash will be deleted
    } else {
      // check job status just in case
      await this.checkJobStatus(jobHash, tags)
      // job failed, gotta try again
      this.processOperatorJobs(network)
    }
  }

  // This method is call to cycle through all operator jobs that were previously detected
  processOperatorJobs = (network: string, jobHash?: string): void => {
    // IF processOperatorJobs has a jobHash, delete it from this.operatorJobs? Why do this here? why not delete it before?
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
      const compareGas: BigNumber = gasPricing.isEip1559 ? gasPricing.nextBlockFee! : gasPricing.gasPrice!
      let foundCandidate = false
      for (const candidate of candidates) {
        if (BigNumber.from(candidate.gasPrice).gte(compareGas)) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          const tags = this.operatorJobs[candidate.hash].tags ?? [this.networkMonitor.randomTag()]
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
    await this.checkJobStatus(jobHash, tags)
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
}
