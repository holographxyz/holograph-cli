import * as fs from 'fs-extra'
import * as path from 'node:path'
import * as inquirer from 'inquirer'

import {CliUx, Command, Flags} from '@oclif/core'
import Web3 from 'web3'
import {ethers} from 'ethers'

import {CONFIG_FILE_NAME, ensureConfigFileIsValid} from '../../utils/config'
const HttpProvider = require('../../utils/HttpProvider.js')
const WebsocketProvider = require('../../utils/WebsocketProvider.js')

import {
  networks,
  decodeDeploymentConfig,
  decodeDeploymentConfigInput,
  capitalize,
  webSocketConfig,
  randomNumber,
} from '../../utils/utils'
import color from '@oclif/color'

enum OperatorMode {
  listen,
  manual,
  auto,
}

export default class Operator extends Command {
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
  bridgeAddress: any
  factoryAddress: any
  operatorAddress: any
  supportedNetworks: string[] = ['rinkeby', 'mumbai', 'fuji']
  blockJobs: any[] = [{network:"mumbai",block:27072607}]
  providers: any = {}
  web3: any = {}
  wallets: any = {}
  holograph: any
  operatorMode: OperatorMode = OperatorMode.listen
  operatorContract: any
  HOLOGRAPH_ADDRESS = '0xD11a467dF6C80835A1223473aB9A48bF72eFCF4D'.toLowerCase()
  LAYERZERO_RECEIVERS: any = {
    rinkeby: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
    mumbai: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
    fuji: '0xF5E8A439C599205C1aB06b535DE46681Aed1007a'.toLowerCase(),
  }

  targetEvents: any = {
    '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b': 'BridgeableContractDeployed',
    BridgeableContractDeployed: '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b',
    '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11': 'AvailableJob',
    AvailableJob: '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11',
  }

  networkColors: any = {}
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - Set all networks to start with latest block at index 0
  latestBlockMap: any = {}

  rgbToHex(rgb: any) {
    const hex = Number(rgb).toString(16)
    return hex.length === 1 ? `0${hex}` : hex
  }

  async initializeWeb3(loadNetworks: string[], configFile: any, userWallet: any) {
    for (let i = 0, l = loadNetworks.length; i < l; i++) {
      const network = loadNetworks[i]
      const rpcEndpoint = configFile.networks[network].providerUrl
      const protocol = new URL(rpcEndpoint).protocol
      let ethersProvider
      switch (protocol) {
        case 'https:':
          this.providers[network] = new HttpProvider(rpcEndpoint)
          if (this.operatorMode !== OperatorMode.listen) {
            ethersProvider = new ethers.providers.JsonRpcProvider(rpcEndpoint)
          }

          break
        case 'wss:':
          this.providers[network] = new WebsocketProvider(rpcEndpoint, webSocketConfig)
          if (this.operatorMode !== OperatorMode.listen) {
            ethersProvider = new ethers.providers.WebSocketProvider(rpcEndpoint)
          }

          break
        default:
          throw new Error('Unsupported RPC provider protocol -> ' + protocol)
      }

      this.web3[network] = new Web3(this.providers[network])
      if (this.operatorMode !== OperatorMode.listen) {
        this.wallets[network] = userWallet.connect(ethersProvider)
      }

      this.latestBlockMap[network] = 0
      // TODO: You can manually set the latest block for a network to force the operator to start from a certain block
      // this.latestBlockMap = {
      //   rinkeby: 10900000,
      //   mumbai: 27060000,
      //   fuji: 'latest',
      // }
    }

    // Contract is instantiated with Rinkeby, but is compatible with all networks
    this.holograph = new this.web3[loadNetworks[0]].eth.Contract(
      JSON.parse(fs.readFileSync('src/abi/Holograph.json', 'utf8')),
      this.HOLOGRAPH_ADDRESS,
    )
    this.operatorContract = new ethers.ContractFactory(
      await fs.readJson('./src/abi/HolographOperator.json'),
      '0x',
    ).attach(await this.holograph.methods.getOperator().call())
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
        },
      ])
      mode = prompt.mode
    }

    this.operatorMode = OperatorMode[mode as keyof typeof OperatorMode]
    console.log(`Operator mode: ${this.operatorMode}`)

    this.log('Loading user configurations...')
    const configPath = path.join(this.config.configDir, CONFIG_FILE_NAME)
    const {userWallet, configFile} = await ensureConfigFileIsValid(
      configPath,
      this.operatorMode !== OperatorMode.listen,
    )
    this.log('User configurations loaded.')

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
    await this.initializeWeb3(flags.networks, configFile, userWallet)
    this.bridgeAddress = (await this.holograph.methods.getBridge().call()).toLowerCase()
    this.factoryAddress = (await this.holograph.methods.getFactory().call()).toLowerCase()
    this.operatorAddress = (await this.holograph.methods.getOperator().call()).toLowerCase()

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
      this.providers[network].on('error', this.handleDroppedSocket.bind(this, network))
      this.providers[network].on('close', this.handleDroppedSocket.bind(this, network))
      this.providers[network].on('end', this.handleDroppedSocket.bind(this, network))
    }

    // Process blocks 🧱
    this.blockJobHandler()
  }

  async executePayload(network: string, payload: string): Promise<void> {
    let operate = true
    if (this.operatorMode === OperatorMode.manual) {
      const operatorPrompt: any = await inquirer.prompt([
        {
          name: 'shouldContinue',
          message: `A transaction appeared on ${network} for execution, would you like to operate?`,
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

  async processBlock(job: any): Promise<void> {
    const block = await this.web3[job.network].eth.getBlock(job.block, true)
    if (block !== null && 'transactions' in block) {
      if (block.transactions.length === 0) {
        this.log('Zero block transactions for block', job.block, 'on', job.network)
      }

      const interestingTransactions = []
      for (let i = 0, l = block.transactions.length; i < l; i++) {
        const transaction = block.transactions[i]
        // Only check transactions that have a "to" address
        if ('to' in transaction && transaction.to !== null && transaction.to !== '') {
          // Check if it's a factory call
          if (transaction.to.toLowerCase() === this.factoryAddress) {
            // We have a potential factory deployment transaction
            interestingTransactions.push(transaction)
          } else if (transaction.to.toLowerCase() === this.operatorAddress) {
            // We have a potential operator bridge transaction
            interestingTransactions.push(transaction)
          }
          // Check if it's a LayerZero call
          else if (transaction.from.toLowerCase() === this.LAYERZERO_RECEIVERS[job.network]) {
            // We have LayerZero call, need to check it it's directed towards Holograph operators
            interestingTransactions.push(transaction)
          }
        }
      }

      if (interestingTransactions.length > 0) {
        this.processTransactions(job.network, interestingTransactions, this.blockJobHandler)
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
      setTimeout(this.blockJobHandler, 1000)
    }
  }

  async processTransactions(network: string, transactions: any, callback: any): Promise<void> {
    if (transactions.length > 0) {
      const transaction = transactions.shift()
      const receipt = await this.web3[network].eth.getTransactionReceipt(transaction.hash)
      if (receipt === null) {
        throw new Error(`Could not get receipt for ${transaction.hash}`)
      }

      if (transaction.to.toLowerCase() === this.factoryAddress) {
        const config = decodeDeploymentConfigInput(transaction.input)
        let event = null
        if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
          for (let i = 0, l = receipt.logs.length; i < l; i++) {
            const log = receipt.logs[i]
            if (log.topics.length > 0 && log.topics[0] === this.targetEvents.BridgeableContractDeployed) {
              event = log.topics
              break
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
        } else {
          this.log(`Failed with BridgeableContractDeployed event parsing ${transaction} ${receipt}`)
          throw new Error('Failed with BridgeableContractDeployed event parsing')
        }
      } else if (transaction.to.toLowerCase() === this.operatorAddress) {
        let event = null
        if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
          for (let i = 0, l = receipt.logs.length; i < l; i++) {
            const log = receipt.logs[i]
            if (log.topics.length > 0 && log.topics[0] === this.targetEvents.BridgeableContractDeployed) {
              event = log.topics
              break
            }
          }
        }

        if (event) {
          const deploymentInput = this.web3[network].eth.abi.decodeParameter(
            'bytes',
            '0x' + transaction.input.slice(10),
          )
          const config = decodeDeploymentConfig(
            this.web3[network].eth.abi.decodeParameter('bytes', '0x' + deploymentInput.slice(10)),
          )
          const deploymentAddress = '0x' + event[1].slice(26)
          this.log(
            '\nHolographOperator executed a job which bridged a collection\n' +
              `HolographFactory deployed a new collection on ${capitalize(network)} at address ${deploymentAddress}\n` +
              `Operator that deployed the collection is ${transaction.from}` +
              `The config used for deployHolographableContract function was ${JSON.stringify(config, null, 2)}\n`,
          )
        } else {
          this.log('Failed to find BridgeableContractDeployed event from operator job')
        }
      } else {
        let event = null
        if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
          for (let i = 0, l = receipt.logs.length; i < l; i++) {
            const log = receipt.logs[i]
            if (
              log.address.toLowerCase() === this.operatorAddress &&
              log.topics.length > 0 &&
              log.topics[0] === this.targetEvents.AvailableJob
            ) {
              event = log.data
              break
            }
          }
        }

        if (event) {
          const deploymentAddress = '0x' + event[1].slice(26)
          const payload = this.web3[network].eth.abi.decodeParameter('bytes', event)
          this.log(
            `HolographOperator received a new bridge job on ${capitalize(
              network,
            )} at ${deploymentAddress}\nThe job payload is ${payload}\n`,
          )
          await this.executePayload(network, payload)
        } else {
          this.log('LayerZero transaction is not relevant to AvailableJob event')
        }
      }
    } else {
      callback()
    }
  }

  networkSubscribe(network: string): void {
    const subscription = this.web3[network].eth
      .subscribe('newBlockHeaders')
      .on('connected', (subscriptionId: string) => {
        this.log(`${capitalize(network)} subscription to new block headers successful: ${subscriptionId}`)
      })
      .on('data', (blockHeader: any) => {
        if (this.latestBlockMap[network] !== 0 && blockHeader.number - this.latestBlockMap[network] > 1) {
          this.log(`Dropped ${capitalize(network)} websocket connection, gotta do some catching up`)
          let latest = this.latestBlockMap[network]
          while (blockHeader.number - latest > 1) {
            this.log(`Syncing ${capitalize(network)} block`, latest)
            this.blockJobs.push({
              network: network,
              block: latest,
            })
            latest++
          }
        }

        this.latestBlockMap[network] = blockHeader.number
        this.log(`[${this.networkColors[network](capitalize(network))}] -> Block ${blockHeader.number}`)
        this.blockJobs.push({
          network: network,
          block: blockHeader.number,
        })
      })
      .on('error', (error: Error) => {
        this.warn(`${capitalize(network)} subscription to new block headers error ${error.message}`)
        try {
          subscription.unsubscribe(this.log)
          subscription.subscribe()
        } catch {
          this.networkSubscribe(network)
        }
      })
  }

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
}
