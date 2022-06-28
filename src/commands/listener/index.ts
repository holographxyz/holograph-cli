import {Command /* Flags */} from '@oclif/core'

const WebsocketProvider = require('../../utils/WebsocketProvider.js');

import {
  networks,
  providers,
  web3,
  rinkebyHolograph,
  targetEvents,
  decodeDeploymentConfig,
  decodeDeploymentConfigInput,
  capitalize,
  HOLOGRAPH_ADDRESS,
  LAYERZERO_RECEIVERS,
} from '../../utils/utils'

export default class Listener extends Command {
  static description = 'Listen for evm events'

  bridgeAddress: any
  factoryAddress: any
  operatorAddress: any

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - Set all networks to start with latest block at index 0
  latestBlockMap: any = Object.assign(...Object.keys(networks).map((k) => ({[k]: 0})))

  supportedNetworks: string[] = ['rinkeby', 'mumbai']
  blockJobs: any[] = []

  // TODO: Decide on flags
  // static flags = {
  //   from: Flags.string({ char: 'd', description: '', required: false }),
  // };

  // static args = [{ name: 'person', description: 'Person to say hello to', required: true }];

  async run(): Promise<void> {
    // const {args, flags} = await this.parse(Listener)
    this.bridgeAddress = (await rinkebyHolograph.methods.getBridge().call()).toLowerCase()
    this.factoryAddress = (await rinkebyHolograph.methods.getFactory().call()).toLowerCase()
    this.operatorAddress = (await rinkebyHolograph.methods.getOperator().call()).toLowerCase()

    console.log('Starting listener...')
    console.log(`Holograph address: ${HOLOGRAPH_ADDRESS}`)
    console.log(`Bridge address: ${this.bridgeAddress}`)
    console.log(`Factory address: ${this.factoryAddress}`)
    console.log(`Operator address: ${this.operatorAddress}`)

    // Setup websocket subscriptions and start processing blocks
    for (const network of this.supportedNetworks) {
      this.networkSubscribe(network)

      providers[network].on('error', this.handleDroppedSocket.bind(this, network))
      providers[network].on('close', this.handleDroppedSocket.bind(this, network))
      providers[network].on('end', this.handleDroppedSocket.bind(this, network))

      this.processTransactions(network, this.blockJobs, this.blockJobHandler)
    }

    this.blockJobHandler()
  }

  async processBlock(job: any): Promise<void> {
    const block = await web3[job.network].eth.getBlock(job.block, true)
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
          else if (transaction.to.toLowerCase() === LAYERZERO_RECEIVERS[job.network]) {
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
      const receipt = await web3[network].eth.getTransactionReceipt(transaction.hash)
      if (receipt === null) {
        throw new Error(`could not get receipt for ${transaction.hash}`)
      }

      if (transaction.to.toLowerCase() === this.factoryAddress) {
        const config = decodeDeploymentConfigInput(transaction.input)
        let event = null
        if ('logs' in receipt && typeof receipt.logs !== 'undefined' && receipt.logs !== null) {
          for (let i = 0, l = receipt.logs.length; i < l; i++) {
            const log = receipt.logs[i]
            if (log.topics.length > 0 && log.topics[0] === targetEvents.BridgeableContractDeployed) {
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
            if (log.topics.length > 0 && log.topics[0] === targetEvents.BridgeableContractDeployed) {
              event = log.topics
              break
            }
          }
        }

        if (event) {
          const deploymentInput = web3[network].eth.abi.decodeParameter('bytes', '0x' + transaction.input.slice(10))
          const config = decodeDeploymentConfig(
            web3[network].eth.abi.decodeParameter('bytes', '0x' + deploymentInput.slice(10)),
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
              log.topics[0] === targetEvents.AvailableJob
            ) {
              event = log.data
              break
            }
          }
        }

        if (event) {
          const payload = web3[network].eth.abi.decodeParameter('bytes', event)
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
    const subscription = web3[network].eth
      .subscribe('newBlockHeaders')
      .on('connected', (subscriptionId: string) => {
        console.log(`${capitalize(network)} subscription to new block headers successful: ${subscriptionId}`)
      })
      .on('data', (blockHeader: any) => {
        if (this.latestBlockMap[network] !== 0 && blockHeader.number - this.latestBlockMap[network] > 1) {
          console.log(`Dropped ${capitalize(network)} websocket connection, gotta do some catching up`)
          let latest = this.latestBlockMap[network]
          while (blockHeader.number - latest > 1) {
            console.log(`Adding ${network} block`, latest)
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
        web3[network].eth.clearSubscriptions()
      } catch (error) {
        console.error(`Websocket clearSubscriptions error: ${error}`)
      }

      const Web3 = require('web3')
      try {
        providers[network] = new WebsocketProvider(networks[network].wss)
        providers[network].on('error', this.handleDroppedSocket.bind(this, network))
        providers[network].on('close', this.handleDroppedSocket.bind(this, network))
        providers[network].on('end', this.handleDroppedSocket.bind(this, network))
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - TODO: Come back to this
        web3[network] = new Web3(providers[network])
        this.networkSubscribe(network)
        clearInterval(resetProvider)
      } catch (error) {
        console.log(error)
      }
    }, 5000) // 5 seconds
  }
}
