import * as fs from 'fs-extra'
import * as path from 'node:path'
import * as inquirer from 'inquirer'

import {CliUx, Command, Flags} from '@oclif/core'
import {ethers} from 'ethers'

import {CONFIG_FILE_NAME, ensureConfigFileIsValid} from '../../utils/config'

import {decodeDeploymentConfig, decodeDeploymentConfigInput, capitalize, randomNumber} from '../../utils/utils'
import color from '@oclif/color'

enum OperatorMode {
  listen,
  manual,
  auto,
}

export default class Operator extends Command {
  static LAST_BLOCKS_FILE_NAME = 'blocks.json'
  static description = 'Listen for EVM events and process them'
  static examples = ['$ holo operator --networks="rinkeby mumbai fuji" --mode=auto']
  static flags = {
    networks: Flags.string({description: 'Comma separated list of networks to operate to', multiple: true}),
    mode: Flags.string({
      description: 'The mode in which to run the operator',
      options: ['listen', 'manual', 'auto'],
      char: 'm',
    }),
  }

  /**
   * Operator class variables
   */
  bridgeAddress: string | undefined
  factoryAddress: string | undefined
  operatorAddress: string | undefined
  supportedNetworks: string[] = ['rinkeby', 'mumbai', 'fuji']
  blockJobs: any[] = []
  providers: {[key: string]: ethers.providers.JsonRpcProvider | ethers.providers.WebSocketProvider} = {}
  abiCoder = ethers.utils.defaultAbiCoder
  wallets: {[key: string]: ethers.Wallet} = {}
  holograph!: ethers.Contract
  operatorMode: OperatorMode = OperatorMode.listen
  operatorContract!: ethers.Contract
  HOLOGRAPH_ADDRESS = '0xD11a467dF6C80835A1223473aB9A48bF72eFCF4D'.toLowerCase()
  LAYERZERO_RECEIVERS: any = {
    rinkeby: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
    mumbai: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
    fuji: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
  }

  targetEvents: any = {
    BridgeableContractDeployed: '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b',
    '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b': 'BridgeableContractDeployed',

    AvailableJob: '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11',
    '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11': 'AvailableJob',
  }

  networkColors: any = {}
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - Set all networks to start with latest block at index 0
  latestBlockHeight: {[key: string]: number} = {}
  exited = false

  rgbToHex(rgb: number): string {
    const hex = Number(rgb).toString(16)
    return hex.length === 1 ? `0${hex}` : hex
  }

  async loadLastBlocks(fileName: string, configDir: string): Promise<{[key: string]: number}> {
    const filePath = path.join(configDir, fileName)
    let lastBlocks: {[key: string]: number} = {}
    if (await fs.pathExists(filePath)) {
      lastBlocks = await fs.readJson(filePath)
    }

    return lastBlocks
  }

  saveLastBlocks(fileName: string, configDir: string, lastBlocks: {[key: string]: number}): void {
    const filePath = path.join(configDir, fileName)
    fs.writeFileSync(filePath, JSON.stringify(lastBlocks), 'utf8')
  }

  async initializeEthers(
    loadNetworks: string[],
    configFile: any,
    userWallet: ethers.Wallet | undefined,
  ): Promise<void> {
    for (let i = 0, l = loadNetworks.length; i < l; i++) {
      const network = loadNetworks[i]
      const rpcEndpoint = configFile.networks[network].providerUrl
      const protocol = new URL(rpcEndpoint).protocol
      switch (protocol) {
        case 'https:':
          this.providers[network] = new ethers.providers.JsonRpcProvider(rpcEndpoint)

          break
        case 'wss:':
          this.providers[network] = new ethers.providers.WebSocketProvider(rpcEndpoint)

          break
        default:
          throw new Error('Unsupported RPC provider protocol -> ' + protocol)
      }

      if (userWallet !== undefined) {
        this.wallets[network] = userWallet.connect(this.providers[network])
      }

      if (network in this.latestBlockHeight && this.latestBlockHeight[network] > 0) {
        this.log(`Resuming Operator from block height ${this.latestBlockHeight[network]} for ${capitalize(network)}`)
      } else {
        this.log(`Starting Operator from latest block height for ${network}`)
        this.latestBlockHeight[network] = 0
      }
    }

    const holographABI = await fs.readJson('./src/abi/Holograph.json')
    this.holograph = new ethers.ContractFactory(holographABI, '0x', this.wallets[loadNetworks[0]]).attach(
      this.HOLOGRAPH_ADDRESS.toLowerCase(),
    )

    const holographOperatorABI = await fs.readJson('./src/abi/HolographOperator.json')
    this.operatorContract = new ethers.ContractFactory(holographOperatorABI, '0x').attach(
      await this.holograph.getOperator(),
    )
  }

  exitHandler = async (exitCode: number): Promise<void> => {
    /**
     * Before exit, save the block heights to the local db
     */
    if (this.exited === false) {
      this.log('')
      this.log(`Saving current block heights: ${JSON.stringify(this.latestBlockHeight)}`)
      this.saveLastBlocks(Operator.LAST_BLOCKS_FILE_NAME, this.config.configDir, this.latestBlockHeight)
      this.log(`Exiting operator with code ${exitCode}...`)
      this.log('Goodbye! 👋')
      this.exited = true
    }
  }

  exitRouter = (options: {[key: string]: boolean | string | number}, exitCode: number | string): void => {
    /**
     * Before exit, save the block heights to the local db
     */
    if ((exitCode && exitCode === 0) || exitCode === 'SIGINT') {
      if (this.exited === false) {
        this.log('')
        this.log(`Saving current block heights:\n${JSON.stringify(this.latestBlockHeight, undefined, 2)}`)
        this.saveLastBlocks(Operator.LAST_BLOCKS_FILE_NAME, this.config.configDir, this.latestBlockHeight)
        this.log(`Exiting operator with code ${exitCode}...`)
        this.log('Goodbye! 👋')
        this.exited = true
      }

      this.debug(`\nExit code ${exitCode}`)
      if (options.exit) {
        // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
        process.exit()
      }
    } else {
      this.debug(`\nError: ${exitCode}`)
    }
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Operator)

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
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    const {userWallet, configFile} = await ensureConfigFileIsValid(configPath, true)
    this.log('User configurations loaded.')

    this.latestBlockHeight = await this.loadLastBlocks(Operator.LAST_BLOCKS_FILE_NAME, this.config.configDir)
    let canSync = false
    const lastBlockKeys: string[] = Object.keys(this.latestBlockHeight)
    for (let i = 0, l: number = lastBlockKeys.length; i < l; i++) {
      if (this.latestBlockHeight[lastBlockKeys[i]] > 0) {
        canSync = true
        break
      }
    }

    if (canSync) {
      const syncPrompt: any = await inquirer.prompt([
        {
          name: 'shouldSync',
          message: 'Operator has previous (missed) blocks that can be synced. Would you like to sync?',
          type: 'confirm',
          default: true,
        },
      ])
      if (syncPrompt.shouldSync === false) {
        this.latestBlockHeight = {}
      }
    }

    if (flags.networks === undefined || '') {
      // Load defaults
      flags.networks = this.supportedNetworks
    }

    for (let i = 0, l = flags.networks.length; i < l; i++) {
      const network = flags.networks[i]
      if (this.supportedNetworks.includes(network)) {
        // First let's color our networks 🌈
        this.networkColors[network] = color.rgb(randomNumber(100, 255), randomNumber(100, 255), randomNumber(100, 255))
      } else {
        // If network is not supported remove it from the array
        flags.networks.splice(i, 1)
        l--
        i--
      }
    }

    CliUx.ux.action.start(`Starting operator in mode: ${OperatorMode[this.operatorMode]}`)
    await this.initializeEthers(flags.networks, configFile, userWallet)

    this.bridgeAddress = (await this.holograph.getBridge()).toLowerCase()
    this.factoryAddress = (await this.holograph.getFactory()).toLowerCase()
    this.operatorAddress = (await this.holograph.getOperator()).toLowerCase()

    this.log(`Holograph address: ${this.HOLOGRAPH_ADDRESS}`)
    this.log(`Bridge address: ${this.bridgeAddress}`)
    this.log(`Factory address: ${this.factoryAddress}`)
    this.log(`Operator address: ${this.operatorAddress}`)
    CliUx.ux.action.stop('🚀')

    // Setup websocket subscriptions and start processing blocks
    for (let i = 0, l = flags.networks.length; i < l; i++) {
      const network = flags.networks[i]

      // Subscribe to events 🎧
      this.networkSubscribe(network)

      // Watch out for dropped sockets and reconnect if necessary
      // this.providers[network].on('error', this.handleDroppedSocket.bind(this, network))
      // this.providers[network].on('close', this.handleDroppedSocket.bind(this, network))
      // this.providers[network].on('end', this.handleDroppedSocket.bind(this, network))
    }

    // Catch all exit events
    for (const eventType of [`EEXIT`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `uncaughtException`, `SIGTERM`]) {
      process.on(eventType, this.exitRouter.bind(this, {exit: true}))
    }

    process.on('exit', this.exitHandler)

    // // Process blocks 🧱
    this.blockJobHandler()
  }

  // you can
  async processBlock(job: any): Promise<void> {
    this.debug(`processing [${job.network}] ${job.block}`)
    const block = await this.providers[job.network].getBlockWithTransactions(job.block)
    if (block !== null && 'transactions' in block) {
      if (block.transactions.length === 0) {
        this.log('Zero block transactions for block', job.block, 'on', job.network)
      }

      const interestingTransactions = []
      for (let i = 0, l = block.transactions.length; i < l; i++) {
        const transaction = block.transactions[i]
        if (transaction.from.toLowerCase() === this.LAYERZERO_RECEIVERS[job.network]) {
          // We have LayerZero call, need to check it it's directed towards Holograph operators
          interestingTransactions.push(transaction)
        } else if ('to' in transaction && transaction.to !== null && transaction.to !== '') {
          const to: string | undefined = transaction.to?.toLowerCase()
          // Check if it's a factory call
          if (to === this.factoryAddress || to === this.operatorAddress) {
            // We have a potential factory deployment or operator bridge transaction
            interestingTransactions.push(transaction)
          }
        }
      }

      if (interestingTransactions.length > 0) {
        this.log(
          `Found ${interestingTransactions.length} interesting transactions on block ${job.block} on ${job.network}`,
        )
        this.processTransactions(job.network, interestingTransactions)
      } else {
        this.blockJobHandler()
      }
    } else {
      this.log(job.network, color.red('Dropped block!'), job.block)
      this.blockJobs.unshift(job)
      this.blockJobHandler()
    }
  }

  // For some reason defining this as function definition causes `this` to be undefined
  blockJobHandler = (): void => {
    if (this.blockJobs.length > 0) {
      const blockJob = this.blockJobs.shift()
      this.processBlock(blockJob)
    } else {
      this.debug('no blocks')
      setTimeout(this.blockJobHandler, 1000)
    }
  }

  async processTransactions(network: string, transactions: ethers.Transaction[]): Promise<void> {
    /* eslint-disable no-await-in-loop */
    if (transactions.length > 0) {
      for (const transaction of transactions) {
        const receipt = await this.providers[network].getTransactionReceipt(transaction.hash as string)
        if (receipt === null) {
          throw new Error(`Could not get receipt for ${transaction.hash}`)
        }

        this.debug(`Processing transaction ${transaction.hash} on ${network} at block ${receipt.blockNumber}`)
        if (transaction.to?.toLowerCase() === this.factoryAddress) {
          this.handleContractDeployedEvents(transaction, receipt, network)
        } else if (transaction.to?.toLowerCase() === this.operatorAddress) {
          this.handleOperatorBridgeEvents(transaction, receipt, network)
        } else {
          this.handleOperatorRequestEvents(transaction, receipt, network)
        }
      }
    }

    this.blockJobHandler()
  }

  handleContractDeployedEvents(
    transaction: ethers.Transaction,
    receipt: ethers.ContractReceipt,
    network: string,
  ): void {
    this.log(`Checking if a new Holograph contract was deployed at tx: ${transaction.hash}`)
    const config = decodeDeploymentConfigInput(transaction.data)
    let event = null
    if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        if (event === null) {
          const log = receipt.logs[i]
          if (log.topics.length > 0 && log.topics[0] === this.targetEvents.BridgeableContractDeployed) {
            event = log.topics
            break
          } else {
            this.log(`BridgeableContractDeployed event not found in ${transaction.hash}`)
          }
        }
      }

      if (event) {
        const deploymentAddress = '0x' + event[1].slice(26)
        this.log(
          `\nHolographFactory deployed a new collection on ${capitalize(network)} at address ${deploymentAddress}\n` +
            `Wallet that deployed the collection is ${transaction.from}\n` +
            `The config used for deployHolographableContract was ${JSON.stringify(config, null, 2)}\n`,
          `The transaction hash is: ${transaction.hash}\n`,
        )
      }
    }
  }

  handleOperatorBridgeEvents(transaction: ethers.Transaction, receipt: ethers.ContractReceipt, network: string): void {
    this.log(`Checking if an operator executed a job to bridge a contract / collection at tx: ${transaction.hash}`)
    let event = null
    if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        if (event === null) {
          const log = receipt.logs[i]
          if (log.topics.length > 0 && log.topics[0] === this.targetEvents.BridgeableContractDeployed) {
            event = log.topics
          }
        }
      }
    } else {
      this.log('Failed to find BridgeableContractDeployed event from operator job')
    }

    if (event) {
      const deploymentInput = this.abiCoder.decode(['bytes'], '0x' + transaction.data.slice(10))[0]
      const config = decodeDeploymentConfig(this.abiCoder.decode(['bytes'], '0x' + deploymentInput.slice(10))[0])
      const deploymentAddress = '0x' + event[1].slice(26)
      this.log(
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
    this.log(`Checking if Operator was sent a bridge job via the LayerZero Relayer at tx: ${transaction.hash}`)
    let event = null
    if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
      for (let i = 0, l = receipt.logs.length; i < l; i++) {
        if (event === null) {
          const log = receipt.logs[i]
          if (
            log.address.toLowerCase() === this.operatorAddress &&
            log.topics.length > 0 &&
            log.topics[0] === this.targetEvents.AvailableJob
          ) {
            event = log.data
          } else {
            this.log(
              `LayerZero transaction is not relevant to AvailableJob event. ` +
                `Transaction was relayed to ${log.address} instead of ` +
                `The Operator at ${this.operatorAddress}`,
            )
          }
        }
      }

      if (event) {
        const payload = this.abiCoder.decode(['bytes'], event)[0]
        this.log(
          `HolographOperator received a new bridge job on ${capitalize(network)}\nThe job payload is ${payload}\n`,
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
      const contract = this.operatorContract.connect(this.wallets[network])
      const jobTx = await contract.executeJob(payload)
      this.debug(jobTx)
      this.log(`Transaction hash is ${jobTx.hash}`)

      const jobReceipt = await jobTx.wait()
      this.debug(jobReceipt)
      this.log(`Transaction ${jobTx.hash} mined and confirmed`)
    } else {
      this.log('Dropped potential payload to execute')
    }
  }

  networkSubscribe(network: string): void {
    this.providers[network].on('block', (blockNumber: string) => {
      const block = Number.parseInt(blockNumber, 10)
      if (this.latestBlockHeight[network] !== 0 && block - this.latestBlockHeight[network] > 1) {
        this.debug(`Dropped ${capitalize(network)} websocket connection, gotta do some catching up`)
        let latest = this.latestBlockHeight[network]
        while (block - latest > 1) {
          this.log(`[${this.networkColors[network](capitalize(network))}] -> Block ${latest} (Syncing)`)
          this.blockJobs.push({
            network: network,
            block: latest,
          })
          latest++
        }
      }

      this.latestBlockHeight[network] = block
      this.log(`[${this.networkColors[network](capitalize(network))}] -> Block ${block}`)
      this.blockJobs.push({
        network: network,
        block: block,
      })
    })
  }

  /*
  handleDroppedSocket(network: string): void {
    let resetProvider: any = null
    if (typeof resetProvider !== 'undefined') {
      clearInterval(resetProvider)
    }

    resetProvider = setInterval((): void => {
      this.log(`${capitalize(network)} websocket connection error`)
      try {
        this.web3[network].eth.clearSubscriptions()
      } catch (error) {
        this.warn(`Websocket clearSubscriptions error: ${error}`)
      }

      try {
        this.providers[network] = new WebsocketProvider(networks[network].wss)
        this.providers[network].on('error', this.handleDroppedSocket.bind(this, network))
        this.providers[network].on('close', this.handleDroppedSocket.bind(this, network))
        this.providers[network].on('end', this.handleDroppedSocket.bind(this, network))
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - TODO: Come back to this
        this.web3[network] = new Web3(this.providers[network])
        this.networkSubscribe(network)
        clearInterval(resetProvider)
      } catch (error) {
        this.log(error as string)
      }
    }, 5000) // 5 seconds
  }
*/
}
