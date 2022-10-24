import * as inquirer from 'inquirer'
import {CliUx, Command, Flags} from '@oclif/core'
import {BigNumber} from '@ethersproject/bignumber'
import {Contract} from '@ethersproject/contracts'
import {TransactionReceipt, TransactionResponse} from '@ethersproject/abstract-provider'
import {Environment} from '@holographxyz/environment'
import {getNetworkByHolographId} from '@holographxyz/networks'
import {ensureConfigFileIsValid} from '../../utils/config'
import {networksFlag, FilterType, OperatorMode, BlockJob, NetworkMonitor} from '../../utils/network-monitor'
import {healthcheckFlag, startHealthcheckServer} from '../../utils/health-check-server'
import {web3} from '../../utils/utils'
import {OperatorJobStructOutput} from '../../types/holograph-operator'

interface OperatorJob {
  targetTime: number
  jobDetails: OperatorJobStructOutput
}

interface OperatorStatus {
  address: string
  active: {[key: string]: boolean}
  currentPod: {[key: string]: number}
  podIndex: {[key: string]: number}
}

/**
 * Operator
 * Description: The primary command for operating jobs on the Holograph network.
 */
export default class Operator extends Command {
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
    ...healthcheckFlag,
    sync: Flags.boolean({
      description: 'Start from last saved block position instead of latest block position',
      default: false,
    }),
    unsafePassword: Flags.string({
      description: 'Enter the plain text password for the wallet in the holograph cli config',
    }),
    ...networksFlag,
  }

  /**
   * Operator class variables
   */
  operatorMode: OperatorMode = OperatorMode.listen
  networkMonitor!: NetworkMonitor
  environment!: Environment
  address!: string
  operatorStatus: OperatorStatus = {} as OperatorStatus
  currentPod: {[key: string]: number} = {}
  podIndex: {[key: string]: number} = {}

  /**
   * Command Entry Point
   */
  async run(): Promise<void> {
    const {flags} = await this.parse(Operator)

    // Check the flags
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

    CliUx.ux.action.start(`Starting operator in mode: ${OperatorMode[this.operatorMode]}`)
    await this.networkMonitor.run(true, undefined, this.filterBuilder)
    CliUx.ux.action.stop('🚀')

    // Start health check server on port 6000
    // Can be used to monitor that the operator is online and running
    if (enableHealthCheckServer) {
      startHealthcheckServer({networkMonitor: this.networkMonitor})
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
    if (this.environment === Environment.localhost) {
      this.networkMonitor.filters.push({
        type: FilterType.to,
        match: this.networkMonitor.bridgeAddress,
        networkDependant: false,
      })
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
          await this.handleBridgeOutEvent(transaction, job.network, tags)
        } else if (from === this.networkMonitor.LAYERZERO_RECEIVERS[job.network]) {
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
          value: BigNumber.from('0'),
        })
        const args: any[] = this.networkMonitor.decodeLzEvent(receipt, this.networkMonitor.lzEndpointAddress[network])!
        const jobHash: string = web3.utils.keccak256(args[2] as string)
        this.networkMonitor.structuredLog(network, `Bridge request found for job hash ${jobHash}`, tags)
        await this.executeLzPayload(
          getNetworkByHolographId(bridgeTransaction.args[0]).key,
          jobHash,
          [args[0], args[1], 0, args[2]],
          tags,
        )
      }
    }
  }

  /*

  struct OperatorJob {
    uint8 pod;
    uint16 blockTimes;
    address operator;
    uint40 startBlock;
    uint64 startTimestamp;
    uint16[5] fallbackOperators;
  }

export type OperatorJobStructOutput = [
  number,
  number,
  string,
  number,
  BigNumber,
  [number, number, number, number, number]
] & {
  pod: number;
  blockTimes: number;
  operator: string;
  startBlock: number;
  startTimestamp: BigNumber;
  fallbackOperators: [number, number, number, number, number];
};


*/

  operatorJobs: {[key: string]: OperatorJob} = {}

  async decodeOperatorJob(network: string, operatorJobHash: string /* , operatorJobPayload: string */): Promise<void> {
    const contract: Contract = this.networkMonitor.operatorContract.connect(this.networkMonitor.providers[network])
    const jobDetails: OperatorJobStructOutput = (await contract.getJobDetails(
      operatorJobHash,
    )) as OperatorJobStructOutput
    if (jobDetails.startBlock > 0) {
      let targetTime: number = new Date(BigNumber.from(jobDetails.startTimestamp).toNumber() * 1000).getTime()
      const selectedOperator: string = jobDetails.operator.toLowerCase()
      if (selectedOperator !== this.operatorStatus.address) {
        // operator is not selected
        // add +60 seconds to target time
        targetTime += 60 * 1000
      }

      for (let i = 0; i < 5; i++) {
        /*
        if (jobDetails.pod === this.operatorStatus[network].selectedPod) {
          // leaving the work for later
        }
        if (jobDetails.fallbackOperators[i] !== this.operatorStatus[network].podIndex) {
          // leaving the work for later
        }
      */
      }

      // we have a legit job here
      this.operatorJobs[operatorJobHash] = {
        targetTime,
        jobDetails,
      } as OperatorJob
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
        const bridgeTransaction = this.networkMonitor.bridgeContract.interface.parseTransaction({
          data: operatorJobPayload!,
          value: BigNumber.from('0'),
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
