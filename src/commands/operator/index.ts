import * as inquirer from 'inquirer'
import {CliUx, Flags} from '@oclif/core'
import {TransactionDescription} from '@ethersproject/abi'
// import {formatUnits} from '@ethersproject/units'
import {BigNumber} from '@ethersproject/bignumber'
import {Contract} from '@ethersproject/contracts'
import {TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'
import {Environment} from '@holographxyz/environment'
import {getNetworkByHolographId} from '@holographxyz/networks'
import {ensureConfigFileIsValid} from '../../utils/config'
import {GasPricing} from '../../utils/gas'
import {networksFlag, FilterType, OperatorMode, BlockJob, NetworkMonitor} from '../../utils/network-monitor'
import {web3, functionSignature, sha3, zeroAddress} from '../../utils/utils'
import {HealthCheck} from '../../base-commands/healthcheck'
interface OperatorJobDetails {
  pod: number
  blockTimes: number
  operator: string
  startBlock: number
  startTimestamp: BigNumber
  fallbackOperators: number[]
}

interface OperatorJob {
  network: string
  hash: string
  payload: string
  targetTime: number
  gasLimit: BigNumber
  gasPrice: BigNumber
  jobDetails: OperatorJobDetails
}

interface OperatorStatus {
  address: string
  active: {[key: string]: boolean}
  currentPod: {[key: string]: number}
  podIndex: {[key: string]: number}
  podSize: {[key: string]: number}
}

/**
 * Operator
 * Description: The primary command for operating jobs on the Holograph network.
 */
export default class Operator extends HealthCheck {
  static description = 'Listen for EVM events for jobs and process them'
  static examples = [
    '$ <%= config.bin %> <%= command.id %> --networks ethereumTestnetGoerli polygonTestnet avalancheTestnet --mode=auto',
  ]

  static flags = {
    mode: Flags.string({
      description: 'The mode in which to run the operator',
      options: ['listen', 'manual', 'auto'],
      char: 'm',
    }),
    sync: Flags.boolean({
      description: 'Start from last saved block position instead of latest block position',
      default: false,
    }),
    unsafePassword: Flags.string({
      description: 'Enter the plain text password for the wallet in the holograph cli config',
    }),
    ...networksFlag,
    ...HealthCheck.flags,
  }

  /**
   * Operator class variables
   */
  operatorMode: OperatorMode = OperatorMode.listen
  networkMonitor!: NetworkMonitor
  environment!: Environment
  operatorStatus: OperatorStatus = {} as OperatorStatus
  operatorJobs: {[key: string]: OperatorJob} = {}

  async decodeOperatorJob(
    network: string,
    operatorJobHash: string,
    operatorJobPayload: string,
  ): Promise<OperatorJob | undefined> {
    const contract: Contract = this.networkMonitor.operatorContract.connect(this.networkMonitor.providers[network])
    const rawJobDetails: any[] = await contract.getJobDetails(operatorJobHash)
    const jobDetails: OperatorJobDetails = {
      pod: rawJobDetails[0] as number,
      blockTimes: rawJobDetails[1] as number,
      operator: (rawJobDetails[2] as string).toLowerCase(),
      startBlock: rawJobDetails[3] as number,
      startTimestamp: BigNumber.from(rawJobDetails[4]),
      fallbackOperators: rawJobDetails[5] as number[],
    } as OperatorJobDetails
    if (jobDetails.startBlock > 0) {
      this.networkMonitor.structuredLog(network, 'Decoded valid job ' + operatorJobHash)
      let targetTime: number = new Date(BigNumber.from(jobDetails.startTimestamp).toNumber() * 1000).getTime()
      if (jobDetails.operator !== this.operatorStatus.address) {
        // operator is not selected
        // add +60 seconds to target time
        targetTime += 60 * 1000

        // ignore where operator is not in same pod
        if (jobDetails.pod === this.operatorStatus.currentPod[network]) {
          for (let i = 0; i < 5; i++) {
            if (
              jobDetails.fallbackOperators[i] >= this.operatorStatus.podSize[network] ||
              jobDetails.fallbackOperators[i] === 0
            ) {
              // anyone from that pod can operate
              break
            } else if (jobDetails.fallbackOperators[i] === this.operatorStatus.podIndex[network]) {
              // operator has been selected as the fallback
              break
            }

            // add +60 seconds to target time
            targetTime += 60 * 1000
          }
        } else {
          // add time delay for 5 fallback operators to have a chance first
          targetTime += 60 * 1000 * 5
        }
      }

      // time to extract gasLimit and gasPrice from payload
      const gasLimit: BigNumber = BigNumber.from('0x' + operatorJobPayload.slice(-128, -64))
      const gasPrice: BigNumber = BigNumber.from('0x' + operatorJobPayload.slice(-64))

      // we have a legit job here
      this.operatorJobs[operatorJobHash] = {
        network,
        hash: operatorJobHash,
        payload: operatorJobPayload,
        targetTime,
        gasLimit,
        gasPrice,
        jobDetails,
      } as OperatorJob
      // process.stdout.write(JSON.stringify(this.operatorJobs[operatorJobHash], undefined, 2) + '\n')
      return this.operatorJobs[operatorJobHash]
    }

    this.networkMonitor.structuredLog(network, 'Decoded invalid job ' + operatorJobHash)

    return undefined
  }

  updateJobTimes(): void {
    for (const hash of Object.keys(this.operatorJobs)) {
      const job: OperatorJob = this.operatorJobs[hash]
      let targetTime: number = new Date(BigNumber.from(job.jobDetails.startTimestamp).toNumber() * 1000).getTime()
      if (job.jobDetails.operator !== zeroAddress && job.jobDetails.operator !== this.operatorStatus.address) {
        // operator is not selected
        // add +60 seconds to target time
        targetTime += 60 * 1000

        // ignore where operator is not in same pod
        if (job.jobDetails.pod === this.operatorStatus.currentPod[job.network]) {
          for (let i = 0; i < 5; i++) {
            if (
              job.jobDetails.fallbackOperators[i] >= this.operatorStatus.podSize[job.network] ||
              job.jobDetails.fallbackOperators[i] === 0
            ) {
              // anyone from that pod can operate
              break
            } else if (job.jobDetails.fallbackOperators[i] === this.operatorStatus.podIndex[job.network]) {
              // operator has been selected as the fallback
              break
            }

            // add +60 seconds to target time
            targetTime += 60 * 1000
          }
        } else {
          // add time delay for 5 fallback operators to have a chance first
          targetTime += 60 * 1000 * 5
        }
      }

      this.operatorJobs[hash].targetTime = targetTime
    }
  }

  async updateOperatorStatus(network: string): Promise<void> {
    const contract: Contract = this.networkMonitor.operatorContract.connect(this.networkMonitor.providers[network])
    this.operatorStatus.active[network] = !BigNumber.from(
      await contract.getBondedAmount(this.operatorStatus.address),
    ).isZero()
    this.operatorStatus.currentPod[network] = BigNumber.from(
      await contract.getBondedPod(this.operatorStatus.address),
    ).toNumber()
    this.operatorStatus.podIndex[network] = BigNumber.from(
      await contract.getBondedPodIndex(this.operatorStatus.address),
    ).toNumber()
    if (this.operatorStatus.currentPod[network] > 0) {
      this.operatorStatus.podSize[network] = BigNumber.from(
        await contract.getPodOperatorsLength(this.operatorStatus.currentPod[network]),
      ).toNumber()
    }
  }

  processOperatorJob = async (network: string, payloadHash: string, tags: (string | number)[]): Promise<void> => {
    // if success then pass back payload hash to remove it from list
    if (await this.executePayload(payloadHash, tags)) {
      // job was a success
      this.processOperatorJobs(network, payloadHash)
    } else {
      // job failed, gotta try again
      this.processOperatorJobs(network)
    }

    Promise.resolve()
  }

  processOperatorJobs = (network: string, payloadHash?: string): void => {
    const tags: (string | number)[] = [this.networkMonitor.randomTag()]
    // this.networkMonitor.structuredLog(network, 'Checking for Operator Jobs', tags)
    if (payloadHash !== undefined && payloadHash !== '' && payloadHash in this.operatorJobs) {
      delete this.operatorJobs[payloadHash]
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
    // this.networkMonitor.structuredLog(network, `${jobs.length} jobs pending`, tags)
    const candidates: OperatorJob[] = []
    for (const job of jobs) {
      // check that time is within scope
      if (job.targetTime < now) {
        // add to list of candidates
        candidates.push(job)
        // find highest gas candidate first
        if (job.gasPrice.gt(highestGas)) {
          highestGas = job.gasPrice
        }
      }
    }

    // this.networkMonitor.structuredLog(network, `${candidates.length} job candidates identified`, tags)

    if (candidates.length > 0) {
      // sort candidates by gas priority
      // returning highest gas first
      candidates.sort((a: OperatorJob, b: OperatorJob): number => {
        return b.gasPrice.sub(a.gasPrice).toNumber()
      })
      const compareGas: BigNumber = gasPricing.isEip1559 ? gasPricing.maxFeePerGas! : gasPricing.gasPrice!
      /*
      this.networkMonitor.structuredLog(
        network,
        `Current gas price is ${formatUnits(compareGas, 'gwei')} GWEI, and job gas price is ${formatUnits(
          candidates[0].gasPrice,
          'gwei',
        )} GWEI`,
        tags,
      )
*/
      if (candidates[0].gasPrice.gte(compareGas)) {
        this.networkMonitor.structuredLog(network, `Sending ${candidates[0].hash} job for execution`, tags)
        // we have a valid job to do right away
        this.processOperatorJob(network, candidates[0].hash, tags)
      } else {
        setTimeout(this.processOperatorJobs.bind(this, network), 1000)
      }
    } else {
      setTimeout(this.processOperatorJobs.bind(this, network), 1000)
    }
  }

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

    this.log(`executeJob ${functionSignature('executeJob(bytes)')}`)
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

    CliUx.ux.action.start(`Starting operator in mode: ${OperatorMode[this.operatorMode]}`)
    await this.networkMonitor.run(true, undefined, this.filterBuilder)
    CliUx.ux.action.stop('🚀')

    for (const network of this.networkMonitor.networks) {
      // instantiate all network operator job watchers
      this.processOperatorJobs(network)
    }

    // Start health check server on port 6000
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

    this.operatorStatus.active = {}
    this.operatorStatus.currentPod = {}
    this.operatorStatus.podIndex = {}
    this.operatorStatus.podSize = {}
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
          this.networkMonitor.structuredLog(job.network, `handleBridgeOutEvent`, tags)
          await this.handleBridgeOutEvent(transaction, job.network, tags)
        } else if (to === this.networkMonitor.operatorAddress) {
          // use this to speed up logic for getting AvailableOperatorJob event
          this.networkMonitor.structuredLog(job.network, `handleBridgeInEvent`, tags)
          await this.handleBridgeInEvent(transaction, job.network, tags)
        } else if (from === this.networkMonitor.LAYERZERO_RECEIVERS[job.network]) {
          this.networkMonitor.structuredLog(job.network, `handleAvailableOperatorJobEvent`, tags)
          await this.handleAvailableOperatorJobEvent(transaction, job.network, tags)
        } else if (transaction.data?.slice(0, 10).startsWith(functionSignature('executeJob(bytes)'))) {
          this.networkMonitor.structuredLog(job.network, `handleBridgeInEvent`, tags)
          await this.handleBridgeInEvent(transaction, job.network, tags)
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
      this.networkMonitor.structuredLog(
        network,
        `Checking if a bridge request was made at tx: ${transaction.hash}`,
        tags,
      )
      const operatorJobHash: string | undefined = this.networkMonitor.decodeCrossChainMessageSentEvent(
        receipt,
        this.networkMonitor.operatorAddress,
      )
      if (operatorJobHash === undefined) {
        this.networkMonitor.structuredLog(
          network,
          `Failed to extract job details from ${transaction.hash} receipt`,
          tags,
        )
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
      const parsedTransaction: TransactionDescription =
        this.networkMonitor.operatorContract.interface.parseTransaction(transaction)
      if (parsedTransaction.name === 'executeJob') {
        const args: any[] | undefined = Object.values(parsedTransaction.args)
        const operatorJobPayload: string | undefined = args === undefined ? undefined : args[0]
        const operatorJobHash: string | undefined =
          operatorJobPayload === undefined ? undefined : sha3(operatorJobPayload)
        if (operatorJobHash === undefined) {
          this.networkMonitor.structuredLog(network, `Could not find a bridgeInRequest for ${transaction.hash}`, tags)
        } else {
          // remove job from operatorJobs if it exists
          if (operatorJobHash in this.operatorJobs) {
            delete this.operatorJobs[operatorJobHash]
          }

          // update operator details, in case operator was selected for a job, or any data changed
          await this.updateOperatorStatus(network)
          this.networkMonitor.structuredLog(network, `Found a valid bridgeInRequest for ${transaction.hash}`, tags)
        }
      } else {
        this.networkMonitor.structuredLog(network, `Unknown bridgeIn function executed for ${transaction.hash}`, tags)
      }
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
    } else {
      this.networkMonitor.structuredLog(network, `Transaction ${receipt.transactionHash} receipt received`, tags)
    }

    if (receipt.status === 1) {
      this.networkMonitor.structuredLog(
        network,
        `Checking if Operator was sent a bridge job via the LayerZero Relayer at tx: ${transaction.hash}`,
        tags,
      )
      const operatorJobPayloadData = this.networkMonitor.decodeAvailableOperatorJobEvent(
        receipt,
        this.networkMonitor.operatorAddress,
      )
      const operatorJobHash = operatorJobPayloadData === undefined ? undefined : operatorJobPayloadData[0]
      const operatorJobPayload = operatorJobPayloadData === undefined ? undefined : operatorJobPayloadData[1]
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
        // first update operator details, in case operator was selected for a job, or any data changed
        await this.updateOperatorStatus(network)
        // then add operator job to internal list of jobs to monitor and work on
        await this.decodeOperatorJob(network, operatorJobHash as string, operatorJobPayload as string)
      }
    }
  }

  /**
   * Execute the payload on the destination network
   */
  async executePayload(payloadHash: string, tags: (string | number)[]): Promise<boolean> {
    const job: OperatorJob = this.operatorJobs[payloadHash]
    const network: string = job.network
    this.networkMonitor.walletNonces[network] = await this.networkMonitor.wallets[network].getTransactionCount()

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
      const gasPricing: GasPricing = this.networkMonitor.gasPrices[network]
      const gasPrice: BigNumber = gasPricing.isEip1559 ? gasPricing.maxFeePerGas! : gasPricing.gasPrice!

      const receipt: TransactionReceipt | null = await this.networkMonitor.executeTransaction({
        network,
        tags,
        contract: this.networkMonitor.operatorContract,
        methodName: 'executeJob',
        args: [job.payload],
        gasPrice: gasPrice,
        gasLimit: job.gasLimit.mul(BigNumber.from('2')),
      })
      return receipt !== null
    }

    this.networkMonitor.structuredLog(network, 'Dropped potential payload to execute', tags)
    return false
  }

  /**
   * Execute the lz message payload on the destination network
   */
  async executeLzPayload(network: string, jobHash: string, args: any[], tags: (string | number)[]): Promise<void> {
    this.networkMonitor.walletNonces[network] = await this.networkMonitor.wallets[network].getTransactionCount()
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
