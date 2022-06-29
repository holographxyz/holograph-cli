import * as fs from 'node:fs'

import {Command, Flags} from '@oclif/core'
import Web3 from 'web3'

const WebsocketProvider = require('../../utils/WebsocketProvider.js')
import dotenv = require('dotenv')
dotenv.config()

import {
  networks,
  decodeDeploymentConfig,
  decodeDeploymentConfigInput,
  capitalize,
  webSocketConfig,
} from '../../utils/utils'

export default class Listener extends Command {
  static description = 'Listen for evm events'

  static flags = {
    from: Flags.string({char: 'e', description: 'Execute', required: false}),
  }

  static args = [{name: 'mode', description: 'Mode to run in', required: false}]

  /**
   * Listener class variables
   */
  bridgeAddress: any
  factoryAddress: any
  operatorAddress: any

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - Set all networks to start with latest block at index 0
  latestBlockMap: any = Object.assign(...Object.keys(networks).map((k) => ({[k]: 0})))

  supportedNetworks: string[] = ['rinkeby', 'mumbai']
  blockJobs: any[] = []

  providers: any = {
    rinkeby: new WebsocketProvider(networks.rinkeby.wss, webSocketConfig),
    mumbai: new WebsocketProvider(networks.mumbai.wss, webSocketConfig),
  }

  web3: any = {
    rinkeby: new Web3(this.providers.rinkeby),
    mumbai: new Web3(this.providers.mumbai),
  }

  HOLOGRAPH_ADDRESS = '0xD11a467dF6C80835A1223473aB9A48bF72eFCF4D'.toLowerCase()

  // Contract is instantiated with Rinkeby, but is compatible with all networks
  holograph = new this.web3.rinkeby.eth.Contract(
    JSON.parse(fs.readFileSync('src/abi/Holograph.json', 'utf8')),
    this.HOLOGRAPH_ADDRESS,
  )

  LAYERZERO_RECEIVERS: any = {
    rinkeby: '0x41836E93A3D92C116087af0C9424F4EF3DdB00a2'.toLowerCase(),
    mumbai: '0xb27c5c80eefe92591bf784dac95b7ac3db968e07'.toLowerCase(),
  }

  targetEvents = {
    '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b': 'BridgeableContractDeployed',
    BridgeableContractDeployed: '0xa802207d4c618b40db3b25b7b90e6f483e16b2c1f8d3610b15b345a718c6b41b',
    '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11': 'AvailableJob',
    AvailableJob: '0x6114b34f1f941c01691c47744b4fbc0dd9d542be34241ba84fc4c0bd9bef9b11',
  }

  async run(): Promise<void> {
    // const {args, flags} = await this.parse(Listener)
    this.bridgeAddress = (await this.holograph.methods.getBridge().call()).toLowerCase()
    this.factoryAddress = (await this.holograph.methods.getFactory().call()).toLowerCase()
    this.operatorAddress = (await this.holograph.methods.getOperator().call()).toLowerCase()

    console.log('Starting listener...')
    console.log(`Holograph address: ${this.HOLOGRAPH_ADDRESS}`)
    console.log(`Bridge address: ${this.bridgeAddress}`)
    console.log(`Factory address: ${this.factoryAddress}`)
    console.log(`Operator address: ${this.operatorAddress}`)

    // Setup websocket subscriptions and start processing blocks
    for (const network of this.supportedNetworks) {
      this.networkSubscribe(network)
      this.providers[network].on('error', this.handleDroppedSocket.bind(this, network))
      this.providers[network].on('close', this.handleDroppedSocket.bind(this, network))
      this.providers[network].on('end', this.handleDroppedSocket.bind(this, network))
      this.processTransactions(network, this.blockJobs, this.blockJobHandler)
    }

    this.blockJobHandler()
  }

  async processBlock(job: any): Promise<void> {
    const block = await this.web3[job.network].eth.getBlock(job.block, true)
    if (block !== null && 'transactions' in block) {
      if (block.transactions.length === 0) {
        console.log('Zero block transactions for block', job.block, 'on', job.network)
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
          else if (transaction.to.toLowerCase() === this.LAYERZERO_RECEIVERS[job.network]) {
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
      console.log(job.network, 'Dropped block!', job.block)
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
          console.log(
            `\nHolographFactory deployed a new collection on ${capitalize(network)} at address ${deploymentAddress}\n` +
              `Wallet that deployed the collection is ${transaction.from}\n` +
              `The config used for deployHolographableContract was ${JSON.stringify(config, null, 2)}\n`,
          )
        } else {
          console.log(`Failed with BridgeableContractDeployed event parsing ${transaction} ${receipt}`)
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
          console.log(
            '\nHolographOperator executed a job which bridged a collection\n' +
              `HolographFactory deployed a new collection on ${capitalize(network)} at address ${deploymentAddress}\n` +
              `Operator that deployed the collection is ${transaction.from}` +
              `The config used for deployHolographableContract function was ${JSON.stringify(config, null, 2)}\n`,
          )
        } else {
          console.log('Failed to find BridgeableContractDeployed event from operator job')
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
          const payload = this.web3[network].eth.abi.decodeParameter('bytes', event)
          console.log(
            `HolographOperator received a new bridge job on ${capitalize(network)}\nThe job payload is ${payload}\n`,
          )
        } else {
          console.log('LayerZero transaction is not relevant to AvailableJob event')
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
        console.log(`${capitalize(network)} subscription to new block headers successful: ${subscriptionId}`)
      })
      .on('data', (blockHeader: any) => {
        if (this.latestBlockMap[network] !== 0 && blockHeader.number - this.latestBlockMap[network] > 1) {
          console.log(`Dropped ${capitalize(network)} websocket connection, gotta do some catching up`)
          let latest = this.latestBlockMap[network]
          while (blockHeader.number - latest > 1) {
            console.log(`Syncing ${capitalize(network)} block`, latest)
            this.blockJobs.push({
              network: network,
              block: latest,
            })
            latest++
          }
        }

        this.latestBlockMap[network] = blockHeader.number
        console.log(capitalize(network), blockHeader.number)
        this.blockJobs.push({
          network: network,
          block: blockHeader.number,
        })
      })
      .on('error', (error: Error) => {
        console.error(`${capitalize(network)} subscription to new block headers error ${error.message}`)
        try {
          subscription.unsubscribe(console.log)
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
      console.log(`${capitalize(network)} websocket connection error`)
      try {
        this.web3[network].eth.clearSubscriptions()
      } catch (error) {
        console.error(`Websocket clearSubscriptions error: ${error}`)
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
        console.log(error)
      }
    }, 5000) // 5 seconds
  }
}
